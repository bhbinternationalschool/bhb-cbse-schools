/**
 * Ledger v2 — producing the statements from the server book.
 *
 * The arithmetic lives in reports.ts; this fetches the period balances and the
 * cash movements the builders need, and assembles the year-end pack.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import {
  buildBalanceSheet,
  buildIncomeExpenditure,
  buildReceiptsPayments,
  buildTrialBalance,
  sectionsToCsv,
  trialBalanceToCsv,
  type BalanceSheetReport,
  type CashMovementRow,
  type IncomeExpenditureReport,
  type PeriodBalanceRow,
  type ReceiptsPaymentsReport,
  type TrialBalanceReport,
} from "@/lib/ledger/reports";
import type { LedgerAccountKind } from "@/lib/ledger/types";

/* ─── Source data ──────────────────────────────────────────── */

export async function periodBalances(input: {
  from: string;
  to: string;
}): Promise<{ ok: boolean; rows: PeriodBalanceRow[]; error?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, rows: [], error: "Supabase tenant not configured" };

  const { data, error } = await ctx.sb.rpc("ledger_period_balances", {
    p_tenant_id: ctx.tenantId,
    p_from: input.from,
    p_to: input.to,
  });
  if (error) return { ok: false, rows: [], error: error.message };

  const rows = ((data ?? []) as Record<string, unknown>[]).map<PeriodBalanceRow>((r) => ({
    accountId: String(r.account_id ?? ""),
    code: String(r.code ?? ""),
    name: String(r.name ?? ""),
    kind: String(r.kind ?? "asset") as LedgerAccountKind,
    scheduleGroup: String(r.schedule_group ?? ""),
    parentCode: String(r.parent_code ?? ""),
    openingPaise: Number(r.opening_paise ?? 0),
    debitPaise: Number(r.debit_paise ?? 0),
    creditPaise: Number(r.credit_paise ?? 0),
    closingPaise: Number(r.closing_paise ?? 0),
  }));
  return { ok: true, rows };
}

async function cashMovements(input: {
  from: string;
  to: string;
}): Promise<CashMovementRow[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const { data } = await ctx.sb.rpc("ledger_cash_movements", {
    p_tenant_id: ctx.tenantId,
    p_from: input.from,
    p_to: input.to,
  });
  return ((data ?? []) as Record<string, unknown>[]).map<CashMovementRow>((r) => ({
    voucherId: String(r.voucher_id ?? ""),
    voucherDate: String(r.voucher_date ?? ""),
    voucherNo: String(r.voucher_no ?? ""),
    narration: String(r.narration ?? ""),
    cashSignedPaise: Number(r.cash_signed_paise ?? 0),
    headCode: String(r.head_code ?? ""),
    headName: String(r.head_name ?? ""),
    headScheduleGroup: String(r.head_schedule_group ?? ""),
    headKind: String(r.head_kind ?? "expense") as LedgerAccountKind,
    headSignedPaise: Number(r.head_signed_paise ?? 0),
  }));
}

/** Cash and bank accounts, which the R&P opens and closes on. */
async function cashAccountCodes(): Promise<Set<string>> {
  const ctx = await getServerTenantContext();
  if (!ctx) return new Set();
  const { data } = await ctx.sb
    .from("ledger_accounts")
    .select("code, is_cash, is_bank")
    .eq("tenant_id", ctx.tenantId);
  return new Set(
    ((data ?? []) as { code: string; is_cash: boolean; is_bank: boolean }[])
      .filter((r) => r.is_cash || r.is_bank)
      .map((r) => String(r.code)),
  );
}

/* ─── The statements ───────────────────────────────────────── */

export async function trialBalanceReport(input: { from: string; to: string }) {
  const bal = await periodBalances(input);
  if (!bal.ok) return { ok: false as const, error: bal.error };
  return { ok: true as const, report: buildTrialBalance({ ...input, rows: bal.rows }) };
}

export async function incomeExpenditureReport(input: { from: string; to: string }) {
  const bal = await periodBalances(input);
  if (!bal.ok) return { ok: false as const, error: bal.error };
  return { ok: true as const, report: buildIncomeExpenditure({ ...input, rows: bal.rows }) };
}

export async function balanceSheetReport(input: { from: string; to: string }) {
  const bal = await periodBalances(input);
  if (!bal.ok) return { ok: false as const, error: bal.error };
  const ie = buildIncomeExpenditure({ ...input, rows: bal.rows });
  return {
    ok: true as const,
    report: buildBalanceSheet({
      asOf: input.to,
      rows: bal.rows,
      surplusPaise: ie.surplusPaise,
    }),
  };
}

export async function receiptsPaymentsReport(input: { from: string; to: string }) {
  const [bal, movements, cashCodes] = await Promise.all([
    periodBalances(input),
    cashMovements(input),
    cashAccountCodes(),
  ]);
  if (!bal.ok) return { ok: false as const, error: bal.error };

  const cashRows = bal.rows.filter((r) => cashCodes.has(r.code));
  const openingCashPaise = cashRows.reduce((n, r) => n + r.openingPaise, 0);
  const closingCashPaise = cashRows.reduce((n, r) => n + r.closingPaise, 0);

  return {
    ok: true as const,
    report: buildReceiptsPayments({
      ...input,
      openingCashPaise,
      closingCashPaise,
      movements,
    }),
  };
}

export type AccountStatementRow = {
  date: string;
  voucherNo: string;
  voucherType: string;
  narration: string;
  partyName: string;
  instrumentRef: string;
  debitPaise: number;
  creditPaise: number;
  runningPaise: number;
};

export async function accountStatement(input: {
  code: string;
  from: string;
  to: string;
}): Promise<{ ok: boolean; rows: AccountStatementRow[]; error?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, rows: [], error: "Supabase tenant not configured" };

  const { data, error } = await ctx.sb.rpc("ledger_account_statement", {
    p_tenant_id: ctx.tenantId,
    p_code: input.code,
    p_from: input.from,
    p_to: input.to,
  });
  if (error) return { ok: false, rows: [], error: error.message };

  return {
    ok: true,
    rows: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      date: String(r.voucher_date ?? ""),
      voucherNo: String(r.voucher_no ?? ""),
      voucherType: String(r.voucher_type ?? ""),
      narration: String(r.narration ?? ""),
      partyName: String(r.party_name ?? ""),
      instrumentRef: String(r.instrument_ref ?? ""),
      debitPaise: Number(r.debit_paise ?? 0),
      creditPaise: Number(r.credit_paise ?? 0),
      runningPaise: Number(r.running_paise ?? 0),
    })),
  };
}

/* ─── The year-end pack ────────────────────────────────────── */

export type StatutorySchedule = {
  title: string;
  scheduleGroup: string;
  lines: { code: string; name: string; amountPaise: number }[];
  totalPaise: number;
};

export type CaPack = {
  ok: boolean;
  error?: string;
  fyCode: string;
  from: string;
  to: string;
  trialBalance?: TrialBalanceReport;
  incomeExpenditure?: IncomeExpenditureReport;
  balanceSheet?: BalanceSheetReport;
  receiptsPayments?: ReceiptsPaymentsReport;
  /** Ledger-wise totals grouped the way the audited statements present them. */
  schedules: StatutorySchedule[];
  /** Everything that must be true before this pack can be relied on. */
  readiness: { check: string; ok: boolean; detail: string }[];
};

/**
 * The pack a CA is handed at year end.
 *
 * On Form 10B specifically: this produces the *supporting schedules* — every
 * ledger grouped the way the audited statements present it — and deliberately
 * stops short of filling in the form's clause-numbered annexures. Which
 * clauses apply turns on the trust's registration (12A, 10(23C) and their
 * sub-clauses each report differently), on whether the year's application of
 * income is being claimed under accumulation, and on facts that live in the
 * trust deed rather than in this ledger. Generating numbers against clause
 * numbers we cannot verify would produce a return that looks authoritative and
 * is unsigned by anyone who checked it. The schedules give the CA every figure
 * they need; the mapping to clauses is theirs.
 */
export async function caYearEndPack(input: {
  fyCode: string;
  from: string;
  to: string;
}): Promise<CaPack> {
  const bal = await periodBalances({ from: input.from, to: input.to });
  if (!bal.ok) {
    return { ok: false, error: bal.error, fyCode: input.fyCode, from: input.from, to: input.to, schedules: [], readiness: [] };
  }

  const [tb, ie, bs, rp] = await Promise.all([
    trialBalanceReport({ from: input.from, to: input.to }),
    incomeExpenditureReport({ from: input.from, to: input.to }),
    balanceSheetReport({ from: input.from, to: input.to }),
    receiptsPaymentsReport({ from: input.from, to: input.to }),
  ]);

  const byGroup = new Map<string, StatutorySchedule>();
  for (const r of bal.rows) {
    if (r.closingPaise === 0 && r.debitPaise === 0 && r.creditPaise === 0) continue;
    const title = r.scheduleGroup || "Unclassified";
    const amount =
      r.kind === "income" || r.kind === "expense"
        ? (r.kind === "income" ? r.creditPaise - r.debitPaise : r.debitPaise - r.creditPaise)
        : r.closingPaise;
    if (amount === 0) continue;
    const existing = byGroup.get(title);
    const line = { code: r.code, name: r.name, amountPaise: amount };
    if (existing) {
      existing.lines.push(line);
      existing.totalPaise += amount;
    } else {
      byGroup.set(title, {
        title,
        scheduleGroup: title,
        lines: [line],
        totalPaise: amount,
      });
    }
  }

  // An opening-balance load is an `opening` voucher, wherever it is dated.
  const ctx = await getServerTenantContext();
  let openingLoaded = false;
  if (ctx) {
    const { count } = await ctx.sb
      .from("ledger_vouchers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", ctx.tenantId)
      .eq("voucher_type", "opening")
      .lte("voucher_date", input.to);
    openingLoaded = (count ?? 0) > 0;
  }

  const unclassified = bal.rows.filter(
    (r) => !r.scheduleGroup && (r.closingPaise !== 0 || r.debitPaise !== 0 || r.creditPaise !== 0),
  );

  const readiness = [
    {
      check: "Trial balance ties",
      ok: !!tb.ok && tb.report.balanced,
      detail: tb.ok
        ? `Dr ${tb.report.totals.closingDebitPaise} vs Cr ${tb.report.totals.closingCreditPaise}`
        : (tb.error ?? ""),
    },
    {
      check: "Balance sheet balances",
      ok: !!bs.ok && bs.report.balanced,
      detail: bs.ok ? `difference ${bs.report.differencePaise}` : (bs.error ?? ""),
    },
    {
      check: "Receipts & Payments reconciles to cash and bank",
      ok: !!rp.ok && rp.report.reconciles,
      detail: rp.ok
        ? `computed ${rp.report.computedClosingPaise} vs actual ${rp.report.closingCashPaise}`
        : (rp.error ?? ""),
    },
    {
      check: "Every account maps to a statement group",
      ok: unclassified.length === 0,
      detail:
        unclassified.length === 0
          ? "all accounts classified"
          : `unclassified: ${unclassified.map((r) => r.code).join(", ")}`,
    },
    {
      // Not "is there anything before the period" — for a first year the
      // opening voucher is dated the first day of it and correctly falls
      // inside the period, so a balance-before test reports a false alarm on
      // exactly the year that matters most.
      check: "Opening balances loaded for the year",
      ok: openingLoaded,
      detail: openingLoaded
        ? "opening balances posted"
        : "no opening balance voucher — the prior year's audited figures have not been loaded",
    },
  ];

  return {
    ok: readiness.every((r) => r.ok),
    fyCode: input.fyCode,
    from: input.from,
    to: input.to,
    trialBalance: tb.ok ? tb.report : undefined,
    incomeExpenditure: ie.ok ? ie.report : undefined,
    balanceSheet: bs.ok ? bs.report : undefined,
    receiptsPayments: rp.ok ? rp.report : undefined,
    schedules: [...byGroup.values()].sort((a, b) => a.title.localeCompare(b.title)),
    readiness,
  };
}

/* ─── CSV ──────────────────────────────────────────────────── */

export function packToCsvBundle(pack: CaPack): Record<string, string> {
  const out: Record<string, string> = {};
  if (pack.trialBalance) out["trial-balance.csv"] = trialBalanceToCsv(pack.trialBalance);
  if (pack.incomeExpenditure) {
    out["income-and-expenditure.csv"] = [
      sectionsToCsv({
        title: `Income for ${pack.from} to ${pack.to}`,
        sections: pack.incomeExpenditure.income,
        totalLabel: "Total income",
        totalPaise: pack.incomeExpenditure.totalIncomePaise,
      }),
      "",
      sectionsToCsv({
        title: "Expenditure",
        sections: pack.incomeExpenditure.expenditure,
        totalLabel: "Total expenditure",
        totalPaise: pack.incomeExpenditure.totalExpenditurePaise,
      }),
      "",
      `Surplus / (deficit),,${pack.incomeExpenditure.surplusPaise / 100}`,
    ].join("\n");
  }
  if (pack.balanceSheet) {
    out["balance-sheet.csv"] = [
      sectionsToCsv({
        title: `Corpus & liabilities as at ${pack.to}`,
        sections: pack.balanceSheet.liabilities,
        totalLabel: "Total corpus & liabilities",
        totalPaise: pack.balanceSheet.totalLiabilitiesPaise,
      }),
      "",
      sectionsToCsv({
        title: "Assets",
        sections: pack.balanceSheet.assets,
        totalLabel: "Total assets",
        totalPaise: pack.balanceSheet.totalAssetsPaise,
      }),
    ].join("\n");
  }
  if (pack.receiptsPayments) {
    out["receipts-and-payments.csv"] = [
      `Opening cash & bank,,${pack.receiptsPayments.openingCashPaise / 100}`,
      "",
      sectionsToCsv({
        title: "Receipts",
        sections: pack.receiptsPayments.receipts,
        totalLabel: "Total receipts",
        totalPaise: pack.receiptsPayments.totalReceiptsPaise,
      }),
      "",
      sectionsToCsv({
        title: "Payments",
        sections: pack.receiptsPayments.payments,
        totalLabel: "Total payments",
        totalPaise: pack.receiptsPayments.totalPaymentsPaise,
      }),
      "",
      `Closing cash & bank,,${pack.receiptsPayments.closingCashPaise / 100}`,
    ].join("\n");
  }
  return out;
}
