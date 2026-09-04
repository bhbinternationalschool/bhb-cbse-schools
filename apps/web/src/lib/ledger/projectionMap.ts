/**
 * Ledger v2 — how a desk record becomes a voucher.
 *
 * Pure functions, no database. Every rule about which account a rupee lands in
 * lives here so it can be tested directly, and so the projection module below
 * it is only about reading rows and calling ledger_post.
 *
 * The invariant every builder must hold: a returned voucher balances, or it is
 * not returned at all. A projector that "mostly" balances is worse than one
 * that refuses — the refusal shows up in the reconciliation report, while a
 * forced entry quietly corrupts the trial balance.
 */

import {
  L_ACCOUNTS_PAYABLE,
  L_BANK,
  L_CASH,
  L_CHEQUES_IN_HAND,
  L_FEE_ADVANCES,
  L_FEE_INCOME,
  L_GST_INPUT,
  L_PG_CHARGES,
  L_PG_CLEARING,
  L_SALARY_PAYABLE,
  L_STAFF_ADVANCES,
  L_STATUTORY_PAYABLE,
  L_STORE_RECEIVABLE,
} from "@/lib/ledger/coa";
import type { LedgerLineInput, LedgerVoucherInput } from "@/lib/ledger/types";

export type BuildResult =
  | { ok: true; voucher: LedgerVoucherInput }
  | { ok: false; reason: string };

/** Sum a side of the lines, for the balance assertion every builder ends with. */
function sides(lines: LedgerLineInput[]) {
  return {
    dr: lines.reduce((n, l) => n + Math.round(l.debitPaise || 0), 0),
    cr: lines.reduce((n, l) => n + Math.round(l.creditPaise || 0), 0),
  };
}

function balancedOrRefuse(
  voucher: LedgerVoucherInput,
  label: string,
): BuildResult {
  const { dr, cr } = sides(voucher.lines);
  if (dr !== cr) {
    return { ok: false, reason: `${label} does not balance — Dr ${dr} vs Cr ${cr}` };
  }
  if (dr <= 0) return { ok: false, reason: `${label} has no amount` };
  return { ok: true, voucher };
}

/* ─── Fee receipts ─────────────────────────────────────────── */

export type DeskFeeVoucher = {
  id: string;
  householdId: string;
  receiptNo: string;
  collectionDate: string;
  totalPaise: number;
  cashierName: string;
  voidedAt: string | null;
  /** Session the money is FOR ("2026-27"). Absent on old rows — see below. */
  academicYearCode?: string;
};

/**
 * When a session's books open: 1 April of its starting year.
 *
 * "2026-27" → "2026-04-01". Null when the code cannot be read — and an
 * unreadable session must NOT be treated as an advance: routing money to a
 * liability on a guess would hide real income. Unknown stays income, which
 * the receipt date at least makes defensible.
 */
export function sessionStartOf(code: string | undefined): string | null {
  const m = /^\s*(\d{4})\s*[-/]\s*(\d{2}|\d{4})\s*$/.exec(code || "");
  if (!m) return null;
  return `${m[1]}-04-01`;
}

export type DeskFeeTender = {
  mode: string;
  amountPaise: number;
  ref: string;
  instrumentDate: string | null;
  bankAccountId: string;
  /**
   * Set when the money was captured by a payment gateway rather than arriving
   * in a school bank account. Empty for a parent who paid at the counter,
   * including by UPI into the school's own QR — that money really is in the
   * bank the same day, and routing it through clearing would be as wrong as
   * the reverse.
   */
  gatewayProvider?: string;
};

export type DeskFeeLine = { kind: string; amountPaise: number };

/**
 * A fee receipt.
 *
 *   cash            Dr Cash in Hand
 *   cheque / DD     Dr Cheques in Hand   (not bank money until it clears)
 *   via a gateway   Dr Payment Gateway Clearing  (captured, not yet settled)
 *   everything else Dr Bank Accounts
 *   store portion   Cr Store Receivable, the balance Cr Fee Income
 *
 * Cash basis: the credit is income on receipt. Once fee demand is being posted
 * as a receivable, `storeShare`'s treatment extends to the whole credit — see
 * buildFeeDemandVoucher and the accrual note there.
 */
export function buildFeeReceiptVoucher(input: {
  voucher: DeskFeeVoucher;
  tenders: DeskFeeTender[];
  lines: DeskFeeLine[];
}): BuildResult {
  const { voucher, tenders, lines } = input;
  const label = `fee receipt ${voucher.receiptNo || voucher.id}`;

  const live = tenders.filter((t) => Math.round(t.amountPaise || 0) > 0);
  if (live.length === 0) return { ok: false, reason: `${label} has no tender` };

  const tenderTotal = live.reduce((n, t) => n + Math.round(t.amountPaise), 0);
  const headerTotal = Math.round(voucher.totalPaise || 0);
  if (tenderTotal !== headerTotal) {
    // Never reconcile this by preferring one number over the other: a receipt
    // whose tenders disagree with its own total is a data problem the desk has
    // to answer for, and it surfaces in the reconciliation report.
    return {
      ok: false,
      reason: `${label}: tenders total ${tenderTotal} but the receipt says ${headerTotal}`,
    };
  }

  const party = voucher.householdId
    ? { kind: "household" as const, externalId: voucher.householdId }
    : undefined;

  const out: LedgerLineInput[] = [];
  for (const t of live) {
    const mode = (t.mode || "").toLowerCase();
    // Gateway money is not in any bank yet. It is held by the gateway, it
    // arrives net of fees, and it arrives lumped with every other payment of
    // the same cycle — so debiting a bank account here would state a balance
    // the bank will never show. The settlement journal moves it out of
    // clearing and into the bank that actually received it.
    const viaGateway = (t.gatewayProvider || "").trim() !== "";
    const accountCode =
      mode === "cash"
        ? L_CASH
        : mode === "cheque" || mode === "dd"
          ? L_CHEQUES_IN_HAND
          : viaGateway
            ? L_PG_CLEARING
            : L_BANK;
    out.push({
      accountCode,
      debitPaise: Math.round(t.amountPaise),
      creditPaise: 0,
      narration: mode ? mode.toUpperCase() : "Tender",
      // Only tag the sub-ledger where the desk actually recorded which account
      // it was. Guessing a pool here would put a number in the cash book that
      // nobody entered.
      ...(accountCode === L_BANK && t.bankAccountId
        ? { subledgerKind: "bank_account" as const, subledgerId: t.bankAccountId }
        : {}),
      ...(t.ref || t.instrumentDate
        ? { instrument: { mode, ref: t.ref || "", date: t.instrumentDate || undefined } }
        : {}),
      ...(party ? { party } : {}),
    });
  }

  const storeShare = lines
    .filter((l) => (l.kind || "").toLowerCase() === "store")
    .reduce((n, l) => n + Math.round(l.amountPaise || 0), 0);
  const cappedStore = Math.min(Math.max(storeShare, 0), headerTotal);
  const feeShare = headerTotal - cappedStore;

  if (cappedStore > 0) {
    out.push({
      accountCode: L_STORE_RECEIVABLE,
      debitPaise: 0,
      creditPaise: cappedStore,
      narration: "Store dues settled",
      ...(party ? { party } : {}),
    });
  }
  if (feeShare > 0) {
    // Money for a session that has not started is not income yet — it is a
    // liability to teach. It sits in Fees Received in Advance, tagged with
    // its session as a cost centre, until the session-start release journal
    // recognises it. The store share above is untouched: goods already
    // handed over are current, whatever session the fee is for.
    const sessionStart = sessionStartOf(voucher.academicYearCode);
    const isAdvance =
      sessionStart !== null && voucher.collectionDate < sessionStart;
    out.push({
      accountCode: isAdvance ? L_FEE_ADVANCES : L_FEE_INCOME,
      debitPaise: 0,
      creditPaise: feeShare,
      narration: isAdvance
        ? `Advance for ${voucher.academicYearCode} — receipt ${voucher.receiptNo || ""}`.trim()
        : `Fee receipt ${voucher.receiptNo || ""}`.trim(),
      ...(isAdvance ? { costCentreCode: voucher.academicYearCode } : {}),
      ...(party ? { party } : {}),
    });
  }

  return balancedOrRefuse(
    {
      voucherType: "receipt",
      date: voucher.collectionDate,
      narration: `Fee receipt ${voucher.receiptNo || voucher.id}`,
      sourceType: "fee_receipt",
      sourceId: voucher.id,
      createdBy: voucher.cashierName || "",
      lines: out,
    },
    label,
  );
}

/* ─── Expense vouchers ─────────────────────────────────────── */

export type DeskExpenseVoucher = {
  id: string;
  voucherNo: string;
  voucherDate: string;
  grandTotalPaise: number;
  paidPaise: number;
  duePaise: number;
  mode: string;
  bankId: string;
  vendorId: string;
  narration: string;
  approvedBy: string;
  cancelledAt: string | null;
};

/**
 * An expense voucher.
 *
 *   Dr the expense account its category maps to (the full amount, on the
 *      voucher date — the expense is incurred whether or not it is paid yet)
 *   Cr Cash or Bank for what was paid
 *   Cr Accounts Payable for what is still owed
 */
export function buildExpenseVoucher(input: {
  voucher: DeskExpenseVoucher;
  expenseAccountCode: string;
}): BuildResult {
  const { voucher, expenseAccountCode } = input;
  const label = `expense voucher ${voucher.voucherNo || voucher.id}`;

  const total = Math.round(voucher.grandTotalPaise || 0);
  if (total <= 0) return { ok: false, reason: `${label} has no amount` };

  const paid = Math.min(Math.max(Math.round(voucher.paidPaise || 0), 0), total);
  const due = total - paid;

  const lines: LedgerLineInput[] = [
    {
      accountCode: expenseAccountCode,
      debitPaise: total,
      creditPaise: 0,
      narration: voucher.narration || label,
    },
  ];

  if (paid > 0) {
    const mode = (voucher.mode || "").toLowerCase();
    const isCash = mode === "cash" || mode === "";
    lines.push({
      accountCode: isCash ? L_CASH : L_BANK,
      debitPaise: 0,
      creditPaise: paid,
      narration: isCash ? "Paid in cash" : `Paid by ${mode}`,
      ...(!isCash && voucher.bankId
        ? { subledgerKind: "bank_account" as const, subledgerId: voucher.bankId }
        : {}),
    });
  }
  if (due > 0) {
    lines.push({
      accountCode: L_ACCOUNTS_PAYABLE,
      debitPaise: 0,
      creditPaise: due,
      narration: "Unpaid balance",
      ...(voucher.vendorId
        ? { party: { kind: "vendor" as const, externalId: voucher.vendorId } }
        : {}),
    });
  }

  return balancedOrRefuse(
    {
      voucherType: "payment",
      date: voucher.voucherDate,
      narration: voucher.narration || label,
      sourceType: "expense_voucher",
      sourceId: voucher.id,
      createdBy: voucher.approvedBy || "",
      lines,
    },
    label,
  );
}

/* ─── Vendor bills ─────────────────────────────────────────── */

export type DeskVendorBill = {
  id: string;
  vendorId: string;
  billNo: string;
  billDate: string;
  grandTotalPaise: number;
  narration: string;
};

/** A supplier invoice: Dr purchases / expense, Cr the vendor's payable. */
export function buildVendorBillVoucher(input: {
  bill: DeskVendorBill;
  expenseAccountCode: string;
}): BuildResult {
  const { bill, expenseAccountCode } = input;
  const label = `vendor bill ${bill.billNo || bill.id}`;
  const total = Math.round(bill.grandTotalPaise || 0);
  if (total <= 0) return { ok: false, reason: `${label} has no amount` };

  const party = bill.vendorId
    ? { kind: "vendor" as const, externalId: bill.vendorId }
    : undefined;

  return balancedOrRefuse(
    {
      voucherType: "purchase",
      date: bill.billDate,
      narration: bill.narration || label,
      sourceType: "vendor_bill",
      sourceId: bill.id,
      lines: [
        {
          accountCode: expenseAccountCode,
          debitPaise: total,
          creditPaise: 0,
          narration: label,
        },
        {
          accountCode: L_ACCOUNTS_PAYABLE,
          debitPaise: 0,
          creditPaise: total,
          narration: "Payable to vendor",
          ...(party ? { party } : {}),
        },
      ],
    },
    label,
  );
}

/* ─── Payroll ──────────────────────────────────────────────── */

export type DeskPayrollRun = {
  id: string;
  month: string;
  status: string;
  postedBy: string;
};

export type DeskPayrollLine = {
  staffId: string;
  fullName: string;
  grossPaise: number;
  netPaise: number;
  advanceDeductPaise: number;
};

/**
 * A posted payroll run — the single largest expense the school has, and the
 * one the ERP has never put in its own books (audit 2026-08-23, L3).
 *
 *   Dr Salary & Wages           gross
 *   Cr Staff Advances           recovered against this month's pay
 *   Cr Statutory Dues           the rest of what was withheld
 *   Cr Salary Payable           what the staff are actually owed
 *
 * Payment is a separate voucher (buildPayrollPaymentVoucher) because posting a
 * run and paying it are different events on different dates.
 */
export function buildPayrollAccrualVoucher(input: {
  run: DeskPayrollRun;
  lines: DeskPayrollLine[];
  /** Last day of the run's month — payroll accrues at month end. */
  date: string;
}): BuildResult {
  const { run, lines, date } = input;
  const label = `payroll ${run.month}`;
  if (lines.length === 0) return { ok: false, reason: `${label} has no staff lines` };

  const gross = lines.reduce((n, l) => n + Math.round(l.grossPaise || 0), 0);
  const net = lines.reduce((n, l) => n + Math.round(l.netPaise || 0), 0);
  const advance = lines.reduce((n, l) => n + Math.round(l.advanceDeductPaise || 0), 0);
  const withheld = gross - net - advance;

  if (gross <= 0) return { ok: false, reason: `${label} has no gross pay` };
  if (withheld < 0) {
    // net + advances exceeding gross means the run's own arithmetic disagrees.
    // Forcing a balancing line here would invent a number; refuse instead.
    return {
      ok: false,
      reason: `${label}: gross ${gross} is less than net ${net} plus advances ${advance}`,
    };
  }

  const out: LedgerLineInput[] = [
    {
      accountCode: "5070",
      debitPaise: gross,
      creditPaise: 0,
      narration: `Salary & wages ${run.month}`,
      costCentreCode: "school",
    },
  ];
  if (advance > 0) {
    out.push({
      accountCode: L_STAFF_ADVANCES,
      debitPaise: 0,
      creditPaise: advance,
      narration: "Advances recovered",
    });
  }
  if (withheld > 0) {
    out.push({
      accountCode: L_STATUTORY_PAYABLE,
      debitPaise: 0,
      creditPaise: withheld,
      narration: "Deductions withheld",
    });
  }
  out.push({
    accountCode: L_SALARY_PAYABLE,
    debitPaise: 0,
    creditPaise: net,
    narration: `Net payable ${run.month}`,
  });

  return balancedOrRefuse(
    {
      voucherType: "payroll",
      date,
      narration: `Payroll ${run.month}`,
      sourceType: "payroll_run",
      sourceId: run.id,
      createdBy: run.postedBy || "",
      lines: out,
    },
    label,
  );
}

/** Paying a posted run: Dr Salary Payable, Cr Bank. */
export function buildPayrollPaymentVoucher(input: {
  run: DeskPayrollRun;
  netPaise: number;
  date: string;
}): BuildResult {
  const { run, netPaise, date } = input;
  const label = `payroll payment ${run.month}`;
  const net = Math.round(netPaise || 0);
  if (net <= 0) return { ok: false, reason: `${label} has no amount` };

  return balancedOrRefuse(
    {
      voucherType: "payment",
      date,
      narration: `Salary paid ${run.month}`,
      sourceType: "payroll_payment",
      sourceId: run.id,
      lines: [
        {
          accountCode: L_SALARY_PAYABLE,
          debitPaise: net,
          creditPaise: 0,
          narration: `Net payable ${run.month}`,
        },
        {
          accountCode: L_BANK,
          debitPaise: 0,
          creditPaise: net,
          narration: "Salary disbursed",
        },
      ],
    },
    label,
  );
}

/** Last calendar day of a `YYYY-MM` month. */
export function monthEndIso(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return "";
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/* ─── Gateway settlements ───────────────────────────────────── */

export type DeskPgSettlement = {
  cfSettlementId: string;
  utr: string;
  settledOn: string;
  settlementType: string;
  paymentAmountPaise: number;
  amountSettledPaise: number;
  serviceChargePaise: number;
  serviceTaxPaise: number;
  settlementChargePaise: number;
  settlementTaxPaise: number;
  adjustmentPaise: number;
};

/**
 * One settlement — the gateway paying the school.
 *
 *   Dr Bank (the account that got it)   amount_settled
 *   Dr Payment Gateway Charges          service + settlement charge
 *   Dr GST Input Credit                 the GST on those charges
 *     Cr Payment Gateway Clearing         payment_amount + adjustment
 *
 * The bank line carries the UTR as its instrument reference, which is the
 * whole point: the bank statement line for this credit carries the same UTR,
 * so the reconciliation matcher pairs them `exact` without a human reading
 * two screens side by side.
 *
 * `adjustment` is signed and routinely negative — a refund or a dispute from
 * an earlier cycle, deducted from this one. It reduces the credit to clearing
 * because that is where the money it reverses has been sitting. A large enough
 * negative makes the clearing line a debit instead, which is why the lines are
 * built as signed amounts and given a side at the end rather than being
 * hard-coded to one.
 *
 * The GST on the gateway's fee goes to input credit, not to expense: a
 * GST-registered trust can claim it, and burying it in the fee makes that
 * quietly impossible.
 */
export function buildPgSettlementVoucher(input: {
  settlement: DeskPgSettlement;
  /** Ledger code of the bank that received it — 1010 when unmapped. */
  bankAccountCode: string;
  /** Desk bank-account id for the sub-ledger, empty when unmapped. */
  bankAccountId: string;
  provider: string;
}): BuildResult {
  const s = input.settlement;
  const label = `settlement ${s.cfSettlementId}`;

  if (!s.settledOn) {
    return { ok: false, reason: `${label} has no settlement date` };
  }
  if (!s.utr) {
    // Without a UTR there is nothing for the bank statement to match, and a
    // settlement that has not been paid out has no business in the book.
    return { ok: false, reason: `${label} has no UTR yet` };
  }

  const charges = Math.round(s.serviceChargePaise) + Math.round(s.settlementChargePaise);
  const taxes = Math.round(s.serviceTaxPaise) + Math.round(s.settlementTaxPaise);
  const settled = Math.round(s.amountSettledPaise);
  const clearing = Math.round(s.paymentAmountPaise) + Math.round(s.adjustmentPaise);

  // The gateway's own arithmetic, restated. If it does not hold, the numbers
  // are not understood well enough to post — say so and let it show up as a
  // break, rather than plugging the difference into a suspense line.
  if (settled + charges + taxes !== clearing) {
    return {
      ok: false,
      reason:
        `${label}: net ${settled} + charges ${charges} + tax ${taxes} ` +
        `does not equal gross ${clearing}`,
    };
  }

  const signed: { accountCode: string; paise: number; narration: string; bank?: boolean }[] = [
    { accountCode: input.bankAccountCode, paise: settled, narration: `Settled ${s.utr}`, bank: true },
    { accountCode: L_PG_CHARGES, paise: charges, narration: "Gateway fee" },
    { accountCode: L_GST_INPUT, paise: taxes, narration: "GST on gateway fee" },
    { accountCode: L_PG_CLEARING, paise: -clearing, narration: "Cleared to bank" },
  ];

  const out: LedgerLineInput[] = [];
  for (const row of signed) {
    if (row.paise === 0) continue;
    out.push({
      accountCode: row.accountCode,
      debitPaise: row.paise > 0 ? row.paise : 0,
      creditPaise: row.paise < 0 ? -row.paise : 0,
      narration: row.narration,
      ...(row.bank && input.bankAccountId
        ? { subledgerKind: "bank_account" as const, subledgerId: input.bankAccountId }
        : {}),
      ...(row.bank
        ? { instrument: { mode: "neft", ref: s.utr, date: s.settledOn } }
        : {}),
    });
  }

  if (out.length === 0) {
    return { ok: false, reason: `${label} settles nothing` };
  }

  return {
    ok: true,
    voucher: {
      voucherType: "journal",
      date: s.settledOn,
      narration:
        `${input.provider} settlement ${s.cfSettlementId} · UTR ${s.utr}` +
        (s.settlementType && s.settlementType !== "STANDARD" ? ` · ${s.settlementType}` : ""),
      sourceType: "pg_settlement",
      sourceId: `${input.provider}:${s.cfSettlementId}`,
      lines: out,
    },
  };
}
