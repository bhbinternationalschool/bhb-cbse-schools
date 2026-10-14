/**
 * Salary paid on each person's own date (director, 14 Oct 2026: "I have to
 * pay on different dates for every staff — how?").
 *
 * The book (payroll_ledger_post, migration 20261014120000) keys payroll
 * vouchers by source id:
 *   accrual   run id                     'pr_x', after a recall 'pr_x#2' …
 *   payment   run ':pay:' date ':' acct  'pr_x:pay:2026-07-30:cash', '#2' …
 *   legacy    run id (one payment for the whole run) and the hand
 *             corrections 'pr_dcnn8881:cash', 'pr_dcnn8881:upi-2140'.
 * Every reader that maps a voucher back to its run goes through
 * payrollRunIdFromSourceId. The grouping below is the same rule the
 * database applies, for screens and the read-only rehearsal.
 *
 * Pure: no storage, no network.
 */

/** The run a payroll voucher belongs to ('pr_x#2', 'pr_x:pay:…', 'pr_x:cash' → 'pr_x'). */
export function payrollRunIdFromSourceId(sourceId: string): string {
  return String(sourceId || "").split("#")[0]!.split(":")[0]!;
}

/** A versioned source id without its version ('pr_x#3' → 'pr_x'). */
export function payrollSourceBase(sourceId: string): string {
  return String(sourceId || "").split("#")[0]!;
}

/** Version of a source id: 'pr_x' → 1, 'pr_x#3' → 3. */
export function payrollSourceVersion(sourceId: string): number {
  const m = /#(\d+)$/.exec(String(sourceId || ""));
  return m ? Math.max(1, Number(m[1])) : 1;
}

/** The source id of version n (1 = the bare base). */
export function versionedPayrollSourceId(base: string, n: number): string {
  return n <= 1 ? base : `${base}#${n}`;
}

/** A per-date payment group voucher (not the legacy whole-run payment). */
export function isPayrollPaymentGroupSource(sourceId: string): boolean {
  return String(sourceId || "").includes(":pay:");
}

/** Source id base of one payment group. */
export function payrollPaymentGroupBase(runId: string, date: string, accountKey: string): string {
  return `${runId}:pay:${date}:${accountKey}`;
}

export type PayGroupLine = {
  staffId: string;
  fullName?: string;
  amountPayable: number;
  netPay?: number;
  /** Day actually paid (YYYY-MM-DD), "" = not paid. */
  paidOn?: string;
  paymentMode: string;
  paymentRef?: string;
};

export type PayGroupAccount = {
  /** Ledger code credited: 1000 cash, 1110 wallet, the bank's code, or 1010. */
  code: string;
  /** Source-id key: cash, wallet, the bank account id, or 1010. */
  key: string;
  bankId: string;
};

/**
 * Where a line's money left from, as payroll_ledger_post decides it: the
 * Payouts wallet first, cash, else the bank mapped to the mode (falling back
 * to the NEFT/RTGS/UPI bank, then 1010 Bank).
 */
export function payrollPaymentAccount(
  line: Pick<PayGroupLine, "paymentMode">,
  opts: {
    walletPaid?: boolean;
    /** accounts_desk_mode_bank_map: mode → bank account id. */
    bankForMode?: Record<string, string>;
    /** bank account id → ledger code. */
    codeForBank?: (bankId: string) => string;
  } = {},
): PayGroupAccount {
  if (opts.walletPaid) return { code: "1110", key: "wallet", bankId: "" };
  const mode = String(line.paymentMode || "").toLowerCase() || "bank_transfer";
  if (mode === "cash") return { code: "1000", key: "cash", bankId: "" };
  const map = opts.bankForMode ?? {};
  const fallback = ["neft", "rtgs", "upi"].map((m) => map[m]).find(Boolean) ?? "";
  const bankId = map[mode] || fallback;
  if (!bankId) return { code: "1010", key: "1010", bankId: "" };
  return { code: opts.codeForBank?.(bankId) || "1010", key: bankId, bankId };
}

export type PayGroup = {
  date: string;
  account: PayGroupAccount;
  sourceBase: string;
  amount: number;
  staffIds: string[];
  modes: string[];
};

/** A line counts toward the payment leg when it was paid and something is payable. */
export function linePayable(l: Pick<PayGroupLine, "amountPayable" | "netPay">): number {
  const n = Number.isFinite(l.amountPayable) ? l.amountPayable : Number(l.netPay ?? 0);
  return Math.max(0, Number(n) || 0);
}

/**
 * One payment voucher per (day paid, money account). `runPaidOn` is the old
 * whole-run paid day — used only when no line carries its own paid day.
 */
export function groupPayrollPayments(
  runId: string,
  lines: PayGroupLine[],
  opts: {
    runPaidOn?: string;
    walletPaid?: (staffId: string) => boolean;
    bankForMode?: Record<string, string>;
    codeForBank?: (bankId: string) => string;
  } = {},
): PayGroup[] {
  const anyLineDate = lines.some((l) => !!l.paidOn);
  const fallback = anyLineDate ? "" : opts.runPaidOn || "";
  const groups = new Map<string, PayGroup>();
  for (const l of lines) {
    const date = (l.paidOn || fallback).slice(0, 10);
    const amount = linePayable(l);
    if (!date || amount <= 0) continue;
    const account = payrollPaymentAccount(l, {
      walletPaid: opts.walletPaid?.(l.staffId),
      bankForMode: opts.bankForMode,
      codeForBank: opts.codeForBank,
    });
    const base = payrollPaymentGroupBase(runId, date, account.key);
    const g = groups.get(base) ?? { date, account, sourceBase: base, amount: 0, staffIds: [], modes: [] };
    g.amount += amount;
    g.staffIds.push(l.staffId);
    const mode = String(l.paymentMode || "bank_transfer").toLowerCase();
    if (!g.modes.includes(mode)) g.modes.push(mode);
    groups.set(base, g);
  }
  return [...groups.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.account.key.localeCompare(b.account.key),
  );
}

export type PaidProgress = {
  /** Lines with something payable. */
  payable: number;
  /** Of those, marked paid. */
  paid: number;
  allPaid: boolean;
  /** Latest day paid among the paid lines ("" if none). */
  lastPaidOn: string;
};

export function payrollPaidProgress(lines: Pick<PayGroupLine, "amountPayable" | "netPay" | "paidOn">[]): PaidProgress {
  const due = lines.filter((l) => linePayable(l) > 0);
  const paid = due.filter((l) => !!l.paidOn);
  const lastPaidOn = paid.map((l) => l.paidOn || "").sort().pop() ?? "";
  return { payable: due.length, paid: paid.length, allPaid: due.length > 0 && paid.length === due.length, lastPaidOn };
}

/** "posted · partly paid (3 of 35)" — the run's state while staff are paid day by day. */
export function payrollPaidStatusLabel(
  status: string,
  lines: Pick<PayGroupLine, "amountPayable" | "netPay" | "paidOn">[],
): string {
  if (status !== "posted") return "";
  const p = payrollPaidProgress(lines);
  if (p.paid === 0) return "";
  return `partly paid (${p.paid} of ${p.payable})`;
}
