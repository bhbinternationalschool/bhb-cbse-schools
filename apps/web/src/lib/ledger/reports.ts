/**
 * Ledger v2 — the statements a trust is audited on.
 *
 * Pure builders over period balances. No database, so the shape of every
 * statement — and the arithmetic that has to tie — can be tested directly.
 *
 * A school run by a trust files three statements, and they are not the three a
 * company files:
 *
 *   Receipts & Payments   cash in and cash out, on a pure cash basis. It is a
 *                         summary of the cash book, not of performance, and it
 *                         must reconcile to the actual cash and bank balances.
 *   Income & Expenditure  the trust's equivalent of a profit and loss account.
 *                         Its bottom line is a surplus or deficit, never a
 *                         "profit", and the wording matters to an auditor.
 *   Balance Sheet         in trust form: Corpus and Liabilities against
 *                         Assets, with the year's surplus carried to corpus.
 */

import type { LedgerAccountKind } from "@/lib/ledger/types";

export type PeriodBalanceRow = {
  accountId: string;
  code: string;
  name: string;
  kind: LedgerAccountKind;
  scheduleGroup: string;
  parentCode: string;
  openingPaise: number;
  debitPaise: number;
  creditPaise: number;
  closingPaise: number;
};

export type ReportLine = {
  code: string;
  name: string;
  scheduleGroup: string;
  amountPaise: number;
};

export type ReportSection = {
  title: string;
  lines: ReportLine[];
  totalPaise: number;
};

/* ─── Trial balance ────────────────────────────────────────── */

export type TrialBalanceReport = {
  from: string;
  to: string;
  rows: (PeriodBalanceRow & { closingDebitPaise: number; closingCreditPaise: number })[];
  totals: {
    openingDebitPaise: number;
    openingCreditPaise: number;
    debitPaise: number;
    creditPaise: number;
    closingDebitPaise: number;
    closingCreditPaise: number;
  };
  balanced: boolean;
};

/**
 * The trial balance, with opening, movement and closing.
 *
 * The closing columns are derived from the raw sides rather than from the
 * signed balance, for the reason the core migration spells out: an account
 * sitting contrary to its nature must appear on the other side, not vanish
 * from both.
 */
export function buildTrialBalance(input: {
  from: string;
  to: string;
  rows: PeriodBalanceRow[];
}): TrialBalanceReport {
  const rows = input.rows
    .filter((r) => r.openingPaise !== 0 || r.debitPaise !== 0 || r.creditPaise !== 0 || r.closingPaise !== 0)
    .map((r) => {
      const debitNormal = r.kind === "asset" || r.kind === "expense";
      const closingSigned = debitNormal ? r.closingPaise : -r.closingPaise;
      return {
        ...r,
        closingDebitPaise: Math.max(closingSigned, 0),
        closingCreditPaise: Math.max(-closingSigned, 0),
      };
    });

  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((n, r) => n + f(r), 0);
  const openingSigned = (r: PeriodBalanceRow) =>
    r.kind === "asset" || r.kind === "expense" ? r.openingPaise : -r.openingPaise;

  const totals = {
    openingDebitPaise: rows.reduce((n, r) => n + Math.max(openingSigned(r), 0), 0),
    openingCreditPaise: rows.reduce((n, r) => n + Math.max(-openingSigned(r), 0), 0),
    debitPaise: sum((r) => r.debitPaise),
    creditPaise: sum((r) => r.creditPaise),
    closingDebitPaise: sum((r) => r.closingDebitPaise),
    closingCreditPaise: sum((r) => r.closingCreditPaise),
  };

  return {
    from: input.from,
    to: input.to,
    rows,
    totals,
    balanced:
      totals.debitPaise === totals.creditPaise &&
      totals.closingDebitPaise === totals.closingCreditPaise,
  };
}

/* ─── Income & Expenditure ─────────────────────────────────── */

export type IncomeExpenditureReport = {
  from: string;
  to: string;
  income: ReportSection[];
  expenditure: ReportSection[];
  totalIncomePaise: number;
  totalExpenditurePaise: number;
  /** Positive is a surplus, negative a deficit. Never called a profit. */
  surplusPaise: number;
};

function groupByScheduleGroup(
  rows: PeriodBalanceRow[],
  amountOf: (r: PeriodBalanceRow) => number,
): ReportSection[] {
  const bySection = new Map<string, ReportLine[]>();
  for (const r of rows) {
    const amount = amountOf(r);
    if (amount === 0) continue;
    const title = r.scheduleGroup || "Unclassified";
    const line: ReportLine = {
      code: r.code,
      name: r.name,
      scheduleGroup: title,
      amountPaise: amount,
    };
    const list = bySection.get(title);
    if (list) list.push(line);
    else bySection.set(title, [line]);
  }
  return [...bySection.entries()]
    .map(([title, lines]) => ({
      title,
      lines: lines.sort((a, b) => a.code.localeCompare(b.code)),
      totalPaise: lines.reduce((n, l) => n + l.amountPaise, 0),
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Income and expenditure for the period.
 *
 * Movement only, never the opening figure: a nominal account's balance brought
 * forward belongs to a year that has already been reported on, and including
 * it would state this year's surplus as the sum of every year since inception.
 * That is true whether or not the previous year was formally closed, which is
 * why this does not depend on the closing having happened.
 */
export function buildIncomeExpenditure(input: {
  from: string;
  to: string;
  rows: PeriodBalanceRow[];
}): IncomeExpenditureReport {
  const income = input.rows.filter((r) => r.kind === "income");
  const expenditure = input.rows.filter((r) => r.kind === "expense");

  const incomeSections = groupByScheduleGroup(income, (r) => r.creditPaise - r.debitPaise);
  const expenditureSections = groupByScheduleGroup(expenditure, (r) => r.debitPaise - r.creditPaise);

  const totalIncomePaise = incomeSections.reduce((n, s) => n + s.totalPaise, 0);
  const totalExpenditurePaise = expenditureSections.reduce((n, s) => n + s.totalPaise, 0);

  return {
    from: input.from,
    to: input.to,
    income: incomeSections,
    expenditure: expenditureSections,
    totalIncomePaise,
    totalExpenditurePaise,
    surplusPaise: totalIncomePaise - totalExpenditurePaise,
  };
}

/* ─── Balance sheet ────────────────────────────────────────── */

export type BalanceSheetReport = {
  asOf: string;
  liabilities: ReportSection[];
  assets: ReportSection[];
  totalLiabilitiesPaise: number;
  totalAssetsPaise: number;
  /** The period's surplus, shown under corpus rather than left in nominals. */
  surplusPaise: number;
  balanced: boolean;
  differencePaise: number;
};

/**
 * The balance sheet in trust form.
 *
 * Corpus and liabilities on one side, assets on the other, and the year's
 * surplus added to corpus. That last part is what makes it balance while the
 * year is still open: income and expenditure have not yet been swept into
 * corpus by a closing entry, so their net has to appear here or the two sides
 * differ by exactly the surplus.
 */
export function buildBalanceSheet(input: {
  asOf: string;
  rows: PeriodBalanceRow[];
  /** Surplus for the period being reported, from the I&E. */
  surplusPaise: number;
}): BalanceSheetReport {
  const liabilityRows = input.rows.filter((r) => r.kind === "liability" || r.kind === "equity");
  const assetRows = input.rows.filter((r) => r.kind === "asset");

  const liabilities = groupByScheduleGroup(liabilityRows, (r) => r.closingPaise);
  const assets = groupByScheduleGroup(assetRows, (r) => r.closingPaise);

  const surplusSection: ReportSection = {
    title: "Surplus / (deficit) for the period",
    lines: [
      {
        code: "",
        name: "Excess of income over expenditure",
        scheduleGroup: "Corpus & funds",
        amountPaise: input.surplusPaise,
      },
    ],
    totalPaise: input.surplusPaise,
  };

  const allLiabilities = input.surplusPaise === 0 ? liabilities : [...liabilities, surplusSection];

  const totalLiabilitiesPaise = allLiabilities.reduce((n, s) => n + s.totalPaise, 0);
  const totalAssetsPaise = assets.reduce((n, s) => n + s.totalPaise, 0);

  return {
    asOf: input.asOf,
    liabilities: allLiabilities,
    assets,
    totalLiabilitiesPaise,
    totalAssetsPaise,
    surplusPaise: input.surplusPaise,
    balanced: totalLiabilitiesPaise === totalAssetsPaise,
    differencePaise: totalAssetsPaise - totalLiabilitiesPaise,
  };
}

/* ─── Receipts & Payments ──────────────────────────────────── */

export type CashMovementRow = {
  voucherId: string;
  voucherDate: string;
  voucherNo: string;
  narration: string;
  /** Net cash/bank movement on the voucher; positive is money in. */
  cashSignedPaise: number;
  headCode: string;
  headName: string;
  headScheduleGroup: string;
  headKind: LedgerAccountKind;
  /** Credit minus debit on the head line; positive is a credit. */
  headSignedPaise: number;
};

export type ReceiptsPaymentsReport = {
  from: string;
  to: string;
  openingCashPaise: number;
  closingCashPaise: number;
  receipts: ReportSection[];
  payments: ReportSection[];
  totalReceiptsPaise: number;
  totalPaymentsPaise: number;
  /** opening + receipts − payments, which must equal the closing balance. */
  computedClosingPaise: number;
  reconciles: boolean;
};

/**
 * Split one voucher's cash movement across the heads it was against.
 *
 * The subtle part is which heads are eligible. A voucher can carry legs that
 * have nothing to do with the cash that moved — an expense part-paid in cash
 * and part left on credit has both an expense leg and a payable leg, and only
 * the expense is what the cash was spent on. So allocation considers only
 * heads whose direction agrees with the cash: money out is attributed to
 * debits, money in to credits.
 *
 * Within the eligible heads it is proportional, and the remainder from integer
 * division goes to the largest, so the parts always sum back to exactly the
 * cash that moved. A receipts and payments account that loses a paisa to
 * rounding will not reconcile to the cash book, and finding out why is a bad
 * afternoon.
 */
export function allocateVoucherCash(input: {
  cashSignedPaise: number;
  heads: { code: string; name: string; scheduleGroup: string; signedPaise: number }[];
}): { code: string; name: string; scheduleGroup: string; amountPaise: number }[] {
  const cash = Math.round(input.cashSignedPaise);
  if (cash === 0 || input.heads.length === 0) return [];

  const moneyIn = cash > 0;
  const eligible = input.heads.filter((h) =>
    moneyIn ? h.signedPaise > 0 : h.signedPaise < 0,
  );
  // A voucher whose heads all point the other way is unusual — a refund
  // routed oddly, say. Rather than drop it from the statement, fall back to
  // every head; the total stays right and the head is at worst imprecise.
  const pool = eligible.length > 0 ? eligible : input.heads;

  const weights = pool.map((h) => Math.abs(h.signedPaise));
  const weightTotal = weights.reduce((n, w) => n + w, 0);
  const target = Math.abs(cash);
  if (weightTotal === 0) return [];

  const out = pool.map((h, i) => ({
    code: h.code,
    name: h.name,
    scheduleGroup: h.scheduleGroup,
    amountPaise: Math.floor((target * weights[i]!) / weightTotal),
  }));

  const allocated = out.reduce((n, o) => n + o.amountPaise, 0);
  const remainder = target - allocated;
  if (remainder !== 0) {
    let largest = 0;
    for (let i = 1; i < out.length; i += 1) {
      if (weights[i]! > weights[largest]!) largest = i;
    }
    out[largest]!.amountPaise += remainder;
  }

  return out.filter((o) => o.amountPaise !== 0);
}

export function buildReceiptsPayments(input: {
  from: string;
  to: string;
  openingCashPaise: number;
  closingCashPaise: number;
  movements: CashMovementRow[];
}): ReceiptsPaymentsReport {
  const byVoucher = new Map<string, CashMovementRow[]>();
  for (const m of input.movements) {
    const list = byVoucher.get(m.voucherId);
    if (list) list.push(m);
    else byVoucher.set(m.voucherId, [m]);
  }

  const receiptLines: ReportLine[] = [];
  const paymentLines: ReportLine[] = [];

  for (const rows of byVoucher.values()) {
    const cash = rows[0]!.cashSignedPaise;
    const allocated = allocateVoucherCash({
      cashSignedPaise: cash,
      heads: rows.map((r) => ({
        code: r.headCode,
        name: r.headName,
        scheduleGroup: r.headScheduleGroup,
        signedPaise: r.headSignedPaise,
      })),
    });
    for (const a of allocated) {
      (cash > 0 ? receiptLines : paymentLines).push({
        code: a.code,
        name: a.name,
        scheduleGroup: a.scheduleGroup,
        amountPaise: a.amountPaise,
      });
    }
  }

  const fold = (lines: ReportLine[]): ReportSection[] => {
    const byCode = new Map<string, ReportLine>();
    for (const l of lines) {
      const seen = byCode.get(l.code);
      if (seen) seen.amountPaise += l.amountPaise;
      else byCode.set(l.code, { ...l });
    }
    const bySection = new Map<string, ReportLine[]>();
    for (const l of byCode.values()) {
      const title = l.scheduleGroup || "Unclassified";
      const list = bySection.get(title);
      if (list) list.push(l);
      else bySection.set(title, [l]);
    }
    return [...bySection.entries()]
      .map(([title, ls]) => ({
        title,
        lines: ls.sort((a, b) => a.code.localeCompare(b.code)),
        totalPaise: ls.reduce((n, l) => n + l.amountPaise, 0),
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
  };

  const receipts = fold(receiptLines);
  const payments = fold(paymentLines);
  const totalReceiptsPaise = receipts.reduce((n, s) => n + s.totalPaise, 0);
  const totalPaymentsPaise = payments.reduce((n, s) => n + s.totalPaise, 0);
  const computedClosingPaise =
    input.openingCashPaise + totalReceiptsPaise - totalPaymentsPaise;

  return {
    from: input.from,
    to: input.to,
    openingCashPaise: input.openingCashPaise,
    closingCashPaise: input.closingCashPaise,
    receipts,
    payments,
    totalReceiptsPaise,
    totalPaymentsPaise,
    computedClosingPaise,
    reconciles: computedClosingPaise === input.closingCashPaise,
  };
}

/* ─── Export ───────────────────────────────────────────────── */

function csvCell(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rupees with two decimals — what a CA expects to paste into a workpaper. */
export function paiseToRupeeString(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(Math.round(paise));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function sectionsToCsv(input: {
  title: string;
  sections: ReportSection[];
  totalLabel: string;
  totalPaise: number;
}): string {
  const rows: string[] = [[csvCell(input.title)].join(",")];
  rows.push(["Group", "Code", "Account", "Amount"].map(csvCell).join(","));
  for (const s of input.sections) {
    for (const l of s.lines) {
      rows.push([s.title, l.code, l.name, paiseToRupeeString(l.amountPaise)].map(csvCell).join(","));
    }
    rows.push([s.title, "", `${s.title} total`, paiseToRupeeString(s.totalPaise)].map(csvCell).join(","));
  }
  rows.push(["", "", input.totalLabel, paiseToRupeeString(input.totalPaise)].map(csvCell).join(","));
  return rows.join("\n");
}

export function trialBalanceToCsv(tb: TrialBalanceReport): string {
  const rows: string[] = [
    csvCell(`Trial balance ${tb.from} to ${tb.to}`),
    ["Code", "Account", "Group", "Opening", "Debit", "Credit", "Closing Dr", "Closing Cr"]
      .map(csvCell)
      .join(","),
  ];
  for (const r of tb.rows) {
    rows.push(
      [
        r.code,
        r.name,
        r.scheduleGroup,
        paiseToRupeeString(r.openingPaise),
        paiseToRupeeString(r.debitPaise),
        paiseToRupeeString(r.creditPaise),
        paiseToRupeeString(r.closingDebitPaise),
        paiseToRupeeString(r.closingCreditPaise),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  rows.push(
    [
      "",
      "TOTAL",
      "",
      "",
      paiseToRupeeString(tb.totals.debitPaise),
      paiseToRupeeString(tb.totals.creditPaise),
      paiseToRupeeString(tb.totals.closingDebitPaise),
      paiseToRupeeString(tb.totals.closingCreditPaise),
    ]
      .map(csvCell)
      .join(","),
  );
  return rows.join("\n");
}
