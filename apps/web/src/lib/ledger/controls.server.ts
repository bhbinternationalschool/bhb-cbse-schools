/**
 * Ledger v2 — running the controls against the server book.
 *
 * Gathers the facts the pure rules need, runs them, and assembles the daily
 * position a director actually looks at. The judgement lives in anomalies.ts
 * and ageing.ts; this is the plumbing.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import {
  DEFAULT_ANOMALY_THRESHOLDS,
  runAnomalyChecks,
  summariseAnomalies,
  type Anomaly,
  type AnomalyFacts,
  type AnomalyThresholds,
} from "@/lib/ledger/anomalies";
import { buildAgeing, type AgeingItem, type AgeingReport } from "@/lib/ledger/ageing";
import { periodBalances } from "@/lib/ledger/reports.server";
import { L_ACCOUNTS_PAYABLE, L_FEE_RECEIVABLE, L_STORE_RECEIVABLE } from "@/lib/ledger/coa";

/** Everything the rules need, in one pass over the book. */
async function gatherFacts(asOf: string): Promise<AnomalyFacts | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { sb, tenantId } = ctx;

  // Paged. The book passed a thousand vouchers in August; an unpaged read
  // returns the first thousand and reports success, so every control ran on
  // a third of the book and a reversed pair whose halves fell either side of
  // the cut looked like two unexplained entries (2026-09-05).
  const readVouchers = async (): Promise<Record<string, unknown>[]> => {
    const out: Record<string, unknown>[] = [];
    const page = 1000;
    for (let from = 0; ; from += page) {
      const { data, error } = await sb
        .from("ledger_vouchers")
        .select("id, voucher_no, voucher_type, voucher_date, created_at, narration, source_type, source_id, created_by, reverses_voucher_id")
        .eq("tenant_id", tenantId)
        .lte("voucher_date", asOf)
        .order("id", { ascending: true })
        .range(from, from + page - 1);
      if (error) break;
      const rows = (data ?? []) as Record<string, unknown>[];
      out.push(...rows);
      if (rows.length < page) break;
    }
    return out;
  };

  const [voucherRows, balancesRes, periodsRes] = await Promise.all([
    readVouchers(),
    periodBalances({ from: "0001-01-01", to: asOf }),
    sb.from("ledger_periods").select("period, status").eq("tenant_id", tenantId),
  ]);

  // A voucher is "reversed" when something points at it. Collected here rather
  // than trusted from a flag, because the ledger has no such flag by design —
  // the reversal is the record.
  const reversedIds = new Set(
    voucherRows
      .map((r) => (r.reverses_voucher_id ? String(r.reverses_voucher_id) : ""))
      .filter(Boolean),
  );

  const ids = voucherRows.map((r) => String(r.id));
  const lines: AnomalyFacts["lines"] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    if (chunk.length === 0) continue;
    const chunkLines: Record<string, unknown>[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb
        .from("ledger_lines")
        .select("voucher_id, debit_paise, credit_paise, instrument_ref, party_id, ledger_accounts!inner(code), ledger_parties(external_id, name, kind)")
        .eq("tenant_id", tenantId)
        .in("voucher_id", chunk)
        .order("id", { ascending: true })
        .range(from, from + 999);
      if (error) break;
      const rows = (data ?? []) as Record<string, unknown>[];
      chunkLines.push(...rows);
      if (rows.length < 1000) break;
    }
    for (const r of chunkLines) {
      const acct = r.ledger_accounts as { code?: string } | null;
      const party = r.ledger_parties as { external_id?: string; name?: string; kind?: string } | null;
      lines.push({
        voucherId: String(r.voucher_id),
        accountCode: String(acct?.code ?? ""),
        partyKey: party?.external_id ? `${party.kind ?? "other"}:${party.external_id}` : "",
        partyName: String(party?.name ?? ""),
        debitPaise: Number(r.debit_paise ?? 0),
        creditPaise: Number(r.credit_paise ?? 0),
        instrumentRef: String(r.instrument_ref ?? ""),
      });
    }
  }

  // Unreconciled bank items, both sides. Absent the P3 tables (an older
  // deployment) this is simply empty rather than an error — the other rules
  // still run.
  const unreconciled: AnomalyFacts["unreconciled"] = [];
  // A reversed entry and its reversal will never reach a bank statement —
  // together they are nothing. Listing both as "an entry the bank has never
  // seen" once buried the controls page under 270 warnings that cancelled
  // each other out (2026-09-05).
  const cancelledVoucherNos = new Set(
    voucherRows
      .filter((r) => reversedIds.has(String(r.id)) || !!r.reverses_voucher_id)
      .map((r) => String(r.voucher_no ?? ""))
      .filter(Boolean),
  );
  const { data: bookUnmatched } = await sb
    .from("ledger_v_bank_book")
    .select("ledger_line_id, voucher_date, signed_paise, line_narration, voucher_no, match_id")
    .eq("tenant_id", tenantId)
    .is("match_id", null);
  for (const r of (bookUnmatched ?? []) as Record<string, unknown>[]) {
    if (cancelledVoucherNos.has(String(r.voucher_no ?? ""))) continue;
    unreconciled.push({
      side: "book",
      id: String(r.ledger_line_id),
      date: String(r.voucher_date ?? ""),
      signedPaise: Number(r.signed_paise ?? 0),
      narration: String(r.line_narration || r.voucher_no || ""),
    });
  }
  const { data: stmtUnmatched } = await sb
    .from("ledger_v_statement_lines")
    .select("statement_line_id, txn_date, signed_paise, narration, match_id")
    .eq("tenant_id", tenantId)
    .is("match_id", null);
  for (const r of (stmtUnmatched ?? []) as Record<string, unknown>[]) {
    unreconciled.push({
      side: "statement",
      id: String(r.statement_line_id),
      date: String(r.txn_date ?? ""),
      signedPaise: Number(r.signed_paise ?? 0),
      narration: String(r.narration ?? ""),
    });
  }

  const { data: acctFlags } = await sb
    .from("ledger_accounts")
    .select("code, is_cash, is_bank")
    .eq("tenant_id", tenantId);
  const flags = new Map(
    ((acctFlags ?? []) as { code: string; is_cash: boolean; is_bank: boolean }[]).map((r) => [
      String(r.code),
      { isCash: !!r.is_cash, isBank: !!r.is_bank },
    ]),
  );

  return {
    asOf,
    vouchers: voucherRows.map((r) => ({
      id: String(r.id),
      voucherNo: String(r.voucher_no ?? ""),
      voucherType: String(r.voucher_type ?? ""),
      date: String(r.voucher_date ?? ""),
      createdAt: String(r.created_at ?? ""),
      narration: String(r.narration ?? ""),
      sourceType: String(r.source_type ?? ""),
      sourceId: String(r.source_id ?? ""),
      createdBy: String(r.created_by ?? ""),
      reversed: reversedIds.has(String(r.id)),
    })),
    lines,
    unreconciled,
    balances: (balancesRes.rows ?? []).map((b) => ({
      code: b.code,
      name: b.name,
      kind: b.kind,
      isCash: flags.get(b.code)?.isCash ?? false,
      isBank: flags.get(b.code)?.isBank ?? false,
      closingPaise: b.closingPaise,
    })),
    reopenedPeriods: ((periodsRes.data ?? []) as { period: string; status: string }[]).map((p) => ({
      period: String(p.period),
      status: String(p.status),
    })),
  };
}

export async function ledgerAnomalies(input: {
  asOf: string;
  thresholds?: Partial<AnomalyThresholds>;
}): Promise<{ ok: boolean; error?: string; anomalies: Anomaly[]; summary: ReturnType<typeof summariseAnomalies> }> {
  const facts = await gatherFacts(input.asOf);
  if (!facts) {
    return {
      ok: false,
      error: "Supabase tenant not configured",
      anomalies: [],
      summary: { critical: 0, warning: 0, info: 0, totalAmountPaise: 0 },
    };
  }
  const anomalies = runAnomalyChecks(facts, {
    ...DEFAULT_ANOMALY_THRESHOLDS,
    ...(input.thresholds ?? {}),
  });
  const all = [...(await feeReceiptsWithoutLines()), ...anomalies];
  return { ok: true, anomalies: all, summary: summariseAnomalies(all) };
}

/**
 * Live fee receipts that hold money but name nothing.
 *
 * A receipt clears its dues THROUGH its lines, so one without them takes the
 * money and leaves every month it paid still reading unpaid — while showing
 * the family a guardian name and an amount and nothing else. On 2026-09-01 a
 * single desk push left 134 receipts in exactly that state, worth 5,80,543,
 * and it was noticed only because a parent's fee page looked wrong.
 *
 * The push that caused it is fixed. This is here so that if the state ever
 * arises again — by that route or another — it is reported the same day
 * rather than found weeks later. It reads the fee desk directly: the ledger
 * cannot see it, because the ledger voucher for such a receipt is perfectly
 * balanced and says nothing about which due was paid.
 */
async function feeReceiptsWithoutLines(): Promise<Anomaly[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const { sb, tenantId } = ctx;

  // Paged, both of them. PostgREST caps a request at 1000 rows and reports the
  // truncation as success; with 1,913 line rows, the unpaged read saw the
  // first thousand and declared 214 receipts (₹9.9 lakh) to be without lines
  // when exactly one was (2026-09-05). A control that cries wolf is worse than
  // no control.
  const page = 1000;
  const readVouchers = async () => {
    const out: { id: string; receipt_no: string; total_paise: number }[] = [];
    for (let from = 0; ; from += page) {
      const { data, error } = await sb
        .from("fee_desk_vouchers")
        .select("id, receipt_no, total_paise")
        .eq("tenant_id", tenantId)
        .is("voided_at", null)
        .order("id", { ascending: true })
        .range(from, from + page - 1);
      if (error) return null;
      const rows = (data ?? []) as { id: string; receipt_no: string; total_paise: number }[];
      out.push(...rows);
      if (rows.length < page) break;
    }
    return out;
  };
  const readLines = async () => {
    const out: { voucher_id: string }[] = [];
    for (let from = 0; ; from += page) {
      const { data, error } = await sb
        .from("fee_desk_voucher_lines")
        .select("id, voucher_id")
        .eq("tenant_id", tenantId)
        .order("id", { ascending: true })
        .range(from, from + page - 1);
      if (error) return null;
      const rows = (data ?? []) as { voucher_id: string }[];
      out.push(...rows);
      if (rows.length < page) break;
    }
    return out;
  };
  const [vouchers, lines] = await Promise.all([readVouchers(), readLines()]);
  if (!vouchers || !lines) return [];

  const withLines = new Set(lines.map((l) => String(l.voucher_id)));
  const orphans = (vouchers as { id: string; receipt_no: string; total_paise: number }[])
    .filter((v) => !withLines.has(v.id));
  if (orphans.length === 0) return [];

  const amountPaise = orphans.reduce((n, v) => n + Number(v.total_paise || 0), 0);
  const receipts = orphans
    .map((v) => v.receipt_no)
    .sort()
    .slice(0, 12);
  return [
    {
      code: "fee_receipt_without_lines",
      severity: "critical",
      title: "Fee receipts that name no student, head or month",
      detail:
        `${orphans.length} live receipt(s) worth ${rupeesFromPaise(amountPaise)} hold money but have no lines. ` +
        "A receipt clears its dues through its lines, so every month these paid still reads unpaid.",
      references: receipts,
      amountPaise,
      suggestedAction:
        "Do not re-collect from these families until the lines are restored — the money was taken.",
    },
  ];
}

function rupeesFromPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/* ─── Ageing ───────────────────────────────────────────────── */

/**
 * Outstanding per party against a control account.
 *
 * Each voucher's net movement on that account for the party is one ageing
 * item, carrying the voucher's due date where it has one.
 */
async function ageingItemsFor(controlCode: string): Promise<AgeingItem[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  // Paged: the store receivable alone carries a line per sale.
  const data: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page } = await ctx.sb
      .from("ledger_lines")
      .select("voucher_id, debit_paise, credit_paise, ledger_accounts!inner(code), ledger_parties(external_id, name, kind), ledger_vouchers!inner(voucher_no, voucher_date, due_date)")
      .eq("tenant_id", ctx.tenantId)
      .eq("ledger_accounts.code", controlCode)
      .order("id", { ascending: true })
      .range(from, from + 999);
    const rows = (page ?? []) as Record<string, unknown>[];
    data.push(...rows);
    if (rows.length < 1000) break;
  }

  const byKey = new Map<string, AgeingItem>();
  for (const r of data) {
    const party = r.ledger_parties as { external_id?: string; name?: string; kind?: string } | null;
    const voucher = r.ledger_vouchers as { voucher_no?: string; voucher_date?: string; due_date?: string } | null;
    if (!party?.external_id) continue;
    const partyKey = `${party.kind ?? "other"}:${party.external_id}`;
    const key = `${partyKey}|${String(r.voucher_id)}`;
    // Credit increases what is owed to a supplier; debit reduces it.
    const outstanding = Number(r.credit_paise ?? 0) - Number(r.debit_paise ?? 0);
    const existing = byKey.get(key);
    if (existing) {
      existing.outstandingPaise += outstanding;
    } else {
      byKey.set(key, {
        partyKey,
        partyName: String(party.name ?? ""),
        voucherNo: String(voucher?.voucher_no ?? ""),
        voucherDate: String(voucher?.voucher_date ?? ""),
        dueDate: voucher?.due_date ? String(voucher.due_date) : null,
        outstandingPaise: outstanding,
      });
    }
  }
  // Both sides go through: buildAgeing applies payments against bills. Filtering
  // to positives here would drop every payment and leave settled bills showing
  // as outstanding for ever.
  return [...byKey.values()].filter((i) => i.outstandingPaise !== 0);
}

export async function payablesAgeing(asOf: string): Promise<AgeingReport> {
  return buildAgeing({ asOf, items: await ageingItemsFor(L_ACCOUNTS_PAYABLE) });
}

export async function receivablesAgeing(asOf: string): Promise<AgeingReport> {
  const [fees, store] = await Promise.all([
    ageingItemsFor(L_FEE_RECEIVABLE),
    ageingItemsFor(L_STORE_RECEIVABLE),
  ]);
  // Receivables are the mirror of payables: a debit is what is owed to us.
  const flip = (items: AgeingItem[]) =>
    items.map((i) => ({ ...i, outstandingPaise: -i.outstandingPaise }));
  return buildAgeing({ asOf, items: [...flip(fees), ...flip(store)] });
}

/* ─── The cockpit ──────────────────────────────────────────── */

export type Cockpit = {
  ok: boolean;
  error?: string;
  asOf: string;
  cashPaise: number;
  bankPaise: number;
  chequesInHandPaise: number;
  payablesPaise: number;
  receivablesPaise: number;
  incomeThisYearPaise: number;
  expenditureThisYearPaise: number;
  surplusThisYearPaise: number;
  banks?: { code: string; name: string; closingPaise: number }[];
  anomalies: Anomaly[];
  summary: ReturnType<typeof summariseAnomalies>;
  payablesAgeing: AgeingReport;
};

/**
 * The one screen a director reads in the morning.
 *
 * Deliberately small. A dashboard that shows forty numbers gets skimmed; this
 * shows the position, what is owed each way, and anything that looks wrong.
 */
export type LedgerPosition = {
  ok: boolean;
  error?: string;
  asOf: string;
  cashPaise: number;
  bankPaise: number;
  /** Every bank account with its own balance — the total alone hides a negative one. */
  banks: { code: string; name: string; closingPaise: number }[];
  chequesInHandPaise: number;
  payablesPaise: number;
  receivablesPaise: number;
  incomeThisYearPaise: number;
  expenditureThisYearPaise: number;
  surplusThisYearPaise: number;
};

/**
 * The position alone — balances, no controls, no ageing.
 *
 * The dashboard needs these five numbers within a second of opening; the
 * cockpit's controls take several seconds over a book of thousands of
 * vouchers, and while they ran the dashboard was showing browser-book figures
 * that said cash ₹0. Cash and bank are the SUM of every account flagged as
 * such: the earlier read took the bank GROUP's own balance (1010) and so
 * reported "at bank ₹40,501" while UBI-Main stood at −₹21,465 beneath it.
 */
export async function ledgerPosition(input: {
  asOf: string;
  fyFrom: string;
}): Promise<LedgerPosition> {
  const ctx = await getServerTenantContext();
  const [balances, flagsRes] = await Promise.all([
    periodBalances({ from: input.fyFrom, to: input.asOf }),
    ctx
      ? ctx.sb.from("ledger_accounts").select("code, is_cash, is_bank").eq("tenant_id", ctx.tenantId)
      : Promise.resolve({ data: [] as { code: string; is_cash: boolean; is_bank: boolean }[] }),
  ]);
  const empty: LedgerPosition = {
    ok: false,
    error: balances.error,
    asOf: input.asOf,
    cashPaise: 0, bankPaise: 0, banks: [], chequesInHandPaise: 0,
    payablesPaise: 0, receivablesPaise: 0,
    incomeThisYearPaise: 0, expenditureThisYearPaise: 0, surplusThisYearPaise: 0,
  };
  if (!balances.ok) return empty;

  const flags = new Map(
    ((flagsRes.data ?? []) as { code: string; is_cash: boolean; is_bank: boolean }[]).map((r) => [
      String(r.code),
      { isCash: !!r.is_cash, isBank: !!r.is_bank },
    ]),
  );
  const at = (code: string) => balances.rows.find((r) => r.code === code)?.closingPaise ?? 0;
  const cashRows = balances.rows.filter((r) => flags.get(r.code)?.isCash);
  const bankRows = balances.rows.filter((r) => flags.get(r.code)?.isBank);
  const income = balances.rows
    .filter((r) => r.kind === "income")
    .reduce((n, r) => n + (r.creditPaise - r.debitPaise), 0);
  const expenditure = balances.rows
    .filter((r) => r.kind === "expense")
    .reduce((n, r) => n + (r.debitPaise - r.creditPaise), 0);

  return {
    ok: true,
    asOf: input.asOf,
    cashPaise: cashRows.length ? cashRows.reduce((n, r) => n + r.closingPaise, 0) : at("1000"),
    bankPaise: bankRows.length ? bankRows.reduce((n, r) => n + r.closingPaise, 0) : at("1010"),
    banks: bankRows
      .filter((r) => r.closingPaise !== 0 || r.debitPaise !== 0 || r.creditPaise !== 0)
      .map((r) => ({ code: r.code, name: r.name, closingPaise: r.closingPaise })),
    chequesInHandPaise: at("1050"),
    payablesPaise: at(L_ACCOUNTS_PAYABLE),
    receivablesPaise: at(L_FEE_RECEIVABLE) + at(L_STORE_RECEIVABLE),
    incomeThisYearPaise: income,
    expenditureThisYearPaise: expenditure,
    surplusThisYearPaise: income - expenditure,
  };
}

export async function ledgerCockpit(input: {
  asOf: string;
  fyFrom: string;
}): Promise<Cockpit> {
  const [position, checks, ageing] = await Promise.all([
    ledgerPosition(input),
    ledgerAnomalies({ asOf: input.asOf }),
    payablesAgeing(input.asOf),
  ]);

  if (!position.ok) {
    return {
      ok: false,
      error: position.error,
      asOf: input.asOf,
      cashPaise: 0, bankPaise: 0, chequesInHandPaise: 0,
      payablesPaise: 0, receivablesPaise: 0,
      incomeThisYearPaise: 0, expenditureThisYearPaise: 0, surplusThisYearPaise: 0,
      anomalies: [], summary: { critical: 0, warning: 0, info: 0, totalAmountPaise: 0 },
      payablesAgeing: ageing,
    };
  }

  const { ok: _ok, error: _err, ...figures } = position;
  void _ok;
  void _err;
  return {
    ok: true,
    ...figures,
    anomalies: checks.anomalies,
    summary: checks.summary,
    payablesAgeing: ageing,
  };
}
