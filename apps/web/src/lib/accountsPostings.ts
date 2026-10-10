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
  COA_CHEQUES_IN_HAND,
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
  ensureChequeCoaAccount,
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
  voidJournalEntry,
} from "@/lib/accountsJournal";
import {
  postBankMovement,
  postCashMovement,
  transferCashBetweenPools,
  voidBankLedgerEntry,
  voidCashLedgerEntry,
} from "@/lib/accountsCashBank";
import { assertModulePermission } from "@/lib/rbacGuard";

/**
 * Refuse to post when the operator's role cannot write Accounts.
 *
 * saveAccounts() drops the write and returns in that case, so a posting used
 * to leave the receipt saved and the journal missing with nothing surfaced
 * (audit 2026-08-23, S3). Failing here instead lets the caller record the
 * posting in the retry queue, where somebody with the right role can replay
 * it. assertModulePermission also raises `bhb-rbac-denied` for the UI.
 */
function assertAccountsWritable(
  label: string,
): { ok: false; error: string } | null {
  if (assertModulePermission("accounts", "edit", label)) return null;
  return fail(
    `Your role cannot post to Accounts, so "${label}" was not written to the books. ` +
      "It is queued — an accounts user can retry it.",
  );
}

/** Idempotency key for everything posted out of one fee receipt. */
export function feeVoucherSourceId(voucherId: string): string {
  return `fee_v_${voucherId}`;
}

/** Idempotency key for the bank clearance of one cheque on that receipt. */
export function feeChequeSourceId(voucherId: string, chequeId: string): string {
  return `fee_chq_${voucherId}_${chequeId}`;
}

const FEE_BANK_MODES: PaymentMode[] = ["upi", "neft", "rtgs", "card"];

function normalizeFeeBankMode(mode: string): PaymentMode {
  return (FEE_BANK_MODES as string[]).includes(mode)
    ? (mode as PaymentMode)
    : "neft";
}

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

/**
 * Post a fee receipt into the cash/bank books and the GL (idempotent by
 * voucher id).
 *
 *   cash            Dr Cash in Hand      (drawer pool moves)
 *   upi/neft/rtgs   Dr Bank Accounts     (bank book moves)
 *   cheque          Dr Cheques in Hand   (no bank movement until it clears)
 *   store portion   Cr Accounts Receivable, the rest Cr Fee Income
 *
 * A cheque is not money in the bank on the day it is handed over, so it is
 * held in its own asset account and moved to Bank by
 * postChequeClearanceToAccounts when the bank actually clears it — the bank
 * book could never reconcile while cheques were debited on collection
 * (audit 2026-08-23, L2).
 *
 * Every bank tender is routed to an account BEFORE anything is written. An
 * unroutable tender used to be skipped in the bank book while its amount was
 * still debited to Bank in the journal, so the sub-ledger and the GL drifted
 * apart by exactly that tender. Now the whole receipt refuses to post and is
 * queued, which keeps the two sides of the book in step.
 */
export function postFeeCollectionToAccounts(input: {
  voucherId: string;
  collectionDate: string;
  receiptNo?: string;
  label?: string;
  tenders: { mode: string; amountPaise: number; bankAccountId?: string; ref?: string }[];
  /** Portion of collection that settles store credit dues. */
  storeAmountPaise?: number;
}): { ok: true; posted: boolean } | { ok: false; error: string } {
  const denied = assertAccountsWritable(
    `fee receipt ${input.receiptNo || input.voucherId}`,
  );
  if (denied) return denied;

  seedAccountsIfEmpty();
  saveAccounts(ensureChequeCoaAccount(ensureStoreCoaAccounts(loadAccounts())));

  const sourceId = feeVoucherSourceId(input.voucherId);
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

  const live = input.tenders.filter((t) => t.amountPaise > 0);
  const cashPaise = live
    .filter((t) => t.mode === "cash")
    .reduce((n, t) => n + t.amountPaise, 0);
  const chequeTenders = live.filter((t) => t.mode === "cheque");
  const chequePaise = chequeTenders.reduce((n, t) => n + t.amountPaise, 0);

  // Route every bank tender first — nothing is written until all of them
  // resolve, so a missing bank master can never split the books.
  const routed: {
    mode: PaymentMode;
    amountPaise: number;
    bankId: string;
    ref: string;
  }[] = [];
  const unroutable = new Set<string>();
  for (const t of live) {
    if (t.mode === "cash" || t.mode === "cheque") continue;
    const mode = normalizeFeeBankMode(t.mode);
    const bankId = t.bankAccountId || resolveBankForPaymentMode(mode, state);
    if (!bankId) {
      unroutable.add(mode.toUpperCase());
      continue;
    }
    routed.push({
      mode,
      amountPaise: t.amountPaise,
      bankId,
      ref: t.ref?.trim() || "",
    });
  }
  if (unroutable.size > 0) {
    return fail(
      `No bank account is set up to receive ${[...unroutable].join(" / ")} — ` +
        "add one under Accounts → Masters → Banks, then retry this posting. " +
        `Nothing was posted for receipt ${input.receiptNo || input.voucherId}.`,
    );
  }

  const narrationBase = input.receiptNo
    ? `Fee receipt ${input.receiptNo}`
    : input.label || "Fee collection";

  if (cashPaise > 0) {
    const cashRef =
      live.find((t) => t.mode === "cash")?.ref?.trim() || input.receiptNo || "";
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

  for (const t of routed) {
    const res = postBankMovement({
      bankId: t.bankId,
      date: input.collectionDate,
      direction: "dr",
      amountPaise: t.amountPaise,
      mode: t.mode,
      sourceType: "fee_voucher",
      sourceId: `${sourceId}_${t.mode}`,
      narration: `${narrationBase} · ${t.mode}`,
      transactionRef: t.ref || input.receiptNo || "",
    });
    if (!res.ok) return res;
  }

  const bankPaise = routed.reduce((n, t) => n + t.amountPaise, 0);
  const total = cashPaise + bankPaise + chequePaise;
  if (total > 0) {
    const cashCoa = getCoaByCode(COA_CASH_IN_HAND);
    const bankCoa = getCoaByCode(COA_BANK_ACCOUNTS);
    const chequeCoa = getCoaByCode(COA_CHEQUES_IN_HAND);
    const feeCoa = getCoaByCode(COA_FEE_INCOME);
    const arCoa = getCoaByCode(COA_ACCOUNTS_RECEIVABLE);
    const storeShare = Math.min(
      total,
      Math.max(0, Math.round(Number(input.storeAmountPaise) || 0)),
    );
    const feeShare = total - storeShare;
    if ((feeCoa || arCoa) && (cashCoa || bankCoa || chequeCoa)) {
      const lines: JournalLine[] = [];
      if (cashPaise > 0 && cashCoa) {
        lines.push({
          coaId: cashCoa.id,
          debitPaise: cashPaise,
          creditPaise: 0,
          narration: "Cash",
        });
      }
      if (bankPaise > 0 && bankCoa) {
        lines.push({
          coaId: bankCoa.id,
          debitPaise: bankPaise,
          creditPaise: 0,
          narration: "Bank modes",
        });
      }
      if (chequePaise > 0 && chequeCoa) {
        lines.push({
          coaId: chequeCoa.id,
          debitPaise: chequePaise,
          creditPaise: 0,
          narration: "Cheques in hand",
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
        const jv = postJournal({
          date: input.collectionDate,
          narration: narrationBase,
          sourceType: "fee_voucher",
          sourceId,
          lines,
        });
        if (!jv.ok) return jv;
      }
    }
  }

  return { ok: true, posted: true };
}

/**
 * Move one cleared cheque out of Cheques in Hand and into the bank book.
 *
 * Fired when the fee desk marks a cheque cleared. Idempotent by cheque id,
 * and keyed under the receipt so voiding the receipt reverses the clearance
 * along with the collection.
 */
export function postChequeClearanceToAccounts(input: {
  chequeId: string;
  voucherId: string;
  amountPaise: number;
  clearedOn: string;
  chequeNo?: string;
  receiptNo?: string;
  bankId?: string;
}): { ok: true; posted: boolean } | { ok: false; error: string } {
  const label = `cheque ${input.chequeNo || input.chequeId}`;
  const denied = assertAccountsWritable(label);
  if (denied) return denied;

  const amount = Math.max(0, Math.round(Number(input.amountPaise) || 0));
  if (amount <= 0) return { ok: true, posted: false };

  seedAccountsIfEmpty();
  saveAccounts(ensureChequeCoaAccount(loadAccounts()));

  const sourceId = feeChequeSourceId(input.voucherId, input.chequeId);
  const state = loadAccounts();
  if (
    state.bankLedger.some((e) => e.sourceId === sourceId) ||
    state.journalEntries.some((j) => j.sourceId === sourceId)
  ) {
    return { ok: true, posted: false };
  }

  const bankId = input.bankId || resolveBankForPaymentMode("cheque", state);
  if (!bankId) {
    return fail(
      "No bank account is set up to receive cheques — add one under " +
        "Accounts → Masters → Banks, then retry this posting.",
    );
  }

  const bankCoa = getCoaByCode(COA_BANK_ACCOUNTS);
  const chequeCoa = getCoaByCode(COA_CHEQUES_IN_HAND);
  if (!bankCoa || !chequeCoa) return fail("Bank / Cheques in Hand COA missing");

  const narration = `Cheque ${input.chequeNo || ""} cleared${
    input.receiptNo ? ` · receipt ${input.receiptNo}` : ""
  }`.replace(/\s+/g, " ").trim();

  const res = postBankMovement({
    bankId,
    date: input.clearedOn,
    direction: "dr",
    amountPaise: amount,
    mode: "cheque",
    sourceType: "fee_cheque",
    sourceId,
    narration,
    transactionRef: input.chequeNo || "",
  });
  if (!res.ok) return res;

  const jv = postJournal({
    date: input.clearedOn,
    narration,
    sourceType: "fee_cheque",
    sourceId,
    lines: [
      {
        coaId: bankCoa.id,
        debitPaise: amount,
        creditPaise: 0,
        narration: "Bank",
      },
      {
        coaId: chequeCoa.id,
        debitPaise: 0,
        creditPaise: amount,
        narration: "Cheque cleared",
      },
    ],
  });
  if (!jv.ok) return jv;

  return { ok: true, posted: true };
}

/**
 * Back a fee receipt out of the books when it is voided or its cheque bounces.
 *
 * Voiding a receipt used to touch nothing in accounts at all: the cash went
 * in, the journal credited fee income, and both stayed there for good, so
 * cash in hand and fee income were overstated by every voided receipt
 * (audit 2026-08-23, L1). Store returns already reversed properly; fees just
 * never did.
 *
 * Entries are voided rather than deleted — `voidedAt` keeps them out of the
 * trial balance while the audit trail survives — and the cash pool balance is
 * restored by voidCashLedgerEntry. Idempotent: re-running finds nothing live
 * and reports `reversed: false`.
 */
export function reverseFeeCollectionInAccounts(input: {
  voucherId: string;
  reason?: string;
}): { ok: true; reversed: boolean } | { ok: false; error: string } {
  const denied = assertAccountsWritable(`void of receipt ${input.voucherId}`);
  if (denied) return denied;

  const sourceId = feeVoucherSourceId(input.voucherId);
  const chequePrefix = `fee_chq_${input.voucherId}_`;
  const belongs = (sid: string) =>
    sid === sourceId ||
    sid.startsWith(`${sourceId}_`) ||
    sid.startsWith(chequePrefix);

  const reason = input.reason?.trim() || "Fee receipt voided";
  const state = loadAccounts();

  const cashIds = state.cashLedger
    .filter((e) => !e.voidedAt && belongs(e.sourceId))
    .map((e) => e.id);
  const bankIds = state.bankLedger
    .filter((e) => !e.voidedAt && belongs(e.sourceId))
    .map((e) => e.id);
  const journalIds = state.journalEntries
    .filter((j) => !j.voidedAt && belongs(j.sourceId))
    .map((j) => j.id);

  if (cashIds.length + bankIds.length + journalIds.length === 0) {
    return { ok: true, reversed: false };
  }

  // Cash first: it is the only one that can refuse (the drawer would go
  // negative because the money has already been handed over or banked).
  for (const entryId of cashIds) {
    const res = voidCashLedgerEntry(entryId, reason);
    if (!res.ok) {
      return fail(
        `${res.error} — receipt ${input.voucherId} could not be reversed in the ` +
          "cash book. Reverse the handover or deposit first, then retry.",
      );
    }
  }
  for (const entryId of bankIds) {
    const res = voidBankLedgerEntry(entryId, reason);
    if (!res.ok) return res;
  }
  for (const journalId of journalIds) {
    const res = voidJournalEntry(journalId, reason);
    if (!res.ok) return res;
  }

  return { ok: true, reversed: true };
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
