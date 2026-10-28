/**
 * Accounts → Loans — pure rules shared by the server (lib/loans.server.ts),
 * the daily tick and the screen (components/accounts/LoansPanel.tsx).
 *
 * Director, 14 Oct 2026: "make EMI auto run every month and ask for
 * approve"; "top-up additional amount to Mahindra on any vehicle by date,
 * mode and account"; "show all loans in ERP"; export vehicle- and month-wise.
 *
 *   TERMS     per loan account, server-side (module_local_state
 *             LOAN_TERMS_KEY, compare-and-set). SEED_LOAN_TERMS are only
 *             what the screen shows until the office saves a loan's terms —
 *             nothing is written by deploying this.
 *   PROPOSALS computed on the fly from the ledger + terms, never stored: a
 *             month whose due date has come, with no EMI in the books for
 *             it and not skipped, is proposed. Nothing posts until a person
 *             with Accounts · approve approves (lib/loans.server.ts).
 *   INTEREST  'reducing_daily_365': interest = outstanding principal ×
 *             annual rate × days since the previous due date ÷ 365,
 *             rounded once (to the paisa, or to the rupee for lenders that
 *             round so). Reproduces every posted Apr–Oct 2026 Mahindra EMI
 *             (24 of 24) with the rates in SEED_LOAN_TERMS.
 *
 * No imports from desk modules or server code: runs in tests and browsers.
 */

import type { LedgerLineInput, LedgerPartyKind } from "@/lib/ledger/types";

/* ─── Stores and sources ──────────────────────────────────── */

/** module_local_state key: every loan's terms. */
export const LOAN_TERMS_KEY = "ledger_loan_terms";
/** module_local_state key: skipped EMI months, prepayment/top-up requests, who was told. */
export const LOAN_QUEUE_KEY = "ledger_loan_queue";

/** Ledger idempotency sources. One voucher per source id, ever. */
export const LOAN_EMI_SOURCE = "loan_emi"; // `${code}:${YYYY-MM}`
export const LOAN_PREPAYMENT_SOURCE = "loan_prepayment"; // request id
export const LOAN_TOPUP_SOURCE = "loan_topup"; // request id
export const LOAN_BOOKING_SOURCE = "loan_booking"; // `${code}:booking`

/** 5090 Interest Expense — where every EMI's interest has been booked. */
export const LOAN_INTEREST_CODE = "5090";
/** 2100 Owner / Trustee Loans — a trustee paying personally lends to the trust. */
export const TRUSTEE_LOAN_CODE = "2100";
/** 1950 Suspense — Vehicles Pending Valuation: where the earlier loans' dealer money sits. */
export const VEHICLE_SUSPENSE_CODE = "1950";

/* ─── Dates ───────────────────────────────────────────────── */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export function isMonth(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}
export function istToday(nowMs = Date.now()): string {
  return new Date(nowMs + 330 * 60 * 1000).toISOString().slice(0, 10);
}
export function monthOf(date: string): string {
  return date.slice(0, 7);
}
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}
export function monthDiff(from: string, to: string): number {
  const [a, b] = from.split("-").map(Number) as [number, number];
  const [c, d] = to.split("-").map(Number) as [number, number];
  return c * 12 + d - (a * 12 + b);
}
/** The due date in a month; a day past the month's end clamps to it. */
export function dueDateIn(month: string, dueDay: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const d = Math.min(Math.max(1, Math.round(dueDay) || 10), last);
  return `${month}-${String(d).padStart(2, "0")}`;
}
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${MONTH_NAMES[m - 1] ?? "?"} ${y}`;
}

/* ─── Terms ───────────────────────────────────────────────── */

export const PAY_MODES = ["nach", "cheque", "bank_transfer", "upi", "cash", "trustee_personal"] as const;
export type PayMode = (typeof PAY_MODES)[number];
export const PAY_MODE_LABELS: Record<PayMode, string> = {
  nach: "NACH auto-debit",
  cheque: "Cheque",
  bank_transfer: "Bank transfer",
  upi: "UPI",
  cash: "Cash (cash box)",
  trustee_personal: "Trustee paid personally",
};
export function isPayMode(v: unknown): v is PayMode {
  return typeof v === "string" && (PAY_MODES as readonly string[]).includes(v);
}

export type LoanParty = { kind: LedgerPartyKind; externalId: string; name: string };

/** The trustee who pays the Winger EMIs himself (director, 14 Oct 2026). */
export const TRUSTEE_ASHISH: LoanParty = { kind: "vendor", externalId: "ashish singh", name: "Ashish Singh" };

export type LoanPaidFrom = {
  /** Ledger account credited: a bank, the cash box (1000) or 2100 (trustee). */
  accountCode: string;
  mode: PayMode;
  /** Required when the account is 2100 — whose loan to the trust grows. */
  party: LoanParty | null;
};

export type LoanTerms = {
  code: string;
  lender: string;
  contractNo: string;
  /** Transport vehicle id ("" = not a vehicle loan / not linked). */
  vehicleId: string;
  emiPaise: number;
  /** Annual rate in percent, e.g. 10.13656. */
  annualRatePct: number;
  dueDay: number;
  interestMethod: "reducing_daily_365";
  /** How the lender rounds each month's interest. */
  interestRounding: "paisa" | "rupee";
  paidFrom: LoanPaidFrom;
  /** First instalment's due date (EMI 1). */
  firstInstalmentDate: string;
  /** Last instalment's due date, "" = not recorded. */
  lastInstalmentDate: string;
  /** Amount sanctioned, 0 = not recorded. */
  sanctionedPaise: number;
  /** Disbursal / sanction date — the first EMI's interest runs from here. "" = not recorded. */
  sanctionedOn: string;
  active: boolean;
  note: string;
  updatedAt: string;
  updatedBy: string;
};

export type LoanTermsState = { loans: Record<string, LoanTerms> };

const UBI_MAIN = "1012";

/**
 * Initial values for the five Mahindra loans, shown until the office saves
 * terms (Accounts → Loans → Terms). Rates are the lender's own daily rates
 * expressed per year: 10.13656 (shown 10.1366) reproduces 2150's EMIs to the
 * paisa where 10.1366 is 6 paise out each month. Not written anywhere by
 * this code; lastInstalmentDate and the older loans' sanction are not
 * recorded, so they stay empty.
 */
export const SEED_LOAN_TERMS: Readonly<Record<string, Omit<LoanTerms, "updatedAt" | "updatedBy">>> = {
  "2150": {
    code: "2150",
    lender: "Mahindra Finance",
    contractNo: "10876691",
    vehicleId: "veh_xj1ud4ob",
    emiPaise: 5_890_800,
    annualRatePct: 10.13656,
    dueDay: 10,
    interestMethod: "reducing_daily_365",
    interestRounding: "paisa",
    paidFrom: { accountCode: UBI_MAIN, mode: "nach", party: null },
    firstInstalmentDate: "2025-06-10",
    lastInstalmentDate: "",
    sanctionedPaise: 0,
    sanctionedOn: "",
    active: true,
    note: "City Bus UP65QT4657 (TATA Marco Polo). EMI 11 fell on 10 Apr 2026.",
  },
  "2151": {
    code: "2151",
    lender: "Mahindra Finance",
    contractNo: "8891720",
    vehicleId: "veh_zxxart5q",
    emiPaise: 2_799_600,
    annualRatePct: 12.568016,
    dueDay: 10,
    interestMethod: "reducing_daily_365",
    interestRounding: "paisa",
    // Director, 14 Oct 2026: every Winger EMI is paid by the trustee
    // personally — always Cr 2100 with his party, never a bank by default.
    paidFrom: { accountCode: TRUSTEE_LOAN_CODE, mode: "trustee_personal", party: TRUSTEE_ASHISH },
    firstInstalmentDate: "2023-05-10",
    lastInstalmentDate: "",
    sanctionedPaise: 0,
    sanctionedOn: "",
    active: true,
    note: "Winger UP65MT0849. Paid by trustee Ashish Singh personally — added to his loan to the trust.",
  },
  "2152": {
    code: "2152",
    lender: "Mahindra Finance",
    contractNo: "10084191",
    vehicleId: "veh_5du7bt84",
    emiPaise: 1_776_400,
    annualRatePct: 10.74212,
    dueDay: 10,
    interestMethod: "reducing_daily_365",
    interestRounding: "paisa",
    paidFrom: { accountCode: UBI_MAIN, mode: "nach", party: null },
    firstInstalmentDate: "2024-08-10",
    lastInstalmentDate: "",
    sanctionedPaise: 0,
    sanctionedOn: "",
    active: true,
    note: "Magic-1 UP65PT3540.",
  },
  "2153": {
    code: "2153",
    lender: "Mahindra Finance",
    contractNo: "001002866678",
    vehicleId: "veh_78rm3v19",
    emiPaise: 2_146_100,
    annualRatePct: 11.8,
    dueDay: 10,
    interestMethod: "reducing_daily_365",
    interestRounding: "rupee",
    paidFrom: { accountCode: UBI_MAIN, mode: "cheque", party: null },
    firstInstalmentDate: "2026-09-10",
    lastInstalmentDate: "",
    sanctionedPaise: 70_100_000,
    sanctionedOn: "2026-07-20",
    active: true,
    note: "Magic-2 UP65RT9825. Fixed rate; paid by cheque.",
  },
  "2154": {
    code: "2154",
    lender: "Mahindra Finance",
    contractNo: "001003406724",
    vehicleId: "veh_zrve78iq",
    emiPaise: 2_218_800,
    annualRatePct: 12,
    dueDay: 10,
    interestMethod: "reducing_daily_365",
    interestRounding: "rupee",
    paidFrom: { accountCode: UBI_MAIN, mode: "nach", party: null },
    firstInstalmentDate: "2026-10-10",
    lastInstalmentDate: "",
    sanctionedPaise: 72_600_000,
    sanctionedOn: "2026-08-31",
    active: true,
    note: "Magic-3 UP65ST1373. Fixed rate. EMI 1 was 21,949 (broken period); 22,188 from then on.",
  },
};

function s(v: unknown, max = 200): string {
  return String(v ?? "").trim().slice(0, max);
}
function paise(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function normalizeParty(raw: unknown): LoanParty | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const externalId = s(r.externalId, 120);
  if (!externalId) return null;
  const kinds: LedgerPartyKind[] = ["vendor", "staff", "household", "student", "trustee", "bank", "other"];
  const kind = kinds.includes(r.kind as LedgerPartyKind) ? (r.kind as LedgerPartyKind) : "vendor";
  return { kind, externalId, name: s(r.name, 120) || externalId };
}

/** Bring one stored (or posted) terms object into shape; null = unusable. */
export function normalizeLoanTerms(code: string, raw: unknown): LoanTerms | null {
  if (!code || !raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const pf = (r.paidFrom && typeof r.paidFrom === "object" ? r.paidFrom : {}) as Record<string, unknown>;
  const day = Math.round(Number(r.dueDay));
  const rate = Number(r.annualRatePct);
  return {
    code,
    lender: s(r.lender, 120),
    contractNo: s(r.contractNo, 60),
    vehicleId: s(r.vehicleId, 80),
    emiPaise: paise(r.emiPaise),
    annualRatePct: Number.isFinite(rate) && rate >= 0 && rate < 100 ? rate : 0,
    dueDay: day >= 1 && day <= 31 ? day : 10,
    interestMethod: "reducing_daily_365",
    interestRounding: r.interestRounding === "rupee" ? "rupee" : "paisa",
    paidFrom: {
      accountCode: s(pf.accountCode, 20),
      mode: isPayMode(pf.mode) ? pf.mode : "nach",
      party: normalizeParty(pf.party),
    },
    firstInstalmentDate: isIsoDate(r.firstInstalmentDate) ? r.firstInstalmentDate : "",
    lastInstalmentDate: isIsoDate(r.lastInstalmentDate) ? r.lastInstalmentDate : "",
    sanctionedPaise: paise(r.sanctionedPaise),
    sanctionedOn: isIsoDate(r.sanctionedOn) ? r.sanctionedOn : "",
    active: r.active !== false,
    note: s(r.note, 500),
    updatedAt: s(r.updatedAt, 40),
    updatedBy: s(r.updatedBy, 120),
  };
}

export function normalizeLoanTermsState(raw: unknown): LoanTermsState {
  const src = raw && typeof raw === "object" ? (raw as { loans?: unknown }).loans : null;
  const loans: Record<string, LoanTerms> = {};
  if (src && typeof src === "object") {
    for (const [code, v] of Object.entries(src as Record<string, unknown>)) {
      const t = normalizeLoanTerms(code, v);
      if (t) loans[code] = t;
    }
  }
  return { loans };
}

export type EffectiveTerms = { terms: LoanTerms; source: "saved" | "default" };

/** Saved terms win; else the seed; else nothing (proposals need terms). */
export function effectiveTerms(code: string, saved: LoanTermsState): EffectiveTerms | null {
  const t = saved.loans[code];
  if (t) return { terms: t, source: "saved" };
  const seed = SEED_LOAN_TERMS[code];
  if (seed) return { terms: { ...seed, paidFrom: { ...seed.paidFrom }, updatedAt: "", updatedBy: "" }, source: "default" };
  return null;
}

/** What a terms save must satisfy. Returns the first problem, or null. */
export function termsProblem(t: LoanTerms, accountExists: (code: string) => boolean): string | null {
  if (!t.lender) return "Enter the lender";
  if (!(t.emiPaise > 0)) return "Enter the EMI amount";
  if (!(t.annualRatePct > 0)) return "Enter the annual interest rate";
  if (!isIsoDate(t.firstInstalmentDate)) return "Enter the first instalment's due date";
  if (t.lastInstalmentDate && t.lastInstalmentDate < t.firstInstalmentDate) return "The last instalment cannot be before the first";
  if (t.sanctionedOn && t.sanctionedOn > t.firstInstalmentDate) return "The loan cannot be sanctioned after its first instalment";
  return paidFromProblem(t.paidFrom, accountExists);
}

export function paidFromProblem(pf: LoanPaidFrom, accountExists: (code: string) => boolean): string | null {
  if (!pf.accountCode) return "Choose the account the EMI is paid from";
  if (!accountExists(pf.accountCode)) return `${pf.accountCode} is not an account in the books`;
  if (pf.accountCode === TRUSTEE_LOAN_CODE && !pf.party) return "Paid by a trustee: name the trustee (2100 needs the party)";
  if (pf.mode === "trustee_personal" && pf.accountCode !== TRUSTEE_LOAN_CODE) {
    return "A trustee paying personally is credited to 2100 Owner / Trustee Loans";
  }
  if (pf.accountCode === TRUSTEE_LOAN_CODE && pf.mode !== "trustee_personal") return "2100 is the trustee's account — choose the mode 'Trustee paid personally'";
  if (pf.mode === "cash" && pf.accountCode !== "1000") return "Cash comes from the cash box (1000)";
  return null;
}

/* ─── The loan's ledger history ───────────────────────────── */

/** One live voucher touching a loan account (server-built). */
export type LoanLedgerEntry = {
  voucherId: string;
  voucherNo: string;
  voucherType: string;
  date: string;
  sourceType: string;
  sourceId: string;
  narration: string;
  loanDebitPaise: number;
  loanCreditPaise: number;
  /** Interest-account debits minus credits in the same voucher. */
  interestPaise: number;
  /** A reversal, or a voucher a reversal cancelled — neither counts. */
  cancelled: boolean;
};

export type LoanEntryKind = "disbursal" | "emi" | "prepayment" | "topup" | "other";

/**
 * What a voucher is to the loan.
 *
 * An EMI is a debit to the loan WITH interest beside it (or one this module
 * posted as an EMI) — so manual EMIs ('mahindra_soa', 'vehicle_loan', a
 * voucher typed in Accounts) are recognised by shape, not by source. A
 * principal-only debit is a prepayment; a credit is the loan itself (the
 * first one) or a top-up.
 */
export function entryKind(e: LoanLedgerEntry, isFirstCredit: boolean): LoanEntryKind {
  if (e.loanDebitPaise > e.loanCreditPaise) {
    if (e.sourceType === LOAN_PREPAYMENT_SOURCE) return "prepayment";
    if (e.sourceType === LOAN_EMI_SOURCE || e.interestPaise > 0) return "emi";
    return "prepayment";
  }
  if (e.loanCreditPaise > e.loanDebitPaise) return isFirstCredit ? "disbursal" : "topup";
  return "other";
}

/** A month named in a source id ("10876691:2026-09-10", "2150:2026-11"). */
export function monthFromSourceId(sourceId: string): string {
  const m = /:(\d{4}-\d{2})(?:-\d{2})?$/.exec(sourceId || "");
  return m && isMonth(m[1]) ? m[1]! : "";
}

/**
 * The first month an EMI is owed in the books: the first instalment month,
 * or — for a loan brought in by an opening balance — the first month whose
 * due date falls after that opening.
 */
export function startMonthFor(terms: Pick<LoanTerms, "firstInstalmentDate" | "dueDay">, anchorDate: string): string {
  let m = monthOf(terms.firstInstalmentDate);
  if (!isIsoDate(anchorDate)) return m;
  for (let i = 0; i < 600 && dueDateIn(m, terms.dueDay) <= anchorDate; i++) m = addMonths(m, 1);
  return m;
}

/**
 * Which instalment month each EMI voucher pays.
 *
 * A voucher whose source id names a month claims it. The rest, oldest
 * first, take the earliest month not yet claimed, from the start month up
 * to the month after the voucher's own — so an October EMI cleared on 2
 * November is October's (never letting October be proposed again), and a
 * November EMI paid on 30 October is November's.
 */
export function assignEmiMonths(
  emis: readonly { voucherId: string; date: string; sourceId: string }[],
  startMonth: string,
): Map<string, string> {
  const out = new Map<string, string>();
  const claimed = new Set<string>();
  for (const e of emis) {
    const m = monthFromSourceId(e.sourceId);
    if (m && m >= startMonth && !claimed.has(m)) {
      out.set(e.voucherId, m);
      claimed.add(m);
    }
  }
  const rest = emis.filter((e) => !out.has(e.voucherId)).sort((a, b) => a.date.localeCompare(b.date) || a.voucherId.localeCompare(b.voucherId));
  for (const e of rest) {
    const limit = addMonths(monthOf(e.date), 1);
    for (let m = startMonth; m <= limit; m = addMonths(m, 1)) {
      if (!claimed.has(m)) {
        out.set(e.voucherId, m);
        claimed.add(m);
        break;
      }
    }
  }
  return out;
}

/* ─── Interest ────────────────────────────────────────────── */

/** A change to the principal owed, effective on a date. */
export type BalanceEvent = { date: string; deltaPaise: number };

export function roundInterest(rawPaise: number, rounding: "paisa" | "rupee"): number {
  return rounding === "rupee" ? Math.round(rawPaise / 100) * 100 : Math.round(rawPaise);
}

/**
 * Interest for the period (from, to]: the principal owed, day by day, ×
 * rate × days ÷ 365, rounded once. Events dated on or before `from` are the
 * opening of the period; one inside it starts a new balance from its date.
 * With no change inside the period this is exactly
 * round(balance × rate × days ÷ 365).
 */
export function periodInterest(input: {
  events: readonly BalanceEvent[];
  from: string;
  to: string;
  annualRatePct: number;
  rounding: "paisa" | "rupee";
}): { interestPaise: number; openingPaise: number; days: number } {
  const days = daysBetween(input.from, input.to);
  let bal = 0;
  const inside: BalanceEvent[] = [];
  for (const e of input.events) {
    if (e.date <= input.from) bal += e.deltaPaise;
    else if (e.date < input.to) inside.push(e);
  }
  const opening = bal;
  inside.sort((a, b) => a.date.localeCompare(b.date));
  let raw = 0;
  let cursor = input.from;
  for (const e of inside) {
    raw += (Math.max(0, bal) * input.annualRatePct * daysBetween(cursor, e.date)) / 100 / 365;
    bal += e.deltaPaise;
    cursor = e.date;
  }
  raw += (Math.max(0, bal) * input.annualRatePct * daysBetween(cursor, input.to)) / 100 / 365;
  return { interestPaise: days > 0 ? roundInterest(raw, input.rounding) : 0, openingPaise: opening, days };
}

/* ─── The loan, assembled ─────────────────────────────────── */

export type LoanHistoryRow = {
  voucherId: string;
  voucherNo: string;
  date: string;
  kind: LoanEntryKind;
  /** Instalment month an EMI pays ("" for anything else). */
  month: string;
  /** EMI number from the terms (0 = unknown). */
  emiNo: number;
  principalPaise: number;
  interestPaise: number;
  /** Money in (loan credited: disbursal / top-up). */
  creditPaise: number;
  balancePaise: number;
  narration: string;
};

export type EmiProposal = {
  key: string;
  code: string;
  month: string;
  emiNo: number;
  dueOn: string;
  /** Interest runs from here (previous due date, or the sanction date for EMI 1). */
  interestFrom: string;
  days: number;
  openingPaise: number;
  amountPaise: number;
  principalPaise: number;
  interestPaise: number;
  /** The last instalment: what is left plus its interest, not the usual EMI. */
  isFinal: boolean;
  paidFrom: LoanPaidFrom;
};

export type ProjectionRow = EmiProposal & { closingPaise: number; status: "awaiting_approval" | "projection" };

export type LoanSkip = { key: string; code: string; month: string; reason: string; by: string; at: string };

export type LoanComputed = {
  outstandingPaise: number;
  history: LoanHistoryRow[];
  /** Due and not in the books, not skipped — awaiting approval, oldest first. */
  pending: EmiProposal[];
  /** Pending, then the rest to the end. Labelled projection. */
  projection: ProjectionRow[];
  nextDueOn: string;
  lastPaid: { voucherNo: string; date: string; amountPaise: number } | null;
  startMonth: string;
  anchorDate: string;
  originalPaise: number;
  principalPaidPaise: number;
  interestPaidPaise: number;
  prepaidPaise: number;
  toppedUpPaise: number;
  skipped: LoanSkip[];
  warnings: string[];
};

const MAX_PENDING = 24;
const MAX_PROJECTION = 600;

export function computeLoan(input: {
  code: string;
  entries: readonly LoanLedgerEntry[];
  terms: LoanTerms | null;
  today: string;
  skips: Readonly<Record<string, LoanSkip>>;
}): LoanComputed {
  const warnings: string[] = [];
  const live = input.entries.filter((e) => !e.cancelled).sort((a, b) => a.date.localeCompare(b.date) || a.voucherNo.localeCompare(b.voucherNo));
  const firstCredit = live.find((e) => e.loanCreditPaise > e.loanDebitPaise) ?? null;
  const anchorDate = firstCredit?.date ?? "";
  const kinds = new Map(live.map((e) => [e.voucherId, entryKind(e, e === firstCredit)]));
  const terms = input.terms;
  const startMonth = terms && isIsoDate(terms.firstInstalmentDate) ? startMonthFor(terms, anchorDate) : "";
  const emis = live.filter((e) => kinds.get(e.voucherId) === "emi");
  const months = startMonth ? assignEmiMonths(emis, startMonth) : new Map<string, string>();
  const firstMonth = terms?.firstInstalmentDate ? monthOf(terms.firstInstalmentDate) : "";

  let bal = 0;
  let principalPaid = 0;
  let interestPaid = 0;
  let prepaid = 0;
  let toppedUp = 0;
  const history: LoanHistoryRow[] = live.map((e) => {
    const kind = kinds.get(e.voucherId) ?? "other";
    const net = e.loanCreditPaise - e.loanDebitPaise;
    bal += net;
    const month = kind === "emi" ? (months.get(e.voucherId) ?? "") : "";
    if (kind === "emi") {
      principalPaid += -net;
      interestPaid += e.interestPaise;
    } else if (kind === "prepayment") prepaid += -net;
    else if (kind === "topup") toppedUp += net;
    return {
      voucherId: e.voucherId,
      voucherNo: e.voucherNo,
      date: e.date,
      kind,
      month,
      emiNo: month && firstMonth ? monthDiff(firstMonth, month) + 1 : 0,
      principalPaise: net < 0 ? -net : 0,
      interestPaise: kind === "emi" ? e.interestPaise : 0,
      creditPaise: net > 0 ? net : 0,
      balancePaise: bal,
      narration: e.narration,
    };
  });
  const outstanding = bal;

  // Balance events for interest: an EMI's principal falls on its due date
  // (the lender's view — a cheque cleared a week late still paid that
  // instalment); everything else on its own date; the loan's first credit
  // from the start of time (an opening balance stands for every earlier day).
  const events: BalanceEvent[] = live.map((e) => {
    const delta = e.loanCreditPaise - e.loanDebitPaise;
    if (e === firstCredit) return { date: "0000-01-01", deltaPaise: delta };
    const m = months.get(e.voucherId);
    return { date: m && terms ? dueDateIn(m, terms.dueDay) : e.date, deltaPaise: delta };
  });

  const skipped = Object.values(input.skips).filter((k) => k.code === input.code);
  const skippedMonths = new Set(skipped.map((k) => k.month));
  const claimedMonths = new Set(months.values());
  const pending: EmiProposal[] = [];
  const projection: ProjectionRow[] = [];
  let nextDueOn = "";

  if (!terms) {
    if (outstanding > 0) warnings.push("No terms for this loan — EMIs cannot be proposed until its terms are saved.");
  } else if (!startMonth) {
    warnings.push("The first instalment date is not recorded — EMIs cannot be proposed.");
  } else if (outstanding > 0 && terms.active) {
    const lastMonth = terms.lastInstalmentDate ? monthOf(terms.lastInstalmentDate) : "";
    let running = outstanding;
    // Months still owed, in order. Projected principal is applied to the
    // running events so each month's interest uses the balance after the last.
    const chain: BalanceEvent[] = [...events];
    for (let i = 0, m = startMonth; i < MAX_PROJECTION + 240 && running > 0; i++, m = addMonths(m, 1)) {
      if (lastMonth && m > lastMonth) break;
      if (claimedMonths.has(m)) continue;
      if (skippedMonths.has(m)) continue;
      const dueOn = dueDateIn(m, terms.dueDay);
      const isDue = dueOn <= input.today;
      const from =
        m === firstMonth && terms.sanctionedOn
          ? terms.sanctionedOn
          : m === firstMonth && anchorDate
            ? anchorDate
            : dueDateIn(addMonths(m, -1), terms.dueDay);
      const p = periodInterest({ events: chain, from, to: dueOn, annualRatePct: terms.annualRatePct, rounding: terms.interestRounding });
      // Outstanding principal on the due date (after anything paid inside the period).
      const owed = chain.filter((e) => e.date < dueOn).reduce((n, e) => n + e.deltaPaise, 0);
      const isFinal = owed + p.interestPaise <= terms.emiPaise || (!!lastMonth && m === lastMonth);
      const principal = isFinal ? Math.max(0, owed) : Math.max(0, terms.emiPaise - p.interestPaise);
      const proposal: EmiProposal = {
        key: `${input.code}:${m}`,
        code: input.code,
        month: m,
        emiNo: firstMonth ? monthDiff(firstMonth, m) + 1 : 0,
        dueOn,
        interestFrom: from,
        days: p.days,
        openingPaise: owed,
        amountPaise: principal + p.interestPaise,
        principalPaise: principal,
        interestPaise: p.interestPaise,
        isFinal,
        paidFrom: terms.paidFrom,
      };
      if (isDue) {
        if (pending.length >= MAX_PENDING) {
          warnings.push(`More than ${MAX_PENDING} months are unposted — check the terms' first instalment date before approving.`);
          break;
        }
        pending.push(proposal);
      } else if (!nextDueOn) nextDueOn = dueOn;
      if (projection.length < MAX_PROJECTION) {
        projection.push({ ...proposal, closingPaise: owed - principal, status: isDue ? "awaiting_approval" : "projection" });
      }
      chain.push({ date: dueOn, deltaPaise: -principal });
      running = owed - principal;
      if (isFinal) break;
    }
  }

  const emiRows = history.filter((h) => h.kind === "emi" || h.kind === "prepayment");
  const last = emiRows[emiRows.length - 1] ?? null;
  return {
    outstandingPaise: outstanding,
    history,
    pending,
    projection,
    nextDueOn,
    lastPaid: last ? { voucherNo: last.voucherNo, date: last.date, amountPaise: last.principalPaise + last.interestPaise } : null,
    startMonth,
    anchorDate,
    originalPaise: terms?.sanctionedPaise || firstCredit?.loanCreditPaise || 0,
    principalPaidPaise: principalPaid,
    interestPaidPaise: interestPaid,
    prepaidPaise: prepaid,
    toppedUpPaise: toppedUp,
    skipped,
    warnings,
  };
}

/* ─── Posting ─────────────────────────────────────────────── */

/** "58908" → "58,908"; with paise "58,908.50". Indian grouping. */
export function rupees(paiseAmt: number): string {
  const neg = paiseAmt < 0;
  const abs = Math.abs(Math.round(paiseAmt));
  const r = Math.floor(abs / 100);
  const p = abs % 100;
  const str = String(r);
  const last3 = str.slice(-3);
  const rest = str.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  const grouped = rest ? `${rest},${last3}` : last3;
  return `${neg ? "-" : ""}${grouped}${p ? `.${String(p).padStart(2, "0")}` : ""}`;
}
/** Plain figure as the EMI narrations write it: 43599.04, 8543. */
function plain(paiseAmt: number): string {
  const r = Math.round(paiseAmt);
  return r % 100 === 0 ? String(r / 100) : (r / 100).toFixed(2);
}

/** "UBI -Main · Union Bank of India 5371" → "UBI -Main". */
export function shortAccountName(name: string): string {
  return (name.split(" · ")[0] ?? name).trim() || name;
}

export function howPaid(input: { mode: PayMode; accountName: string; ref: string; party: LoanParty | null; date: string; dueOn?: string }): string {
  const bank = shortAccountName(input.accountName);
  const ref = input.ref.trim();
  switch (input.mode) {
    case "nach":
      return `NACH auto-debit from ${bank}${ref ? `, ACH ref ${ref}` : ""}.`;
    case "cheque":
      return `Cheque${ref ? ` ${ref}` : ""} from ${bank}${input.dueOn && input.date !== input.dueOn ? `, cleared ${input.date}` : ""}.`;
    case "bank_transfer":
      return `Bank transfer from ${bank}${ref ? `, ref ${ref}` : ""}.`;
    case "upi":
      return `UPI from ${bank}${ref ? `, UTR ${ref}` : ""}.`;
    case "cash":
      return `Paid in cash from the cash box${ref ? ` (${ref})` : ""}.`;
    case "trustee_personal":
      return `Paid by trustee ${input.party?.name || "(trustee)"} from his own account, so the trust owes him.`;
  }
}

/** What the screen says under a paid-from choice. */
export function paidFromLabel(pf: LoanPaidFrom, accountName: string): string {
  if (pf.mode === "trustee_personal") return `Paid by trustee ${pf.party?.name || "(name the trustee)"} — added to his loan to the trust`;
  return `${PAY_MODE_LABELS[pf.mode]} · ${pf.accountCode} ${shortAccountName(accountName)}`;
}

export type MoneyAccount = { code: string; name: string; bankAccountId: string };

export type EmiApproval = {
  code: string;
  month: string;
  date: string;
  amountPaise: number;
  principalPaise: number;
  interestPaise: number;
  accountCode: string;
  mode: PayMode;
  ref: string;
  party: LoanParty | null;
};

/** Is an approver's edited EMI acceptable? First problem, or null. */
export function emiApprovalProblem(a: EmiApproval, input: { today: string; outstandingPaise: number; accountExists: (c: string) => boolean }): string | null {
  if (!isIsoDate(a.date)) return "Enter the date the EMI was paid";
  if (a.date > input.today) return "The EMI date cannot be in the future — approve it on or after the day it is paid";
  for (const [n, v] of [["amount", a.amountPaise], ["principal", a.principalPaise], ["interest", a.interestPaise]] as const) {
    if (!Number.isInteger(v) || v < 0) return `The ${n} must be a whole number of paise, not negative`;
  }
  if (!(a.amountPaise > 0)) return "The EMI amount must be more than zero";
  if (a.principalPaise + a.interestPaise !== a.amountPaise) {
    return `Principal ${rupees(a.principalPaise)} + interest ${rupees(a.interestPaise)} = ${rupees(a.principalPaise + a.interestPaise)}, not the ${rupees(a.amountPaise)} paid`;
  }
  if (a.principalPaise > input.outstandingPaise) return `Principal ${rupees(a.principalPaise)} is more than the ${rupees(input.outstandingPaise)} still owed`;
  return paidFromProblem({ accountCode: a.accountCode, mode: a.mode, party: a.party }, input.accountExists);
}

function moneyLine(input: {
  accountCode: string;
  amountPaise: number;
  side: "debit" | "credit";
  mode: PayMode;
  ref: string;
  date: string;
  party: LoanParty | null;
  bankAccountId: string;
  narration?: string;
}): LedgerLineInput {
  return {
    accountCode: input.accountCode,
    debitPaise: input.side === "debit" ? input.amountPaise : 0,
    creditPaise: input.side === "credit" ? input.amountPaise : 0,
    ...(input.narration ? { narration: input.narration } : {}),
    ...(input.bankAccountId ? { subledgerKind: "bank_account" as const, subledgerId: input.bankAccountId } : {}),
    ...(input.party ? { party: { kind: input.party.kind, externalId: input.party.externalId, name: input.party.name } } : {}),
    instrument: { mode: input.mode, ref: input.ref.slice(0, 80), date: input.date },
  };
}

export function emiNarration(input: {
  emiNo: number;
  terms: Pick<LoanTerms, "lender" | "contractNo">;
  vehicleLabel: string;
  dueOn: string;
  a: EmiApproval;
  accountName: string;
}): string {
  const lender = input.terms.lender.replace(/\s+Finance$/i, "") || "lender";
  const what = `${input.emiNo > 0 ? `EMI ${input.emiNo}` : `EMI for ${monthLabel(input.a.month)}`} on ${lender} contract ${input.terms.contractNo || "?"}${input.vehicleLabel ? ` (${input.vehicleLabel})` : ""}`;
  const due = input.a.date !== input.dueOn ? `, due ${input.dueOn}` : "";
  return `${what}${due} — ${rupees(input.a.amountPaise)}, of which principal ${plain(input.a.principalPaise)} and interest ${plain(input.a.interestPaise)}. ${howPaid({
    mode: input.a.mode,
    accountName: input.accountName,
    ref: input.a.ref,
    party: input.a.party,
    date: input.a.date,
    dueOn: input.dueOn,
  })}`.slice(0, 480);
}

/** Dr loan (principal) + Dr 5090 (interest) / Cr where the money came from. */
export function emiLines(a: EmiApproval, money: MoneyAccount | null, interestCode = LOAN_INTEREST_CODE): LedgerLineInput[] {
  const lines: LedgerLineInput[] = [];
  if (a.principalPaise > 0) lines.push({ accountCode: a.code, debitPaise: a.principalPaise, creditPaise: 0 });
  if (a.interestPaise > 0) lines.push({ accountCode: interestCode, debitPaise: a.interestPaise, creditPaise: 0 });
  lines.push(
    moneyLine({
      accountCode: a.accountCode,
      amountPaise: a.amountPaise,
      side: "credit",
      mode: a.mode,
      ref: a.ref,
      date: a.date,
      party: a.accountCode === TRUSTEE_LOAN_CODE ? a.party : null,
      bankAccountId: money?.bankAccountId ?? "",
    }),
  );
  return lines;
}

/* ─── Prepayments and top-ups (requests needing approval) ─── */

export type LoanRequestKind = "prepayment" | "topup";
export type LoanRequestStatus = "pending" | "posted" | "rejected";

export type LoanRequest = {
  id: string;
  code: string;
  kind: LoanRequestKind;
  date: string;
  amountPaise: number;
  /** Prepayment: paid FROM this account. Top-up: the money went TO this account. */
  accountCode: string;
  mode: PayMode;
  ref: string;
  party: LoanParty | null;
  note: string;
  status: LoanRequestStatus;
  requestedBy: string;
  requestedAt: string;
  decidedBy: string;
  decidedAt: string;
  decisionNote: string;
  voucherNo: string;
  voucherId: string;
};

export type LoanQueueState = {
  skips: Record<string, LoanSkip>;
  requests: LoanRequest[];
  /** Loan-month keys (and `req:<id>`) the approvers have been told about. */
  notified: Record<string, string>;
};

export function normalizeLoanQueue(raw: unknown): LoanQueueState {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const skips: Record<string, LoanSkip> = {};
  if (r.skips && typeof r.skips === "object") {
    for (const [key, v] of Object.entries(r.skips as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const x = v as Record<string, unknown>;
      const [code, month] = key.split(":");
      if (!code || !isMonth(month)) continue;
      skips[key] = { key, code, month, reason: s(x.reason, 300), by: s(x.by, 120), at: s(x.at, 40) };
    }
  }
  const requests: LoanRequest[] = [];
  const seen = new Set<string>();
  for (const v of Array.isArray(r.requests) ? r.requests : []) {
    if (!v || typeof v !== "object") continue;
    const x = v as Record<string, unknown>;
    const id = s(x.id, 80);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    requests.push({
      id,
      code: s(x.code, 20),
      kind: x.kind === "topup" ? "topup" : "prepayment",
      date: isIsoDate(x.date) ? x.date : "",
      amountPaise: paise(x.amountPaise),
      accountCode: s(x.accountCode, 20),
      mode: isPayMode(x.mode) ? x.mode : "bank_transfer",
      ref: s(x.ref, 80),
      party: normalizeParty(x.party),
      note: s(x.note, 300),
      status: x.status === "posted" ? "posted" : x.status === "rejected" ? "rejected" : "pending",
      requestedBy: s(x.requestedBy, 120),
      requestedAt: s(x.requestedAt, 40),
      decidedBy: s(x.decidedBy, 120),
      decidedAt: s(x.decidedAt, 40),
      decisionNote: s(x.decisionNote, 300),
      voucherNo: s(x.voucherNo, 60),
      voucherId: s(x.voucherId, 80),
    });
  }
  const notified: Record<string, string> = {};
  if (r.notified && typeof r.notified === "object") {
    for (const [k, v] of Object.entries(r.notified as Record<string, unknown>)) if (k) notified[k] = s(v, 40);
  }
  return { skips, requests, notified };
}

export type LoanRequestInput = Pick<LoanRequest, "code" | "kind" | "date" | "amountPaise" | "accountCode" | "mode" | "ref" | "party" | "note">;

export function loanRequestProblem(
  r: LoanRequestInput,
  input: { today: string; outstandingPaise: number; accountExists: (c: string) => boolean },
): string | null {
  if (!isIsoDate(r.date)) return "Enter the date";
  if (r.date > input.today) return "The date cannot be in the future";
  if (!Number.isInteger(r.amountPaise) || !(r.amountPaise > 0)) return "Enter the amount";
  if (r.kind === "prepayment") {
    if (r.amountPaise > input.outstandingPaise) return `That is more than the ${rupees(input.outstandingPaise)} still owed`;
    return paidFromProblem({ accountCode: r.accountCode, mode: r.mode, party: r.party }, input.accountExists);
  }
  if (!r.accountCode) return "Choose where the additional loan went (a bank, or 1950 for the dealer)";
  if (!input.accountExists(r.accountCode)) return `${r.accountCode} is not an account in the books`;
  if (r.accountCode === r.code) return "The money cannot go to the loan account itself";
  return null;
}

/** Prepayment: Dr loan (principal only) / Cr paid-from. Top-up: Dr where it went / Cr loan. */
export function requestLines(r: LoanRequest, money: MoneyAccount | null): LedgerLineInput[] {
  if (r.kind === "prepayment") {
    return [
      { accountCode: r.code, debitPaise: r.amountPaise, creditPaise: 0 },
      moneyLine({
        accountCode: r.accountCode,
        amountPaise: r.amountPaise,
        side: "credit",
        mode: r.mode,
        ref: r.ref,
        date: r.date,
        party: r.accountCode === TRUSTEE_LOAN_CODE ? r.party : null,
        bankAccountId: money?.bankAccountId ?? "",
      }),
    ];
  }
  return [
    moneyLine({
      accountCode: r.accountCode,
      amountPaise: r.amountPaise,
      side: "debit",
      mode: r.mode,
      ref: r.ref,
      date: r.date,
      party: null,
      bankAccountId: money?.bankAccountId ?? "",
    }),
    { accountCode: r.code, debitPaise: 0, creditPaise: r.amountPaise },
  ];
}

export function requestNarration(r: LoanRequest, terms: Pick<LoanTerms, "lender" | "contractNo"> | null, vehicleLabel: string, accountName: string): string {
  const lender = (terms?.lender || "lender").replace(/\s+Finance$/i, "");
  const loan = `${lender} contract ${terms?.contractNo || r.code}${vehicleLabel ? ` (${vehicleLabel})` : ""}`;
  const tail = r.note ? ` ${r.note}` : "";
  if (r.kind === "prepayment") {
    return `Part-prepayment of ${rupees(r.amountPaise)} on ${loan} — principal only. ${howPaid({ mode: r.mode, accountName, ref: r.ref, party: r.party, date: r.date })}${tail}`.slice(0, 480);
  }
  return `Additional loan (top-up disbursal) of ${rupees(r.amountPaise)} on ${loan}, received into ${r.accountCode} ${shortAccountName(accountName)}${r.ref ? `, ref ${r.ref}` : ""}.${tail}`.slice(0, 480);
}

/* ─── New loan ────────────────────────────────────────────── */

/** The next free loan code after the existing ones (2155…2199). "" = none left. */
export function nextLoanCode(existing: ReadonlySet<string>): string {
  for (let c = 2155; c <= 2199; c++) if (!existing.has(String(c))) return String(c);
  return "";
}

/** Booking: Dr where the money went (sanctioned − charges) + Dr 5090 charges / Cr the loan. */
export function bookingLines(input: { code: string; sanctionedPaise: number; chargesPaise: number; debitCode: string; interestCode?: string }): LedgerLineInput[] {
  const net = input.sanctionedPaise - input.chargesPaise;
  const lines: LedgerLineInput[] = [];
  if (net > 0) lines.push({ accountCode: input.debitCode, debitPaise: net, creditPaise: 0, narration: "Loan amount paid out" });
  if (input.chargesPaise > 0) lines.push({ accountCode: input.interestCode ?? LOAN_INTEREST_CODE, debitPaise: input.chargesPaise, creditPaise: 0, narration: "Loan charges" });
  lines.push({ accountCode: input.code, debitPaise: 0, creditPaise: input.sanctionedPaise, narration: "Loan sanctioned" });
  return lines;
}

/* ─── Export ──────────────────────────────────────────────── */

export type LoanExportRow = {
  code: string;
  vehicle: string;
  contract: string;
  date: string;
  month: string;
  type: string;
  voucherNo: string;
  emiNo: number | "";
  principalPaise: number;
  interestPaise: number;
  prepaymentPaise: number;
  topupPaise: number;
  balancePaise: number;
  status: string;
};

/** History (and optionally projection) rows of the chosen loans inside [fromMonth, toMonth]. */
export function loanExportRows(
  loans: readonly { code: string; vehicle: string; contract: string; computed: Pick<LoanComputed, "history" | "projection"> }[],
  opts: { fromMonth: string; toMonth: string; projection: boolean },
): LoanExportRow[] {
  const out: LoanExportRow[] = [];
  const inRange = (m: string) => (!opts.fromMonth || m >= opts.fromMonth) && (!opts.toMonth || m <= opts.toMonth);
  for (const l of loans) {
    for (const h of l.computed.history) {
      const m = monthOf(h.date);
      if (!inRange(m)) continue;
      out.push({
        code: l.code,
        vehicle: l.vehicle,
        contract: l.contract,
        date: h.date,
        month: m,
        type: h.kind === "emi" ? "EMI" : h.kind === "prepayment" ? "Prepayment" : h.kind === "topup" ? "Top-up (additional loan)" : h.kind === "disbursal" ? "Loan / opening" : "Other",
        voucherNo: h.voucherNo,
        emiNo: h.emiNo || "",
        principalPaise: h.kind === "emi" ? h.principalPaise : 0,
        interestPaise: h.interestPaise,
        prepaymentPaise: h.kind === "prepayment" ? h.principalPaise : 0,
        topupPaise: h.kind === "topup" ? h.creditPaise : 0,
        balancePaise: h.balancePaise,
        status: "Posted",
      });
    }
    if (opts.projection) {
      for (const p of l.computed.projection) {
        if (!inRange(p.month)) continue;
        out.push({
          code: l.code,
          vehicle: l.vehicle,
          contract: l.contract,
          date: p.dueOn,
          month: p.month,
          type: "EMI",
          voucherNo: "",
          emiNo: p.emiNo || "",
          principalPaise: p.principalPaise,
          interestPaise: p.interestPaise,
          prepaymentPaise: 0,
          topupPaise: 0,
          balancePaise: p.closingPaise,
          status: p.status === "awaiting_approval" ? "Awaiting approval" : "Projection",
        });
      }
    }
  }
  return out.sort((a, b) => a.code.localeCompare(b.code) || a.date.localeCompare(b.date));
}

export type LoanTotalsRow = { key: string; label: string; principalPaise: number; interestPaise: number; prepaymentPaise: number; topupPaise: number };

/** Totals of principal, interest, prepayments and top-ups, grouped. */
export function loanTotals(rows: readonly LoanExportRow[], by: "vehicle" | "month"): LoanTotalsRow[] {
  const map = new Map<string, LoanTotalsRow>();
  for (const r of rows) {
    const key = by === "vehicle" ? r.code : r.month;
    const label = by === "vehicle" ? `${r.code} ${r.vehicle || r.contract}`.trim() : monthLabel(r.month);
    const t = map.get(key) ?? { key, label, principalPaise: 0, interestPaise: 0, prepaymentPaise: 0, topupPaise: 0 };
    t.principalPaise += r.principalPaise;
    t.interestPaise += r.interestPaise;
    t.prepaymentPaise += r.prepaymentPaise;
    t.topupPaise += r.topupPaise;
    map.set(key, t);
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}
