/**
 * Finding a voucher in the book, and deciding which ones are not yet
 * classified to a real head.
 *
 * WHY THIS EXISTS
 * The book's voucher table showed the newest 50 by creation time. That is a
 * fine "what just happened" list and useless for "where is the March import"
 * — 398 old-ERP vouchers posted on one day in September sit behind hundreds
 * of fee receipts, so the only way to see them was to read the database.
 *
 * WHAT "NEEDS A HEAD" MEANS HERE
 * Every line already HAS an account: double entry cannot post without one,
 * and there is not a single null in the book. So the question is never
 * "which line has no head" — it is "which line was parked on a head that
 * says nothing". Two ways that happens, and both are derived from the chart
 * rather than from a list somebody typed:
 *
 *   1. A catch-all head — Other Expenses, Other Income, Suspense. The name
 *      itself is the admission that the classification is unfinished.
 *   2. A parent head that has sub-heads. Booking to "Refreshment" when
 *      "Refreshment → Milk Expenses" exists loses the detail the sub-head
 *      was created to capture.
 *
 * Cash, bank and control accounts are never flagged. "Paid from UBI-Main" is
 * not a classification problem, and moving it would misstate the bank.
 */

export type VoucherLineFacts = {
  accountCode: string;
  accountName: string;
  partyName: string;
  debitPaise: number;
  creditPaise: number;
};

export type VoucherFacts = {
  id: string;
  voucherNo: string;
  voucherType: string;
  date: string;
  narration: string;
  createdBy: string;
  sourceType: string;
  /** True when another voucher reverses this one. */
  reversed: boolean;
  /** True when this voucher is itself a reversal of another. */
  isReversal: boolean;
  lines: VoucherLineFacts[];
};

export type ChartAccount = {
  code: string;
  name: string;
  parentCode?: string;
  isCash?: boolean;
  isBank?: boolean;
  isControl?: boolean;
};

/** Heads whose own name says the classification is unfinished. */
const CATCH_ALL_NAME = /\b(other|others|misc|miscellaneous|sundry|suspense|unclassified|general)\b/i;

/**
 * Group headings ("5 Expenditure") are not postable and never appear on a
 * line, so they are not the concern here — a head with CHILDREN is.
 */
export function childCodesByParent(chart: ChartAccount[]): Map<string, string[]> {
  const byParent = new Map<string, string[]>();
  for (const a of chart) {
    if (!a.parentCode) continue;
    const list = byParent.get(a.parentCode) ?? [];
    list.push(a.code);
    byParent.set(a.parentCode, list);
  }
  return byParent;
}

export type HeadGap =
  | { kind: "catch_all"; code: string; name: string; detail: string }
  | { kind: "parent_with_subheads"; code: string; name: string; detail: string; subHeads: string[] };

/**
 * Why this one line is unclassified, or null when it is fine.
 *
 * Only income and expenditure are judged. A balance-sheet line is where the
 * money sat, not what it was for, and "Cash in Hand" is a complete answer.
 */
export function headGapForLine(
  line: { accountCode: string },
  chart: ChartAccount[],
  byParent = childCodesByParent(chart),
): HeadGap | null {
  const a = chart.find((c) => c.code === line.accountCode);
  if (!a) return null;
  if (a.isCash || a.isBank || a.isControl) return null;
  // Income (4…) and Expenditure (5…) are the only heads that classify a
  // transaction. Assets and liabilities describe where it rests.
  const top = a.code.charAt(0);
  if (top !== "4" && top !== "5") return null;

  const children = byParent.get(a.code) ?? [];
  if (children.length > 0) {
    return {
      kind: "parent_with_subheads",
      code: a.code,
      name: a.name,
      subHeads: children,
      detail: `${a.name} has ${children.length} sub-head${children.length === 1 ? "" : "s"} — this was booked to the parent, so the detail is lost`,
    };
  }
  if (CATCH_ALL_NAME.test(a.name)) {
    return {
      kind: "catch_all",
      code: a.code,
      name: a.name,
      detail: `${a.name} is a catch-all — the real head was never chosen`,
    };
  }
  return null;
}

/**
 * Vouchers the payroll run writes itself. Their salary line belongs on the
 * parent head: regular pay IS "Salary & Wages", and the sub-heads the office
 * adds under it (extra work, corrections, inactive staff) are for the odd
 * payment keyed by hand. Flagging every payroll voucher once a sub-head
 * exists asked the office to reclassify what was already right (13 Oct 2026).
 */
const PAYROLL_SOURCES = new Set(["payroll_run", "payroll_payment"]);

/** Every unclassified line on this voucher, by line index. */
export function headGaps(
  v: VoucherFacts,
  chart: ChartAccount[],
  byParent = childCodesByParent(chart),
): { index: number; line: VoucherLineFacts; gap: HeadGap }[] {
  const out: { index: number; line: VoucherLineFacts; gap: HeadGap }[] = [];
  const fromPayroll = PAYROLL_SOURCES.has(v.sourceType);
  v.lines.forEach((line, index) => {
    const gap = headGapForLine(line, chart, byParent);
    if (!gap) return;
    if (fromPayroll && gap.kind === "parent_with_subheads") return;
    out.push({ index, line, gap });
  });
  return out;
}

/* ─── Filtering ─────────────────────────────────────────────── */

export type VoucherFilter = {
  /** Matches voucher number, narration, party or account name. */
  q?: string;
  from?: string;
  to?: string;
  voucherType?: string;
  sourceType?: string;
  /** An account code any line must sit on. */
  accountCode?: string;
  /** Any line on any of these heads (a view such as "Vehicle loans" spans three). */
  accountCodes?: string[];
  /** Any line on a head whose code starts with this — "5" is every expense head. */
  accountPrefix?: string;
  /** Skip vouchers that touch any of these heads (Expenses without Salary). */
  excludeAccountCodes?: string[];
  /** Skip vouchers from these sources (fee receipts, store sales…). */
  excludeSourceTypes?: string[];
  /** A party name any line must carry (substring, case-insensitive). */
  party?: string;
  minPaise?: number;
  maxPaise?: number;
  status?: "all" | "live" | "reversed" | "reversal";
  /** Only vouchers with at least one unclassified line. */
  needsHead?: boolean;
  /** Only vouchers with an income/expenditure line carrying no party. */
  needsParty?: boolean;
};

const norm = (s: string) => s.toLowerCase().trim();

/** The larger of the two sides — a voucher's headline amount. */
export function voucherAmountPaise(v: VoucherFacts): number {
  const dr = v.lines.reduce((n, l) => n + l.debitPaise, 0);
  const cr = v.lines.reduce((n, l) => n + l.creditPaise, 0);
  return Math.max(dr, cr);
}

export function matchesVoucherFilter(
  v: VoucherFacts,
  f: VoucherFilter,
  chart: ChartAccount[],
  byParent = childCodesByParent(chart),
): boolean {
  if (f.q) {
    const q = norm(f.q);
    const hay = [
      v.voucherNo,
      v.narration,
      v.sourceType,
      v.createdBy,
      ...v.lines.map((l) => `${l.accountCode} ${l.accountName} ${l.partyName}`),
    ]
      .join(" ")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (f.from && v.date < f.from) return false;
  if (f.to && v.date > f.to) return false;
  if (f.voucherType && v.voucherType !== f.voucherType) return false;
  if (f.sourceType) {
    // "manual" is how the UI names a voucher with no source; the book stores "".
    const src = v.sourceType || "manual";
    if (src !== f.sourceType) return false;
  }
  if (f.accountCode && !v.lines.some((l) => l.accountCode === f.accountCode)) return false;
  if (f.accountCodes?.length && !v.lines.some((l) => f.accountCodes!.includes(l.accountCode))) return false;
  if (f.accountPrefix && !v.lines.some((l) => l.accountCode.startsWith(f.accountPrefix!))) return false;
  if (f.excludeAccountCodes?.length && v.lines.some((l) => f.excludeAccountCodes!.includes(l.accountCode))) return false;
  if (f.excludeSourceTypes?.length && f.excludeSourceTypes.includes(v.sourceType || "manual")) return false;
  if (f.party) {
    const p = norm(f.party);
    if (!v.lines.some((l) => norm(l.partyName).includes(p))) return false;
  }
  if (f.minPaise != null || f.maxPaise != null) {
    const amt = voucherAmountPaise(v);
    if (f.minPaise != null && amt < f.minPaise) return false;
    if (f.maxPaise != null && amt > f.maxPaise) return false;
  }
  switch (f.status) {
    case "live":
      if (v.reversed || v.isReversal) return false;
      break;
    case "reversed":
      if (!v.reversed) return false;
      break;
    case "reversal":
      if (!v.isReversal) return false;
      break;
    default:
      break;
  }
  if (f.needsHead && headGaps(v, chart, byParent).length === 0) return false;
  if (f.needsParty) {
    const missing = v.lines.some(
      (l) =>
        (l.accountCode.startsWith("4") || l.accountCode.startsWith("5")) &&
        !l.partyName.trim(),
    );
    if (!missing) return false;
  }
  return true;
}

/* ─── The reclassification a fix would post ─────────────────── */

export type ReclassPlan = {
  ok: boolean;
  error?: string;
  /** Debit the new head, credit the old one — or the mirror, for a credit line. */
  lines?: { accountCode: string; debitPaise: number; creditPaise: number; narration: string }[];
  narration?: string;
};

/**
 * Moving a line from one head to another.
 *
 * The book is append-only — a reversal is the record, and nothing rewrites a
 * posted line. So a correction is a NEW journal that takes the amount off the
 * wrong head and puts it on the right one, leaving both the mistake and the
 * fix visible. That is also what an auditor expects to see.
 */
export function planHeadReclass(input: {
  voucher: VoucherFacts;
  lineIndex: number;
  toCode: string;
  chart: ChartAccount[];
  reason: string;
}): ReclassPlan {
  const { voucher, lineIndex, toCode, chart, reason } = input;
  const line = voucher.lines[lineIndex];
  if (!line) return { ok: false, error: "That line is not on this voucher" };
  if (!reason.trim()) return { ok: false, error: "Give the reason — it becomes the journal's narration" };

  const to = chart.find((c) => c.code === toCode);
  if (!to) return { ok: false, error: `No head with code ${toCode}` };
  if (to.code === line.accountCode) {
    return { ok: false, error: "That is the head it is already on" };
  }
  if (to.isCash || to.isBank) {
    return { ok: false, error: "Cash and bank are where the money sat, not what it was for — pick an income or expense head" };
  }
  if (childCodesByParent(chart).get(to.code)?.length) {
    return { ok: false, error: `${to.name} has sub-heads — pick one of them, not the parent` };
  }
  if (voucher.reversed) {
    return { ok: false, error: "This voucher has already been reversed — reclassify the one that replaced it" };
  }

  const amount = line.debitPaise || line.creditPaise;
  if (amount <= 0) return { ok: false, error: "That line has no amount to move" };

  // Same side as the original: a debit moves as a debit, so the trial
  // balance is untouched and only the classification changes.
  const wasDebit = line.debitPaise > 0;
  const narration = `Reclassified from ${line.accountCode} ${line.accountName} to ${to.code} ${to.name} — ${reason.trim()} (${voucher.voucherNo})`;
  return {
    ok: true,
    narration,
    lines: [
      {
        accountCode: to.code,
        debitPaise: wasDebit ? amount : 0,
        creditPaise: wasDebit ? 0 : amount,
        narration: `to ${to.name}`,
      },
      {
        accountCode: line.accountCode,
        debitPaise: wasDebit ? 0 : amount,
        creditPaise: wasDebit ? amount : 0,
        narration: `off ${line.accountName}`,
      },
    ],
  };
}

/* ─── Ready-made views: "is this already in the book?" ───────────── */

/**
 * Where money is not a fee: fee receipts, their corrections, store sales and
 * gateway settlements are entered by their own desks and are never keyed in
 * Vouchers, so a view meant to stop the office re-entering an expense leaves
 * them out.
 */
export const NOT_KEYED_IN_VOUCHERS = [
  "fee_voucher",
  "fee_receipt",
  "void_redate",
  "inv_sale",
  "inv_sale_payment",
  "pg_settlement",
] as const;

export type EntryView = { id: string; label: string; hint: string; filter: VoucherFilter };

/**
 * One click per register the office checks before keying an entry (director,
 * 13 Oct 2026: after the expense/salary/advance clean-up, what was KEPT must
 * be visible where it belongs so nobody enters it twice). Every view is
 * "live" — a reversed entry and its reversal are both hidden.
 */
export const ENTRY_VIEWS: EntryView[] = [
  {
    id: "in_book",
    label: "Everything entered (not fees)",
    hint: "Every live payment, journal and receipt except fees and store sales",
    filter: { status: "live", excludeSourceTypes: [...NOT_KEYED_IN_VOUCHERS] },
  },
  {
    id: "expenses",
    label: "Expenses",
    hint: "Expense heads (5…), salary excluded",
    filter: { status: "live", accountPrefix: "5", excludeAccountCodes: ["5070"], excludeSourceTypes: [...NOT_KEYED_IN_VOUCHERS] },
  },
  { id: "salary", label: "Salary", hint: "Salary & Wages (5070)", filter: { status: "live", accountCode: "5070" } },
  { id: "advances", label: "Staff advances", hint: "Staff Advances (1070)", filter: { status: "live", accountCode: "1070" } },
  { id: "pf_esic", label: "PF / ESIC", hint: "Statutory Dues (2300)", filter: { status: "live", accountCode: "2300" } },
  { id: "trustee", label: "Trustee loans", hint: "Owner / Trustee Loans (2100) — money in and repayments", filter: { status: "live", accountCode: "2100" } },
  {
    id: "vehicle_loans",
    label: "Vehicle loans",
    hint: "The three Mahindra bus/van loans (2150–2152)",
    filter: { status: "live", accountCodes: ["2150", "2151", "2152"] },
  },
  { id: "assets", label: "Fixed assets", hint: "Fixed Assets (1030)", filter: { status: "live", accountCode: "1030" } },
];
