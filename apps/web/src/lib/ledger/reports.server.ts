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
import { L_ACCOUNTS_PAYABLE } from "@/lib/ledger/coa";
import {
  childCodesByParent,
  matchesVoucherFilter,
  planHeadReclass,
  type VoucherFacts,
  type VoucherFilter,
  type VoucherLineFacts,
} from "@/lib/ledger/voucherFilter";
import { ledgerListAccounts, ledgerPost, ledgerReverse } from "@/lib/ledger/ledger.server";
import { planAmend, planVoid, type AmendLine } from "@/lib/ledger/voucherAmend";
import {
  buildVendorStatement,
  type VendorLine,
  type VendorStatement,
} from "@/lib/ledger/vendorHistory";

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

/* ─── Vendor history ───────────────────────────────────────── */

/**
 * Every vendor the expense book knows, with what is owed to each.
 *
 * Paged rather than fetched in one call: PostgREST caps a request at 1,000
 * rows and reports the truncation as success, which has already cost this
 * system a day's worth of receipt lines. A vendor list is small today and will
 * not stay small.
 */
export async function ledgerVendors(): Promise<{
  ok: boolean;
  error?: string;
  vendors: { partyKey: string; name: string; outstandingPaise: number; lastActivityOn: string }[];
}> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured", vendors: [] };

  const { data: parties, error: pErr } = await ctx.sb
    .from("ledger_parties")
    .select("id, external_id, name")
    .eq("tenant_id", ctx.tenantId)
    .eq("kind", "vendor");
  if (pErr) return { ok: false, error: pErr.message, vendors: [] };

  const rows = (parties ?? []) as { id: string; external_id: string; name: string }[];
  if (rows.length === 0) return { ok: true, vendors: [] };

  const lines = await fetchVendorLines(ctx.sb, ctx.tenantId, rows.map((r) => r.id));
  const byParty = new Map<string, { due: number; last: string }>();
  for (const l of lines) {
    const cur = byParty.get(l.partyId) ?? { due: 0, last: "" };
    if (l.isPayable) cur.due += l.creditPaise - l.debitPaise;
    if (l.date > cur.last) cur.last = l.date;
    byParty.set(l.partyId, cur);
  }

  return {
    ok: true,
    vendors: rows
      .map((r) => ({
        partyKey: r.external_id,
        name: r.name,
        outstandingPaise: byParty.get(r.id)?.due ?? 0,
        lastActivityOn: byParty.get(r.id)?.last ?? "",
      }))
      .sort(
        (a, b) =>
          b.outstandingPaise - a.outstandingPaise || a.name.localeCompare(b.name),
      ),
  };
}

type RawVendorLine = VendorLine & { partyId: string };

/**
 * Paged read of every ledger line carrying one of these vendor parties.
 *
 * The ledger has no "reversed" flag by design — the reversal voucher IS the
 * record, pointing at the voucher it cancels through `reverses_voucher_id`.
 * (The first version asked the vouchers table for a `reversed_at` column that
 * never existed; PostgREST refused, the route answered 500, and the Vendor
 * history panel showed "0 vendors" for a book holding 25 — 2026-09-05.)
 * Both halves of a reversed pair are dropped here: a cancelled bill is not a
 * bill, and its reversal is not a payment.
 */
async function fetchVendorLines(
  sb: NonNullable<Awaited<ReturnType<typeof getServerTenantContext>>>["sb"],
  tenantId: string,
  partyIds: string[],
): Promise<RawVendorLine[]> {
  type Staged = RawVendorLine & { voucherId: string; reversesVoucherId: string };
  const staged: Staged[] = [];
  // Chunked so the `in` filter cannot outgrow the URL length PostgREST accepts.
  for (let i = 0; i < partyIds.length; i += 100) {
    const chunk = partyIds.slice(i, i + 100);
    const page = 1000;
    for (let from = 0; ; from += page) {
      const { data, error } = await sb
        .from("ledger_lines")
        .select(
          "voucher_id, party_id, debit_paise, credit_paise, narration, instrument_ref, ledger_accounts!inner(code, name), ledger_vouchers!inner(voucher_no, voucher_type, voucher_date, reverses_voucher_id)",
        )
        .eq("tenant_id", tenantId)
        .in("party_id", chunk)
        .order("id", { ascending: true })
        .range(from, from + page - 1);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Record<string, unknown>[];
      for (const r of rows) {
        const acct = r.ledger_accounts as { code?: string; name?: string } | null;
        const vch = r.ledger_vouchers as
          | {
              voucher_no?: string;
              voucher_type?: string;
              voucher_date?: string;
              reverses_voucher_id?: string | null;
            }
          | null;
        const code = String(acct?.code ?? "");
        staged.push({
          voucherId: String(r.voucher_id ?? ""),
          reversesVoucherId: String(vch?.reverses_voucher_id ?? ""),
          partyId: String(r.party_id ?? ""),
          date: String(vch?.voucher_date ?? ""),
          voucherNo: String(vch?.voucher_no ?? ""),
          voucherType: String(vch?.voucher_type ?? ""),
          accountCode: code,
          accountName: String(acct?.name ?? ""),
          narration: String(r.narration ?? ""),
          instrumentRef: String(r.instrument_ref ?? ""),
          debitPaise: Number(r.debit_paise ?? 0),
          creditPaise: Number(r.credit_paise ?? 0),
          isPayable: code === L_ACCOUNTS_PAYABLE,
        });
      }
      if (rows.length < page) break;
    }
  }

  // Which of these vouchers has since been reversed. A reversal usually
  // carries the same party and is already in `staged`, but it is asked of the
  // book directly so a reversal posted without the party still counts.
  const voucherIds = [...new Set(staged.map((s) => s.voucherId).filter(Boolean))];
  const reversed = new Set<string>(
    staged.map((s) => s.reversesVoucherId).filter(Boolean),
  );
  for (let i = 0; i < voucherIds.length; i += 200) {
    const chunk = voucherIds.slice(i, i + 200);
    const { data, error } = await sb
      .from("ledger_vouchers")
      .select("reverses_voucher_id")
      .eq("tenant_id", tenantId)
      .in("reverses_voucher_id", chunk);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { reverses_voucher_id?: string }[]) {
      if (r.reverses_voucher_id) reversed.add(String(r.reverses_voucher_id));
    }
  }

  return staged
    .filter((s) => !reversed.has(s.voucherId) && !s.reversesVoucherId)
    .map((s) => {
      const { voucherId: _v, reversesVoucherId: _r, ...line } = s;
      void _v;
      void _r;
      return line;
    });
}

/** One vendor's full history, with a running balance of what is owed. */
export async function ledgerVendorStatement(input: {
  partyKey: string;
  asOf?: string;
}): Promise<{ ok: boolean; error?: string; statement?: VendorStatement }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };

  const { data: party, error: pErr } = await ctx.sb
    .from("ledger_parties")
    .select("id, external_id, name")
    .eq("tenant_id", ctx.tenantId)
    .eq("kind", "vendor")
    .eq("external_id", input.partyKey)
    .maybeSingle();
  if (pErr) return { ok: false, error: pErr.message };
  if (!party) return { ok: false, error: "No such vendor in the book" };

  const p = party as { id: string; external_id: string; name: string };
  const lines = await fetchVendorLines(ctx.sb, ctx.tenantId, [p.id]);
  return {
    ok: true,
    statement: buildVendorStatement({
      partyKey: p.external_id,
      name: p.name,
      lines,
      asOf: input.asOf || new Date().toISOString().slice(0, 10),
    }),
  };
}

/* ─── Finding a voucher, and fixing its head ────────────────── */

/**
 * Search the whole book, not the newest fifty.
 *
 * `ledgerRecentVouchers` answers "what just happened" and the book's table
 * was built on it, so 398 old-ERP vouchers posted on one September afternoon
 * were unreachable from the screen: they sit behind hundreds of fee receipts
 * in creation order. Everything here is filtered in the database where it can
 * be — dates, type, source, text — and only the head/party tests, which need
 * the lines, are applied after they are read.
 */
export async function ledgerSearchVouchers(input: {
  filter: VoucherFilter;
  limit?: number;
  offset?: number;
}): Promise<{
  ok: boolean;
  error?: string;
  rows: VoucherFacts[];
  total: number;
  /** Distinct values present in the book, so the filter offers only real options. */
  facets: { voucherTypes: string[]; sourceTypes: string[] };
}> {
  const empty = { rows: [], total: 0, facets: { voucherTypes: [], sourceTypes: [] } };
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured", ...empty };

  const f = input.filter ?? {};
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const offset = Math.max(input.offset ?? 0, 0);

  // 1. Narrow in the database first.
  const readVouchers = async (): Promise<Record<string, unknown>[]> => {
    const out: Record<string, unknown>[] = [];
    for (let from = 0; ; from += 1000) {
      let q = ctx.sb
        .from("ledger_vouchers")
        .select("id, voucher_no, voucher_type, voucher_date, narration, created_by, source_type, reverses_voucher_id")
        .eq("tenant_id", ctx.tenantId);
      if (f.from) q = q.gte("voucher_date", f.from);
      if (f.to) q = q.lte("voucher_date", f.to);
      if (f.voucherType) q = q.eq("voucher_type", f.voucherType);
      if (f.sourceType) q = q.eq("source_type", f.sourceType === "manual" ? "" : f.sourceType);
      const { data, error } = await q
        .order("voucher_date", { ascending: false })
        .order("voucher_no", { ascending: false })
        .range(from, from + 999);
      if (error) return out;
      const rows = (data ?? []) as Record<string, unknown>[];
      out.push(...rows);
      if (rows.length < 1000) break;
    }
    return out;
  };

  const [voucherRows, chart] = await Promise.all([readVouchers(), ledgerListAccounts()]);
  if (voucherRows.length === 0) return { ok: true, ...empty };

  // Which of these are reversed BY something. The book keeps no flag — the
  // reversal is the record — so it is read rather than trusted.
  const reversedIds = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await ctx.sb
      .from("ledger_vouchers")
      .select("reverses_voucher_id")
      .eq("tenant_id", ctx.tenantId)
      .not("reverses_voucher_id", "is", null)
      .range(from, from + 999);
    if (error) break;
    const rows = (data ?? []) as { reverses_voucher_id: string }[];
    for (const r of rows) reversedIds.add(String(r.reverses_voucher_id));
    if (rows.length < 1000) break;
  }

  // 2. Lines for those vouchers, chunked — `in` has a URL length limit.
  const ids = voucherRows.map((r) => String(r.id));
  const linesByVoucher = new Map<string, VoucherLineFacts[]>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await ctx.sb
        .from("ledger_lines")
        .select("voucher_id, line_no, debit_paise, credit_paise, ledger_accounts!inner(code, name), ledger_parties(name)")
        .eq("tenant_id", ctx.tenantId)
        .in("voucher_id", chunk)
        .order("line_no", { ascending: true })
        .range(from, from + 999);
      if (error) break;
      const rows = (data ?? []) as Record<string, unknown>[];
      for (const r of rows) {
        const a = r.ledger_accounts as { code?: string; name?: string } | null;
        const p = r.ledger_parties as { name?: string } | null;
        const vid = String(r.voucher_id);
        const list = linesByVoucher.get(vid) ?? [];
        list.push({
          accountCode: String(a?.code ?? ""),
          accountName: String(a?.name ?? ""),
          partyName: String(p?.name ?? ""),
          debitPaise: Number(r.debit_paise ?? 0),
          creditPaise: Number(r.credit_paise ?? 0),
        });
        linesByVoucher.set(vid, list);
      }
      if (rows.length < 1000) break;
    }
  }

  const facts: VoucherFacts[] = voucherRows.map((r) => ({
    id: String(r.id),
    voucherNo: String(r.voucher_no ?? ""),
    voucherType: String(r.voucher_type ?? ""),
    date: String(r.voucher_date ?? ""),
    narration: String(r.narration ?? ""),
    createdBy: String(r.created_by ?? ""),
    sourceType: String(r.source_type ?? ""),
    reversed: reversedIds.has(String(r.id)),
    isReversal: !!r.reverses_voucher_id,
    lines: linesByVoucher.get(String(r.id)) ?? [],
  }));

  // 3. The tests that need the lines.
  const chartForFilter = chart.map((a) => ({
    code: a.code,
    name: a.name,
    parentCode: a.parentCode || undefined,
    isCash: a.isCash,
    isBank: a.isBank,
  }));
  const byParent = childCodesByParent(chartForFilter);
  const matched = facts.filter((v) => matchesVoucherFilter(v, f, chartForFilter, byParent));

  // Facets come from everything read, not from the filtered page, so the
  // dropdowns do not empty themselves as soon as one is chosen.
  const voucherTypes = [...new Set(facts.map((v) => v.voucherType).filter(Boolean))].sort();
  const sourceTypes = [...new Set(facts.map((v) => v.sourceType || "manual"))].sort();

  return {
    ok: true,
    rows: matched.slice(offset, offset + limit),
    total: matched.length,
    facets: { voucherTypes, sourceTypes },
  };
}

/**
 * Move one line to a different head.
 *
 * Posts a journal; never edits the line. The book is append-only by design —
 * see `ledgerReverse` — so a correction has to leave both the original
 * classification and the fix on the record. An auditor reading the head sees
 * the amount arrive and where it came from.
 */
export async function ledgerReclassifyHead(input: {
  voucherId: string;
  lineIndex: number;
  toCode: string;
  reason: string;
  date?: string;
  actor: string;
}): Promise<{ ok: boolean; error?: string; voucherNo?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };

  // Read the one voucher directly — searching the book for it would read
  // every line in it to answer a question about one row.
  const { data: vRow, error: vErr } = await ctx.sb
    .from("ledger_vouchers")
    .select("id, voucher_no, voucher_type, voucher_date, narration, created_by, source_type, reverses_voucher_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", input.voucherId)
    .maybeSingle();
  if (vErr) return { ok: false, error: vErr.message };
  if (!vRow) return { ok: false, error: "No such voucher" };

  const { data: lRows, error: lErr } = await ctx.sb
    .from("ledger_lines")
    .select("line_no, debit_paise, credit_paise, ledger_accounts!inner(code, name), ledger_parties(name)")
    .eq("tenant_id", ctx.tenantId)
    .eq("voucher_id", input.voucherId)
    .order("line_no", { ascending: true });
  if (lErr) return { ok: false, error: lErr.message };

  const { data: revRow } = await ctx.sb
    .from("ledger_vouchers")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("reverses_voucher_id", input.voucherId)
    .limit(1);

  const chart = (await ledgerListAccounts()).map((a) => ({
    code: a.code,
    name: a.name,
    parentCode: a.parentCode || undefined,
    isCash: a.isCash,
    isBank: a.isBank,
  }));

  const voucher: VoucherFacts = {
    id: String(vRow.id),
    voucherNo: String(vRow.voucher_no ?? ""),
    voucherType: String(vRow.voucher_type ?? ""),
    date: String(vRow.voucher_date ?? ""),
    narration: String(vRow.narration ?? ""),
    createdBy: String(vRow.created_by ?? ""),
    sourceType: String(vRow.source_type ?? ""),
    reversed: (revRow ?? []).length > 0,
    isReversal: !!vRow.reverses_voucher_id,
    lines: ((lRows ?? []) as Record<string, unknown>[]).map((r) => {
      const a = r.ledger_accounts as { code?: string; name?: string } | null;
      const p = r.ledger_parties as { name?: string } | null;
      return {
        accountCode: String(a?.code ?? ""),
        accountName: String(a?.name ?? ""),
        partyName: String(p?.name ?? ""),
        debitPaise: Number(r.debit_paise ?? 0),
        creditPaise: Number(r.credit_paise ?? 0),
      };
    }),
  };

  const plan = planHeadReclass({
    voucher,
    lineIndex: input.lineIndex,
    toCode: input.toCode,
    chart,
    reason: input.reason,
  });
  if (!plan.ok || !plan.lines) return { ok: false, error: plan.error };

  // Dated today, not on the original's date: a correction made in September
  // belongs in September. Back-dating it into a closed month is how a locked
  // period silently moves.
  const date = input.date || new Date().toISOString().slice(0, 10);

  const res = await ledgerPost({
    voucherType: "journal",
    date,
    narration: plan.narration ?? "",
    // Idempotent per line: pressing the button twice posts one journal.
    sourceType: "head_reclass",
    sourceId: `${input.voucherId}:${input.lineIndex}:${input.toCode}`,
    createdBy: input.actor,
    lines: plan.lines.map((l) => ({
      accountCode: l.accountCode,
      debitPaise: l.debitPaise,
      creditPaise: l.creditPaise,
      narration: l.narration,
    })),
  });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, voucherNo: res.voucherNo };
}

/* ─── Voiding and amending a posted voucher ─────────────────── */

/** The one voucher, with its lines, in the shape the planners want. */
async function readVoucherFacts(voucherId: string): Promise<VoucherFacts | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data: vRow } = await ctx.sb
    .from("ledger_vouchers")
    .select("id, voucher_no, voucher_type, voucher_date, narration, created_by, source_type, reverses_voucher_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", voucherId)
    .maybeSingle();
  if (!vRow) return null;

  const { data: lRows } = await ctx.sb
    .from("ledger_lines")
    .select("line_no, debit_paise, credit_paise, ledger_accounts!inner(code, name), ledger_parties(name)")
    .eq("tenant_id", ctx.tenantId)
    .eq("voucher_id", voucherId)
    .order("line_no", { ascending: true });

  const { data: revRow } = await ctx.sb
    .from("ledger_vouchers")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("reverses_voucher_id", voucherId)
    .limit(1);

  return {
    id: String(vRow.id),
    voucherNo: String(vRow.voucher_no ?? ""),
    voucherType: String(vRow.voucher_type ?? ""),
    date: String(vRow.voucher_date ?? ""),
    narration: String(vRow.narration ?? ""),
    createdBy: String(vRow.created_by ?? ""),
    sourceType: String(vRow.source_type ?? ""),
    reversed: (revRow ?? []).length > 0,
    isReversal: !!vRow.reverses_voucher_id,
    lines: ((lRows ?? []) as Record<string, unknown>[]).map((r) => {
      const a = r.ledger_accounts as { code?: string; name?: string } | null;
      const p = r.ledger_parties as { name?: string } | null;
      return {
        accountCode: String(a?.code ?? ""),
        accountName: String(a?.name ?? ""),
        partyName: String(p?.name ?? ""),
        debitPaise: Number(r.debit_paise ?? 0),
        creditPaise: Number(r.credit_paise ?? 0),
      };
    }),
  };
}

/**
 * Void a voucher.
 *
 * This is `ledger_reverse` with a reason the operator had to type. Nothing
 * else needs adjusting: every balance in the system — trial balance, account
 * statement, party sub-ledger, the server book's own position — is derived
 * from `ledger_lines`, so the mirror posting moves all of them at once. The
 * RPC is idempotent (a second press returns the reversal that already
 * exists) and refuses to reverse a reversal.
 */
export async function ledgerVoidVoucher(input: {
  voucherId: string;
  reason: string;
  actor: string;
}): Promise<{ ok: boolean; error?: string; voucherNo?: string; alreadyVoided?: boolean }> {
  const voucher = await readVoucherFacts(input.voucherId);
  if (!voucher) return { ok: false, error: "No such voucher" };

  const plan = planVoid({ voucher, reason: input.reason });
  if (!plan.ok) return { ok: false, error: plan.error };

  const res = await ledgerReverse({
    voucherId: input.voucherId,
    reason: plan.reason,
    createdBy: input.actor,
  });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, voucherNo: res.voucherNo, alreadyVoided: res.created === false };
}

/**
 * Change a posted voucher: post the corrected one, then void the original.
 *
 * THE ORDER IS THE SAFETY
 * These are two round trips and cannot be one transaction from here, so one
 * of them can fail with the other already done. Voiding first would leave the
 * book short a voucher — money simply gone — and it cannot be put back,
 * because `ledger_reverse` refuses to reverse a reversal, so the void is not
 * undoable. Posting first leaves the opposite failure: the amount counted
 * twice for as long as it takes to reverse the replacement, which IS legal
 * because a replacement is an ordinary voucher.
 *
 * Between "briefly double" and "silently missing", double is the one you can
 * see and fix. So: validate, post, void, and on a failed void reverse the
 * replacement to put the book back exactly as it was.
 */
export async function ledgerAmendVoucher(input: {
  voucherId: string;
  lines: AmendLine[];
  date: string;
  narration: string;
  reason: string;
  actor: string;
}): Promise<{ ok: boolean; error?: string; voidedAs?: string; postedAs?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };

  const voucher = await readVoucherFacts(input.voucherId);
  if (!voucher) return { ok: false, error: "No such voucher" };

  const chart = await ledgerListAccounts();
  const plan = planAmend({
    voucher,
    lines: input.lines,
    date: input.date,
    narration: input.narration,
    reason: input.reason,
    postableCodes: new Set(chart.map((a) => a.code)),
  });
  if (!plan.ok) return { ok: false, error: plan.error };

  // 1. The replacement. A locked period or an unknown head is refused here,
  //    while the original is still untouched.
  const posted = await ledgerPost({
    voucherType: voucher.voucherType as never,
    date: input.date,
    narration: plan.narration,
    // Idempotent: a retry after a network timeout lands once rather than
    // posting the correction twice.
    sourceType: "voucher_amend",
    sourceId: `${input.voucherId}:${input.date}`,
    createdBy: input.actor,
    lines: plan.lines.map((l) => ({
      accountCode: l.accountCode,
      debitPaise: l.debitPaise,
      creditPaise: l.creditPaise,
      narration: l.narration ?? "",
      party: l.party
        ? { kind: l.party.kind as never, externalId: l.party.externalId, name: l.party.name }
        : undefined,
    })),
  });
  if (!posted.ok) {
    return { ok: false, error: `Nothing was changed — the replacement was refused: ${posted.error}` };
  }

  // 2. Void the original.
  const voided = await ledgerReverse({
    voucherId: input.voucherId,
    reason: plan.voidReason,
    createdBy: input.actor,
  });

  if (!voided.ok) {
    // Take the replacement back out, so the book is where it started.
    const undo = posted.voucherId
      ? await ledgerReverse({
          voucherId: posted.voucherId,
          reason: `${voucher.voucherNo} could not be voided, so its replacement is withdrawn`,
          createdBy: input.actor,
        })
      : null;
    if (undo?.ok) {
      return {
        ok: false,
        error: `Nothing was changed — ${voucher.voucherNo} could not be voided (${voided.error}), so the replacement was withdrawn.`,
      };
    }
    return {
      ok: false,
      error:
        `${voucher.voucherNo} could not be voided (${voided.error}) and the replacement ${posted.voucherNo} could not be ` +
        `withdrawn either. BOTH are now in the book and this amount is counted twice — void ${posted.voucherNo} by hand.`,
    };
  }

  return { ok: true, voidedAs: voided.voucherNo, postedAs: posted.voucherNo };
}

export async function ledgerListParties(): Promise<
  { kind: string; externalId: string; name: string }[]
> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const out: { kind: string; externalId: string; name: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await ctx.sb
      .from("ledger_parties")
      .select("kind, external_id, name")
      .eq("tenant_id", ctx.tenantId)
      .order("name", { ascending: true })
      .range(from, from + 999);
    if (error) break;
    const rows = (data ?? []) as Record<string, unknown>[];
    for (const r of rows) {
      out.push({
        kind: String(r.kind ?? ""),
        externalId: String(r.external_id ?? ""),
        name: String(r.name ?? ""),
      });
    }
    if (rows.length < 1000) break;
  }
  return out;
}
