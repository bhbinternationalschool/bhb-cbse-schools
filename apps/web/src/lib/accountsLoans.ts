/**
 * Accounts — trustees and owner loans.
 *
 * Loans the trust takes from its own trustees: EMI schedule generation,
 * disbursement, repayment, and the inter-trustee memo that moves a balance
 * between them without touching cash.
 */

import {
  COA_BANK_ACCOUNTS,
  COA_CASH_IN_HAND,
  COA_OWNER_LOANS,
} from "@/lib/accountsTypes";
import type {
  AccountsState,
  JournalEntry,
  OwnerLoan,
  OwnerLoanScheduleRow,
  OwnerLoanType,
  PaymentMode,
  Trustee,
} from "@/lib/accountsTypes";
import {
  fail,
  id,
  todayIso,
} from "@/lib/accountsUtil";
import {
  normalizeLoan,
  normalizeLoanRow,
  normalizeTrustee,
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

/* ─── Owner / trustee loans ────────────────────────────────── */

export function upsertTrustee(
  patch: Partial<Trustee> & { name: string },
): { ok: true; trustee: Trustee } | { ok: false; error: string } {
  const name = patch.name.trim();
  if (!name) return fail("Trustee name required");
  const state = loadAccounts();
  const existing = patch.id
    ? state.trustees.find((t) => t.id === patch.id)
    : undefined;
  const trustee = normalizeTrustee({
    ...existing,
    ...patch,
    name,
    id: existing?.id ?? patch.id ?? id("trs"),
  });
  const trustees = existing
    ? state.trustees.map((t) => (t.id === trustee.id ? trustee : t))
    : [...state.trustees, trustee];
  saveAccounts({ ...state, trustees });
  return { ok: true, trustee };
}

function computeEmiPaise(principalPaise: number, ratePct: number, tenureMonths: number): number {
  if (tenureMonths <= 0) return principalPaise;
  if (ratePct <= 0) return Math.round(principalPaise / tenureMonths);
  const r = ratePct / 12 / 100;
  const factor = Math.pow(1 + r, tenureMonths);
  const emi = (principalPaise * r * factor) / (factor - 1);
  return Math.round(emi);
}

export function createOwnerLoan(input: {
  trusteeId: string;
  type: OwnerLoanType;
  principalPaise: number;
  ratePct: number;
  tenureMonths: number;
  startDate?: string;
  note?: string;
  disburseToPoolId?: string;
  disburseToBankId?: string;
}): { ok: true; loan: OwnerLoan; schedule: OwnerLoanScheduleRow[] } | { ok: false; error: string } {
  const state = loadAccounts();
  if (!state.trustees.some((t) => t.id === input.trusteeId)) {
    return fail("Trustee not found");
  }
  const principal = Math.max(0, Math.round(input.principalPaise));
  if (principal <= 0) return fail("Principal amount required");
  const tenure = Math.max(1, Math.round(input.tenureMonths));
  const start = input.startDate || todayIso();
  const emi = computeEmiPaise(principal, input.ratePct, tenure);

  const loan = normalizeLoan({
    id: id("oln"),
    trusteeId: input.trusteeId,
    type: input.type,
    principalPaise: principal,
    ratePct: Math.max(0, input.ratePct),
    tenureMonths: tenure,
    startDate: start,
    note: input.note ?? "",
  });

  const schedule: OwnerLoanScheduleRow[] = [];
  for (let i = 0; i < tenure; i++) {
    const d = new Date(`${start}T12:00:00`);
    d.setMonth(d.getMonth() + i + 1);
    schedule.push(
      normalizeLoanRow({
        id: id("olr"),
        loanId: loan.id,
        installmentNo: i + 1,
        dueOn: d.toISOString().slice(0, 10),
        amountPaise: emi,
      }),
    );
  }

  saveAccounts({
    ...state,
    ownerLoans: [loan, ...state.ownerLoans],
    ownerLoanSchedule: [...schedule, ...state.ownerLoanSchedule],
  });

  const liabilityCoa = getCoaByCode(COA_OWNER_LOANS);
  if (input.disburseToPoolId) {
    const res = postCashMovement({
      poolId: input.disburseToPoolId,
      date: start,
      direction: "in",
      amountPaise: principal,
      sourceType: "owner_loan_disbursement",
      sourceId: loan.id,
      narration: `Loan disbursed — ${loan.type}`,
    });
    const cashCoa = getCoaByCode(COA_CASH_IN_HAND);
    if (res.ok && liabilityCoa && cashCoa) {
      postJournal({
        date: start,
        narration: "Owner loan disbursement",
        sourceType: "owner_loan_disbursement",
        sourceId: loan.id,
        lines: [
          { coaId: cashCoa.id, debitPaise: principal, creditPaise: 0, narration: "" },
          { coaId: liabilityCoa.id, debitPaise: 0, creditPaise: principal, narration: "" },
        ],
      });
    }
  } else if (input.disburseToBankId) {
    const res = postBankMovement({
      bankId: input.disburseToBankId,
      date: start,
      direction: "dr",
      amountPaise: principal,
      mode: "neft",
      sourceType: "owner_loan_disbursement",
      sourceId: loan.id,
      narration: `Loan disbursed — ${loan.type}`,
    });
    const bankCoa = getCoaByCode(COA_BANK_ACCOUNTS);
    if (res.ok && liabilityCoa && bankCoa) {
      postJournal({
        date: start,
        narration: "Owner loan disbursement",
        sourceType: "owner_loan_disbursement",
        sourceId: loan.id,
        lines: [
          { coaId: bankCoa.id, debitPaise: principal, creditPaise: 0, narration: "" },
          { coaId: liabilityCoa.id, debitPaise: 0, creditPaise: principal, narration: "" },
        ],
      });
    }
  }

  return { ok: true, loan, schedule };
}

export function recordOwnerLoanPayment(
  scheduleId: string,
  input: {
    paidOn?: string;
    paidAmountPaise?: number;
    mode: "cash" | "bank";
    poolId?: string;
    bankId?: string;
    bankMode?: PaymentMode;
  },
): { ok: true } | { ok: false; error: string } {
  const state = loadAccounts();
  const row = state.ownerLoanSchedule.find((r) => r.id === scheduleId);
  if (!row) return fail("Schedule row not found");
  if (row.status === "paid") return fail("Installment already paid");
  const amount = Math.max(0, Math.round(input.paidAmountPaise ?? row.amountPaise));
  const paidOn = input.paidOn || todayIso();

  if (input.mode === "cash") {
    if (!input.poolId) return fail("Select a cash pool");
    const res = postCashMovement({
      poolId: input.poolId,
      date: paidOn,
      direction: "out",
      amountPaise: amount,
      sourceType: "owner_loan_emi",
      sourceId: row.id,
      narration: `Loan installment #${row.installmentNo}`,
    });
    if (!res.ok) return res;
  } else {
    if (!input.bankId) return fail("Select a bank account");
    const res = postBankMovement({
      bankId: input.bankId,
      date: paidOn,
      direction: "cr",
      amountPaise: amount,
      mode: input.bankMode ?? "neft",
      sourceType: "owner_loan_emi",
      sourceId: row.id,
      narration: `Loan installment #${row.installmentNo}`,
    });
    if (!res.ok) return res;
  }

  const liabilityCoa = getCoaByCode(COA_OWNER_LOANS);
  const settleCoa = getCoaByCode(
    input.mode === "cash" ? COA_CASH_IN_HAND : COA_BANK_ACCOUNTS,
  );
  if (liabilityCoa && settleCoa) {
    postJournal({
      date: paidOn,
      narration: `Owner loan installment #${row.installmentNo}`,
      sourceType: "owner_loan_emi",
      sourceId: row.id,
      lines: [
        { coaId: liabilityCoa.id, debitPaise: amount, creditPaise: 0, narration: "" },
        { coaId: settleCoa.id, debitPaise: 0, creditPaise: amount, narration: "" },
      ],
    });
  }

  const s2 = loadAccounts();
  const updatedSchedule = s2.ownerLoanSchedule.map((r) =>
    r.id === scheduleId
      ? { ...r, status: "paid" as const, paidOn, paidAmountPaise: amount }
      : r,
  );
  const stillDue = updatedSchedule.some(
    (r) => r.loanId === row.loanId && r.status === "due",
  );
  saveAccounts({
    ...s2,
    ownerLoanSchedule: updatedSchedule,
    ownerLoans: stillDue
      ? s2.ownerLoans
      : s2.ownerLoans.map((l) =>
          l.id === row.loanId ? { ...l, status: "closed" as const } : l,
        ),
  });
  return { ok: true };
}

export function listOwnerLoanDue(
  asOf = todayIso(),
  state?: AccountsState,
): (OwnerLoanScheduleRow & { loan?: OwnerLoan })[] {
  const s = state ?? loadAccounts();
  return s.ownerLoanSchedule
    .filter((r) => r.status === "due" && r.dueOn <= asOf)
    .map((r) => ({ ...r, loan: s.ownerLoans.find((l) => l.id === r.loanId) }))
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}

export function postInterTrusteeTransfer(input: {
  fromTrusteeId: string;
  toTrusteeId: string;
  amountPaise: number;
  date?: string;
  note?: string;
}): { ok: true; entry: JournalEntry } | { ok: false; error: string } {
  const amount = Math.round(input.amountPaise);
  if (amount <= 0) return fail("Amount must be greater than zero");
  if (input.fromTrusteeId === input.toTrusteeId) {
    return fail("Pick two different trustees");
  }
  const state = loadAccounts();
  const from = state.trustees.find((t) => t.id === input.fromTrusteeId);
  const to = state.trustees.find((t) => t.id === input.toTrusteeId);
  if (!from || !to) return fail("Trustee not found");
  const liability = getCoaByCode(COA_OWNER_LOANS, state);
  if (!liability) return fail("Owner loans COA missing");

  const date = input.date || todayIso();
  const note =
    input.note?.trim() ||
    `Inter-trustee memo · ${from.name} → ${to.name}`;

  return postJournal({
    date,
    narration: note,
    sourceType: "inter_trustee_memo",
    sourceId: id("itm"),
    lines: [
      {
        coaId: liability.id,
        debitPaise: amount,
        creditPaise: 0,
        narration: `Reduce liability · ${from.name}`,
      },
      {
        coaId: liability.id,
        debitPaise: 0,
        creditPaise: amount,
        narration: `Assume liability · ${to.name}`,
      },
    ],
  });
}


/**
 * Post trust construction cost to CWIP (idempotent by costLineId).
 * Dr CWIP · Cr Cash/Bank (net) · Cr Retention (if any).
 */
