/**
 * Accounts — postings driven by the other modules.
 *
 * Fee collection, store sales and returns, day-close handover, and bank
 * statement reconciliation. Every entry point here is idempotent by source
 * id: fees.ts and store.ts fire these from floating promises, so a retry or
 * a double render must not double-count the money.
 */

import {
  COA_ACCOUNTS_RECEIVABLE,
  COA_BANK_ACCOUNTS,
  COA_CASH_IN_HAND,
  COA_FEE_INCOME,
  COA_STORE_SALES,
} from "@/lib/accountsTypes";
import type {
  JournalLine,
  PaymentMode,
  ReconSession,
  ReconSessionLine,
} from "@/lib/accountsTypes";
import {
  fail,
  id,
  todayIso,
} from "@/lib/accountsUtil";
import {
  ensureStoreCoaAccounts,
  normalizeReconSession,
} from "@/lib/accountsNormalize";
import {
  loadAccounts,
  saveAccounts,
  seedAccountsIfEmpty,
} from "@/lib/accountsStore";
import {
  getCoaByCode,
  resolveBankForPaymentMode,
} from "@/lib/accountsLookups";
import {
  postJournal,
} from "@/lib/accountsJournal";
import {
  postBankMovement,
  postCashMovement,
  transferCashBetweenPools,
} from "@/lib/accountsCashBank";

export function applyDayCloseHandover(session: {
  id: string;
  closeDate: string;
  systemCashPaise: number;
  physicalCashPaise: number;
}): { ok: true; applied: boolean } | { ok: false; error: string } {
  seedAccountsIfEmpty();
  const state = loadAccounts();
  const sourceId = `day_close_${session.id}`;
  if (
    state.cashLedger.some(
      (e) => e.sourceId === sourceId || e.sourceId.startsWith(`${sourceId}_`),
    )
  ) {
    return { ok: true, applied: false };
  }

  const drawer = state.cashPools.find((p) => p.code === "drawer");
  const main = state.cashPools.find((p) => p.code === "main");
  if (!drawer || !main) return fail("Cash pools not seeded");

  const amount = Math.max(
    0,
    Math.round(session.physicalCashPaise || session.systemCashPaise),
  );
  if (amount <= 0) return { ok: true, applied: false };

  if (drawer.balancePaise < amount) {
    const topUp = amount - drawer.balancePaise;
    const res = postCashMovement({
      poolId: drawer.id,
      date: session.closeDate,
      direction: "in",
      amountPaise: topUp,
      sourceType: "fee_day_close_backfill",
      sourceId: `${sourceId}_backfill`,
      narration: "Day-close variance / backfill to drawer",
    });
    if (!res.ok) return res;
  }

  const xfer = transferCashBetweenPools({
    fromPoolId: drawer.id,
    toPoolId: main.id,
    amountPaise: amount,
    date: session.closeDate,
    sourceType: "fee_day_close",
    sourceId,
    narration: "Day close cash handover · drawer → main",
  });
  if (!xfer.ok) return xfer;
  return { ok: true, applied: true };
}

export function postFeeCollectionToAccounts(input: {
  voucherId: string;
  collectionDate: string;
  receiptNo?: string;
  label?: string;
  tenders: { mode: string; amountPaise: number; bankAccountId?: string; ref?: string }[];
  /** Portion of collection that settles store credit dues. */
  storeAmountPaise?: number;
}): { ok: true; posted: boolean } | { ok: false; error: string } {
  seedAccountsIfEmpty();
  const ensured = ensureStoreCoaAccounts(loadAccounts());
  saveAccounts(ensured);
  const sourceId = `fee_v_${input.voucherId}`;
  const state = loadAccounts();
  if (
    state.cashLedger.some((e) => e.sourceId === sourceId || e.sourceId.startsWith(`${sourceId}_`)) ||
    state.bankLedger.some((e) => e.sourceId === sourceId || e.sourceId.startsWith(`${sourceId}_`)) ||
    state.journalEntries.some((j) => j.sourceId === sourceId)
  ) {
    return { ok: true, posted: false };
  }

  const drawer = state.cashPools.find((p) => p.code === "drawer");
  if (!drawer) return fail("Drawer cash pool not seeded");

  const cashPaise = input.tenders
    .filter((t) => t.mode === "cash" && t.amountPaise > 0)
    .reduce((n, t) => n + t.amountPaise, 0);
  const bankTenders = input.tenders.filter(
    (t) => t.mode !== "cash" && t.amountPaise > 0,
  );
  const narrationBase =
    input.receiptNo
      ? `Fee receipt ${input.receiptNo}`
      : input.label || "Fee collection";

  if (cashPaise > 0) {
    const cashRef =
      input.tenders.find((t) => t.mode === "cash" && t.amountPaise > 0)?.ref?.trim() ||
      input.receiptNo ||
      "";
    const res = postCashMovement({
      poolId: drawer.id,
      date: input.collectionDate,
      direction: "in",
      amountPaise: cashPaise,
      sourceType: "fee_voucher",
      sourceId,
      narration: narrationBase,
      transactionRef: cashRef,
    });
    if (!res.ok) return res;
  }

  for (const t of bankTenders) {
    const mode = (
      ["upi", "cheque", "neft", "rtgs", "card"].includes(t.mode)
        ? t.mode
        : "neft"
    ) as PaymentMode;
    const s = loadAccounts();
    const bankId =
      t.bankAccountId || resolveBankForPaymentMode(mode, s);
    if (!bankId) continue;
    const res = postBankMovement({
      bankId,
      date: input.collectionDate,
      direction: "dr",
      amountPaise: t.amountPaise,
      mode,
      sourceType: "fee_voucher",
      sourceId: `${sourceId}_${mode}`,
      narration: `${narrationBase} · ${mode}`,
      transactionRef: t.ref?.trim() || input.receiptNo || "",
    });
    if (!res.ok) return res;
  }

  const total = cashPaise + bankTenders.reduce((n, t) => n + t.amountPaise, 0);
  if (total > 0) {
    const cashCoa = getCoaByCode(COA_CASH_IN_HAND);
    const bankCoa = getCoaByCode(COA_BANK_ACCOUNTS);
    const feeCoa = getCoaByCode(COA_FEE_INCOME);
    const arCoa = getCoaByCode(COA_ACCOUNTS_RECEIVABLE);
    const storeShare = Math.min(
      total,
      Math.max(0, Math.round(Number(input.storeAmountPaise) || 0)),
    );
    const feeShare = total - storeShare;
    if ((feeCoa || arCoa) && (cashCoa || bankCoa)) {
      const lines: JournalLine[] = [];
      if (cashPaise > 0 && cashCoa) {
        lines.push({
          coaId: cashCoa.id,
          debitPaise: cashPaise,
          creditPaise: 0,
          narration: "Cash",
        });
      }
      const bankTotal = bankTenders.reduce((n, t) => n + t.amountPaise, 0);
      if (bankTotal > 0 && bankCoa) {
        lines.push({
          coaId: bankCoa.id,
          debitPaise: bankTotal,
          creditPaise: 0,
          narration: "Bank modes",
        });
      }
      if (storeShare > 0 && arCoa) {
        lines.push({
          coaId: arCoa.id,
          debitPaise: 0,
          creditPaise: storeShare,
          narration: "Store dues collected",
        });
      } else if (storeShare > 0 && feeCoa) {
        // Fallback if AR missing
        lines.push({
          coaId: feeCoa.id,
          debitPaise: 0,
          creditPaise: storeShare,
          narration: "Store (no AR COA)",
        });
      }
      if (feeShare > 0 && feeCoa) {
        lines.push({
          coaId: feeCoa.id,
          debitPaise: 0,
          creditPaise: feeShare,
          narration: narrationBase,
        });
      }
      if (lines.length >= 2) {
        postJournal({
          date: input.collectionDate,
          narration: narrationBase,
          sourceType: "fee_voucher",
          sourceId,
          lines,
        });
      }
    }
  }

  return { ok: true, posted: true };
}

/**
 * Post store issue / sale into cashbook + GL (idempotent by issue id).
 * Cash: Dr Cash · Cr Store Sales (+ cash drawer in)
 * Credit: Dr AR · Cr Store Sales
 */
export function postStoreSaleToAccounts(input: {
  issueId: string;
  issueNo: string;
  issuedOn: string;
  amountPaise: number;
  paymentMode: "cash" | "credit";
  tenderMode?: string;
  paymentChannel?: string;
  transactionRef?: string;
  narration?: string;
}): { ok: true; posted: boolean } | { ok: false; error: string } {
  seedAccountsIfEmpty();
  const amount = Math.max(0, Math.round(Number(input.amountPaise) || 0));
  if (amount <= 0) return { ok: true, posted: false };

  saveAccounts(ensureStoreCoaAccounts(loadAccounts()));
  const sourceId = `store_sale_${input.issueId}`;
  const state = loadAccounts();
  if (
    state.journalEntries.some((j) => j.sourceId === sourceId) ||
    state.cashLedger.some((e) => e.sourceId === sourceId)
  ) {
    return { ok: true, posted: false };
  }

  const salesCoa = getCoaByCode(COA_STORE_SALES);
  const cashCoa = getCoaByCode(COA_CASH_IN_HAND);
  const arCoa = getCoaByCode(COA_ACCOUNTS_RECEIVABLE);
  if (!salesCoa) return fail("Store Sales COA missing");

  const narration =
    input.narration || `Store sale ${input.issueNo}`;

  if (input.paymentMode === "cash") {
    const drawer = state.cashPools.find((p) => p.code === "drawer");
    if (!drawer) return fail("Drawer cash pool not seeded");
    if (!cashCoa) return fail("Cash COA missing");
    const cashRes = postCashMovement({
      poolId: drawer.id,
      date: input.issuedOn,
      direction: "in",
      amountPaise: amount,
      sourceType: "store_sale",
      sourceId,
      narration,
      transactionRef: input.transactionRef,
    });
    if (!cashRes.ok) return cashRes;
    postJournal({
      date: input.issuedOn,
      narration,
      sourceType: "store_sale",
      sourceId,
      lines: [
        {
          coaId: cashCoa.id,
          debitPaise: amount,
          creditPaise: 0,
          narration: "Cash sale",
        },
        {
          coaId: salesCoa.id,
          debitPaise: 0,
          creditPaise: amount,
          narration: "Store sales",
        },
      ],
    });
  } else {
    if (!arCoa) return fail("Accounts Receivable COA missing");
    postJournal({
      date: input.issuedOn,
      narration,
      sourceType: "store_sale",
      sourceId,
      lines: [
        {
          coaId: arCoa.id,
          debitPaise: amount,
          creditPaise: 0,
          narration: "Store credit",
        },
        {
          coaId: salesCoa.id,
          debitPaise: 0,
          creditPaise: amount,
          narration: "Store sales",
        },
      ],
    });
  }
  return { ok: true, posted: true };
}

/**
 * Reverse store sale for a sell return (idempotent by return id).
 * Credit sale: Dr Store Sales · Cr AR
 * Cash sale: Dr Store Sales · Cr Cash (+ cash drawer out)
 */
export function postStoreSellReturnToAccounts(input: {
  returnId: string;
  returnNo: string;
  returnedOn: string;
  amountPaise: number;
  paymentMode: "cash" | "credit";
  narration?: string;
}): { ok: true; posted: boolean } | { ok: false; error: string } {
  seedAccountsIfEmpty();
  const amount = Math.max(0, Math.round(Number(input.amountPaise) || 0));
  if (amount <= 0) return { ok: true, posted: false };

  saveAccounts(ensureStoreCoaAccounts(loadAccounts()));
  const sourceId = `store_sret_${input.returnId}`;
  const state = loadAccounts();
  if (
    state.journalEntries.some((j) => j.sourceId === sourceId) ||
    state.cashLedger.some((e) => e.sourceId === sourceId)
  ) {
    return { ok: true, posted: false };
  }

  const salesCoa = getCoaByCode(COA_STORE_SALES);
  const cashCoa = getCoaByCode(COA_CASH_IN_HAND);
  const arCoa = getCoaByCode(COA_ACCOUNTS_RECEIVABLE);
  if (!salesCoa) return fail("Store Sales COA missing");

  const narration =
    input.narration || `Store sell return ${input.returnNo}`;

  if (input.paymentMode === "cash") {
    const drawer = state.cashPools.find((p) => p.code === "drawer");
    if (!drawer || !cashCoa) return fail("Cash pool / COA missing");
    const cashRes = postCashMovement({
      poolId: drawer.id,
      date: input.returnedOn,
      direction: "out",
      amountPaise: amount,
      sourceType: "store_sell_return",
      sourceId,
      narration,
    });
    if (!cashRes.ok) return cashRes;
    postJournal({
      date: input.returnedOn,
      narration,
      sourceType: "store_sell_return",
      sourceId,
      lines: [
        {
          coaId: salesCoa.id,
          debitPaise: amount,
          creditPaise: 0,
          narration: "Sales reverse",
        },
        {
          coaId: cashCoa.id,
          debitPaise: 0,
          creditPaise: amount,
          narration: "Cash refund",
        },
      ],
    });
  } else {
    if (!arCoa) return fail("Accounts Receivable COA missing");
    postJournal({
      date: input.returnedOn,
      narration,
      sourceType: "store_sell_return",
      sourceId,
      lines: [
        {
          coaId: salesCoa.id,
          debitPaise: amount,
          creditPaise: 0,
          narration: "Sales reverse",
        },
        {
          coaId: arCoa.id,
          debitPaise: 0,
          creditPaise: amount,
          narration: "AR reduce",
        },
      ],
    });
  }
  return { ok: true, posted: true };
}

/** Save a bank statement recon session (CSV match results). */
export function saveReconSession(input: {
  bankId: string;
  asOf?: string;
  note?: string;
  lines: Omit<ReconSessionLine, "id">[];
}): { ok: true; session: ReconSession } | { ok: false; error: string } {
  const state = loadAccounts();
  if (!state.bankAccounts.some((b) => b.id === input.bankId)) {
    return fail("Bank not found");
  }
  const session = normalizeReconSession({
    id: id("recn"),
    bankId: input.bankId,
    asOf: input.asOf || todayIso(),
    createdAt: new Date().toISOString(),
    note: input.note ?? "",
    lines: input.lines.map((l) => ({ ...l, id: id("rl") })),
  });
  saveAccounts({
    ...state,
    reconSessions: [session, ...state.reconSessions],
  });
  return { ok: true, session };
}

/** Inter-trustee memo — balanced JV on Owner Loans with audit note (novation lite). */
