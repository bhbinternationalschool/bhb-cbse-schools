/**
 * Accounts — unified payables.
 *
 * One list across expense bills and transport-fleet dues, so the desk sees a
 * single "who do we owe" view and can settle any of it through one path.
 */

import {
  COA_ACCOUNTS_PAYABLE,
  COA_BANK_ACCOUNTS,
  COA_CASH_IN_HAND,
} from "@/lib/accountsTypes";
import type {
  AccountsPayable,
  AccountsState,
  PayableStatus,
  PaymentMode,
} from "@/lib/accountsTypes";
import {
  fail,
  id,
  todayIso,
} from "@/lib/accountsUtil";
import {
  normalizePayable,
} from "@/lib/accountsNormalize";
import {
  loadAccounts,
  saveAccounts,
} from "@/lib/accountsStore";
import {
  getCoaByCode,
} from "@/lib/accountsLookups";
import {
  postJournal,
} from "@/lib/accountsJournal";
import {
  postBankMovement,
  postCashMovement,
} from "@/lib/accountsCashBank";
import { markBillPaid } from "@/lib/accountsVendors";
import {
  listOpenPayables as listOpenTransportPayables,
  markPayablePaid as markTransportPayablePaid,
  loadTransport,
} from "@/lib/transport";

/* ─── Unified payables (incl. transport fleet) ────────────── */

export function listUnifiedPayables(state?: AccountsState): AccountsPayable[] {
  const s = state ?? loadAccounts();
  return s.payables
    .filter((p) => p.status !== "paid")
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}

/** Mirror open transport-fleet payables into the accounts payables list. */
export function syncTransportPayables(): AccountsState {
  try {
    const t = loadTransport();
    const openFleet = listOpenTransportPayables(t);
    const state = loadAccounts();
    let payables = [...state.payables];
    for (const fp of openFleet) {
      const idx = payables.findIndex(
        (p) => p.sourceType === "transport_fleet" && p.sourceId === fp.id,
      );
      const row = normalizePayable({
        id: idx >= 0 ? payables[idx]!.id : id("pay"),
        vendorId: "",
        sourceType: "transport_fleet",
        sourceId: fp.id,
        amountPaise: fp.amountPaise,
        dueOn: fp.dueOn,
        status: fp.status === "paid" ? "paid" : fp.status,
        paidPaise: fp.paidPaise,
        paidOn: fp.paidOn,
        note: fp.note,
      });
      if (idx >= 0) payables[idx] = row;
      else payables = [row, ...payables];
    }
    const next = { ...state, payables };
    saveAccounts(next);
    return next;
  } catch {
    return loadAccounts();
  }
}

export function payUnifiedPayable(
  payableId: string,
  input: {
    date?: string;
    mode: "cash" | "bank";
    poolId?: string;
    bankId?: string;
    bankMode?: PaymentMode;
    amountPaise?: number;
  },
): { ok: true } | { ok: false; error: string } {
  const state = loadAccounts();
  const payable = state.payables.find((p) => p.id === payableId);
  if (!payable) return fail("Payable not found");
  const remaining = payable.amountPaise - payable.paidPaise;
  const amount = Math.min(remaining, Math.max(0, input.amountPaise ?? remaining));
  if (amount <= 0) return fail("Nothing due on this payable");
  const date = input.date || todayIso();

  if (input.mode === "cash") {
    if (!input.poolId) return fail("Select a cash pool");
    const res = postCashMovement({
      poolId: input.poolId,
      date,
      direction: "out",
      amountPaise: amount,
      sourceType: "accounts_payable",
      sourceId: payable.id,
      narration: payable.note,
    });
    if (!res.ok) return res;
  } else {
    if (!input.bankId) return fail("Select a bank account");
    const res = postBankMovement({
      bankId: input.bankId,
      date,
      direction: "cr",
      amountPaise: amount,
      mode: input.bankMode ?? "neft",
      sourceType: "accounts_payable",
      sourceId: payable.id,
      narration: payable.note,
    });
    if (!res.ok) return res;
  }

  const apCoa = getCoaByCode(COA_ACCOUNTS_PAYABLE, state);
  const settleCoa = getCoaByCode(
    input.mode === "cash" ? COA_CASH_IN_HAND : COA_BANK_ACCOUNTS,
    state,
  );
  if (apCoa && settleCoa) {
    postJournal({
      date,
      narration: payable.note || "Payable settlement",
      sourceType: "accounts_payable",
      sourceId: payable.id,
      lines: [
        { coaId: apCoa.id, debitPaise: amount, creditPaise: 0, narration: "" },
        { coaId: settleCoa.id, debitPaise: 0, creditPaise: amount, narration: "" },
      ],
    });
  }

  const paidPaise = payable.paidPaise + amount;
  const status: PayableStatus =
    paidPaise >= payable.amountPaise ? "paid" : "partial";
  const s2 = loadAccounts();
  saveAccounts({
    ...s2,
    payables: s2.payables.map((p) =>
      p.id === payableId ? { ...p, paidPaise, status, paidOn: date } : p,
    ),
  });

  if (payable.sourceType === "expense_bill") {
    markBillPaid(payable.sourceId, date, paidPaise);
  } else if (payable.sourceType === "transport_fleet") {
    try {
      markTransportPayablePaid(payable.sourceId, date, paidPaise);
    } catch {
      /* transport module unavailable — accounts-side payable still updated */
    }
  }
  return { ok: true };
}

