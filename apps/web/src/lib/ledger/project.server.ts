/**
 * Ledger v2 — project the desk's records into the book.
 *
 * Why this reads the database and not the client's payload
 * ───────────────────────────────────────────────────────
 * P1 mirrored each desk journal to the ledger as the browser wrote it. That
 * works, but it inherits the weakness the whole audit was about: it is only as
 * complete as whatever the pushing browser happened to be holding, and an
 * event that fails to send is simply missing.
 *
 * This projects from the rows already persisted in the desk tables instead.
 * Three things fall out of that, and they are the reason it is worth doing:
 *
 *   - Forward posting and backfill become the same code. There is no separate
 *     migration script to write, get wrong, and run once.
 *   - It is self-healing. A run that missed something is fixed by the next
 *     run, because the source of truth is the table, not a message.
 *   - It is idempotent end to end. ledger_post keys on (source_type,
 *     source_id), so re-projecting the same receipt a hundred times produces
 *     one voucher.
 *
 * A record that has since been voided or cancelled is reversed if it reached
 * the ledger, and skipped if it never did — a receipt cancelled before this
 * code existed is not worth a matched pair of entries that net to nothing.
 *
 * Anything that cannot be represented faithfully is refused and reported
 * rather than forced. See ledgerReconciliation, which is the exit criterion
 * for the phase: every desk record accounted for, in both directions.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import {
  ensureFiscalYearForDate,
  ledgerPost,
  ledgerReverse,
} from "@/lib/ledger/ledger.server";
import {
  buildExpenseVoucher,
  buildFeeReceiptVoucher,
  buildPayrollAccrualVoucher,
  buildPayrollPaymentVoucher,
  buildVendorBillVoucher,
  monthEndIso,
  sessionStartOf,
  type BuildResult,
} from "@/lib/ledger/projectionMap";
import { L_FEE_ADVANCES, L_FEE_INCOME } from "@/lib/ledger/coa";
import type { LedgerVoucherInput } from "@/lib/ledger/types";

export type ProjectionOutcome = {
  source: string;
  scanned: number;
  posted: number;
  alreadyPosted: number;
  reversed: number;
  skipped: number;
  refused: { sourceId: string; reason: string }[];
};

function emptyOutcome(source: string): ProjectionOutcome {
  return {
    source,
    scanned: 0,
    posted: 0,
    alreadyPosted: 0,
    reversed: 0,
    skipped: 0,
    refused: [],
  };
}

type Existing = Map<string, { voucherId: string; reversed: boolean }>;

/**
 * What this source type already has in the book, and whether it was reversed.
 *
 * Two queries rather than a join, because the reversal points at the original
 * by id and PostgREST cannot express that self-reference cleanly.
 */
async function existingBySource(
  sourceTypes: string[],
): Promise<{ ok: boolean; map: Existing; error?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, map: new Map(), error: "Supabase tenant not configured" };

  // Paged: an unbounded select stops at PostgREST's maximum and reports the
  // truncation as success. A projector that cannot see the vouchers already
  // posted will post them all again — which is exactly what happened on
  // 2026-09-01, 360 fee receipts booked a second time.
  const rows: { id: string; source_type: string; source_id: string }[] = [];
  {
    const PAGE = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await ctx.sb
        .from("ledger_vouchers")
        .select("id, source_type, source_id")
        .eq("tenant_id", ctx.tenantId)
        .in("source_type", sourceTypes)
        .range(from, from + PAGE - 1);
      if (error) return { ok: false, map: new Map(), error: error.message };
      const page = (data ?? []) as { id: string; source_type: string; source_id: string }[];
      rows.push(...page);
      if (page.length < PAGE) break;
      from += PAGE;
    }
  }
  const ids = rows.map((r) => r.id);

  const reversed = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    if (chunk.length === 0) continue;
    const { data: revs } = await ctx.sb
      .from("ledger_vouchers")
      .select("reverses_voucher_id")
      .eq("tenant_id", ctx.tenantId)
      .in("reverses_voucher_id", chunk);
    for (const r of (revs ?? []) as { reverses_voucher_id: string }[]) {
      if (r.reverses_voucher_id) reversed.add(r.reverses_voucher_id);
    }
  }

  const map: Existing = new Map();
  for (const r of rows) {
    map.set(`${r.source_type}:${r.source_id}`, {
      voucherId: r.id,
      reversed: reversed.has(r.id),
    });
  }
  return { ok: true, map };
}

/**
 * One record's turn through the book.
 *
 * Everything a projector needs to decide is here: post it, reverse it, leave
 * it alone, or refuse it with a reason somebody can act on.
 */
/**
 * Is this desk record already in the book — under ANY of its labels?
 *
 * One record can be posted by more than one path, and each path knows it by
 * its own source type. A fee receipt is booked live by the counter as
 * `fee_voucher`; the projection knows the same receipt as `fee_receipt`.
 * Asking only under one's own label is how the projection posted 360 receipts
 * a second time on 2026-09-01 and doubled fee income: neither side's
 * idempotency check could see the other's work.
 *
 * A reversed prior still counts as found — the caller decides what to do
 * about it — because "posted then reversed" is not the same as "never posted".
 */
export function findPriorPosting(
  existing: Existing,
  key: string,
  alsoKeys?: string[],
): { voucherId: string; reversed: boolean } | undefined {
  const hit = existing.get(key);
  if (hit) return hit;
  for (const k of alsoKeys ?? []) {
    const alt = existing.get(k);
    if (alt) return alt;
  }
  return undefined;
}

async function applyRecord(opts: {
  key: string;
  /**
   * Other source types that mean THE SAME desk record is already booked.
   *
   * A fee receipt is posted live by the counter as `fee_voucher`; the
   * projection knows it as `fee_receipt`. Looking only under its own label,
   * the projection saw nothing and posted all 360 again — income doubled and
   * neither side's idempotency check could see the other's work.
   */
  alsoKeys?: string[];
  existing: Existing;
  cancelled: boolean;
  cancelReason: string;
  build: () => BuildResult;
  outcome: ProjectionOutcome;
  sourceId: string;
}): Promise<void> {
  const { key, existing, cancelled, build, outcome, sourceId } = opts;
  const prior = findPriorPosting(existing, key, opts.alsoKeys);

  if (cancelled) {
    if (!prior) {
      // Voided before it ever reached the ledger. Posting it now only to
      // reverse it in the next breath would add a pair of entries that say
      // nothing.
      outcome.skipped += 1;
      return;
    }
    if (prior.reversed) {
      outcome.alreadyPosted += 1;
      return;
    }
    const res = await ledgerReverse({
      voucherId: prior.voucherId,
      reason: opts.cancelReason || "Cancelled on the desk",
    });
    if (res.ok) outcome.reversed += 1;
    else outcome.refused.push({ sourceId, reason: res.error });
    return;
  }

  if (prior) {
    outcome.alreadyPosted += 1;
    return;
  }

  const built = build();
  if (!built.ok) {
    outcome.refused.push({ sourceId, reason: built.reason });
    return;
  }

  const fy = await ensureFiscalYearForDate(built.voucher.date);
  if (!fy.ok) {
    outcome.refused.push({ sourceId, reason: fy.error ?? "could not open a fiscal year" });
    return;
  }

  const res = await postWithGuard(built.voucher);
  if (res.ok) outcome.posted += 1;
  else outcome.refused.push({ sourceId, reason: res.error });
}

async function postWithGuard(
  voucher: LedgerVoucherInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await ledgerPost(voucher);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/* ─── Fee receipts ─────────────────────────────────────────── */

export async function projectFeeReceipts(opts?: {
  limit?: number;
}): Promise<ProjectionOutcome> {
  const outcome = emptyOutcome("fee_receipt");
  const ctx = await getServerTenantContext();
  if (!ctx) {
    outcome.refused.push({ sourceId: "-", reason: "Supabase tenant not configured" });
    return outcome;
  }

  const { data: vouchers, error } = await ctx.sb
    .from("fee_desk_vouchers")
    .select(
      "id, household_id, receipt_no, collection_date, total_paise, cashier_name, voided_at, academic_year_code",
    )
    .eq("tenant_id", ctx.tenantId)
    .order("collection_date")
    .limit(opts?.limit ?? 2000);
  if (error) {
    outcome.refused.push({ sourceId: "-", reason: error.message });
    return outcome;
  }

  const rows = (vouchers ?? []) as Record<string, unknown>[];
  outcome.scanned = rows.length;
  if (rows.length === 0) return outcome;

  const ids = rows.map((r) => String(r.id));
  const [{ data: tenders }, { data: lines }] = await Promise.all([
    ctx.sb
      .from("fee_desk_voucher_tenders")
      .select("voucher_id, mode, amount_paise, ref, instrument_date, tender_json")
      .eq("tenant_id", ctx.tenantId)
      .in("voucher_id", ids),
    ctx.sb
      .from("fee_desk_voucher_lines")
      .select("voucher_id, kind, amount_paise")
      .eq("tenant_id", ctx.tenantId)
      .in("voucher_id", ids),
  ]);

  const tendersBy = new Map<string, Record<string, unknown>[]>();
  for (const t of (tenders ?? []) as Record<string, unknown>[]) {
    const k = String(t.voucher_id);
    (tendersBy.get(k) ?? tendersBy.set(k, []).get(k)!).push(t);
  }
  const linesBy = new Map<string, Record<string, unknown>[]>();
  for (const l of (lines ?? []) as Record<string, unknown>[]) {
    const k = String(l.voucher_id);
    (linesBy.get(k) ?? linesBy.set(k, []).get(k)!).push(l);
  }

  // Both labels: the counter posts a receipt live as `fee_voucher` through the
  // fee_desk_vouchers trigger, and this projector would otherwise post the
  // very same receipt again as `fee_receipt`.
  const existing = await existingBySource(["fee_receipt", "fee_voucher"]);
  if (!existing.ok) {
    outcome.refused.push({ sourceId: "-", reason: existing.error ?? "read failed" });
    return outcome;
  }

  // Advance receipts are tagged with their session as a cost centre, and
  // ledger_post silently drops a cost centre it has never heard of — so the
  // centres must exist BEFORE the vouchers post, or the tag (and with it any
  // way to release the right session's pile) is lost.
  const advanceYears = new Set<string>();
  for (const row of rows) {
    const year = String(row.academic_year_code ?? "");
    const start = sessionStartOf(year);
    if (start && String(row.collection_date ?? "") < start) advanceYears.add(year);
  }
  if (advanceYears.size > 0) {
    const { error: ccErr } = await ctx.sb.from("ledger_cost_centres").upsert(
      [...advanceYears].map((y) => ({
        tenant_id: ctx.tenantId,
        code: y,
        name: `Session ${y}`,
      })),
      { onConflict: "tenant_id,code" },
    );
    if (ccErr) {
      outcome.refused.push({ sourceId: "-", reason: `cost centres: ${ccErr.message}` });
      return outcome;
    }
  }

  for (const row of rows) {
    const id = String(row.id);
    await applyRecord({
      key: `fee_receipt:${id}`,
      alsoKeys: [`fee_voucher:${id}`],
      existing: existing.map,
      cancelled: !!row.voided_at,
      cancelReason: "Fee receipt voided",
      sourceId: id,
      outcome,
      build: () =>
        buildFeeReceiptVoucher({
          voucher: {
            id,
            householdId: String(row.household_id ?? ""),
            receiptNo: String(row.receipt_no ?? ""),
            collectionDate: String(row.collection_date ?? ""),
            totalPaise: Number(row.total_paise ?? 0),
            cashierName: String(row.cashier_name ?? ""),
            voidedAt: row.voided_at ? String(row.voided_at) : null,
            academicYearCode: String(row.academic_year_code ?? ""),
          },
          tenders: (tendersBy.get(id) ?? []).map((t) => {
            const j = (t.tender_json ?? {}) as Record<string, unknown>;
            return {
              mode: String(t.mode ?? ""),
              amountPaise: Number(t.amount_paise ?? 0),
              ref: String(t.ref ?? ""),
              instrumentDate: t.instrument_date ? String(t.instrument_date) : null,
              bankAccountId: String(j.bankAccountId ?? ""),
              gatewayProvider: String(j.gatewayProvider ?? ""),
            };
          }),
          lines: (linesBy.get(id) ?? []).map((l) => ({
            kind: String(l.kind ?? ""),
            amountPaise: Number(l.amount_paise ?? 0),
          })),
        }),
    });
  }

  return outcome;
}

/* ─── Expense vouchers ─────────────────────────────────────── */

/** category id → the COA code the desk mapped it to. */
async function expenseCategoryCodes(): Promise<Map<string, string>> {
  const ctx = await getServerTenantContext();
  if (!ctx) return new Map();
  const { data } = await ctx.sb
    .from("accounts_desk_expense_categories")
    .select("id, coa_code")
    .eq("tenant_id", ctx.tenantId);
  const m = new Map<string, string>();
  for (const r of (data ?? []) as { id: string; coa_code: string }[]) {
    if (r.coa_code) m.set(String(r.id), String(r.coa_code));
  }
  return m;
}

const FALLBACK_EXPENSE_CODE = "5900";

export async function projectExpenseVouchers(opts?: {
  limit?: number;
}): Promise<ProjectionOutcome> {
  const outcome = emptyOutcome("expense_voucher");
  const ctx = await getServerTenantContext();
  if (!ctx) {
    outcome.refused.push({ sourceId: "-", reason: "Supabase tenant not configured" });
    return outcome;
  }

  const [{ data, error }, codes, existing] = await Promise.all([
    ctx.sb
      .from("accounts_desk_expense_vouchers")
      .select(
        "id, voucher_no, voucher_date, category_id, vendor_id, grand_total_paise, paid_paise, due_paise, mode, bank_id, narration, approved_by, cancelled_at, cancel_reason",
      )
      .eq("tenant_id", ctx.tenantId)
      .order("voucher_date")
      .limit(opts?.limit ?? 2000),
    expenseCategoryCodes(),
    existingBySource(["expense_voucher"]),
  ]);
  if (error) {
    outcome.refused.push({ sourceId: "-", reason: error.message });
    return outcome;
  }
  if (!existing.ok) {
    outcome.refused.push({ sourceId: "-", reason: existing.error ?? "read failed" });
    return outcome;
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  outcome.scanned = rows.length;

  for (const row of rows) {
    const id = String(row.id);
    await applyRecord({
      key: `expense_voucher:${id}`,
      existing: existing.map,
      cancelled: !!row.cancelled_at,
      cancelReason: String(row.cancel_reason ?? "") || "Expense voucher cancelled",
      sourceId: id,
      outcome,
      build: () =>
        buildExpenseVoucher({
          voucher: {
            id,
            voucherNo: String(row.voucher_no ?? ""),
            voucherDate: String(row.voucher_date ?? ""),
            grandTotalPaise: Number(row.grand_total_paise ?? 0),
            paidPaise: Number(row.paid_paise ?? 0),
            duePaise: Number(row.due_paise ?? 0),
            mode: String(row.mode ?? ""),
            bankId: String(row.bank_id ?? ""),
            vendorId: String(row.vendor_id ?? ""),
            narration: String(row.narration ?? ""),
            approvedBy: String(row.approved_by ?? ""),
            cancelledAt: row.cancelled_at ? String(row.cancelled_at) : null,
          },
          expenseAccountCode:
            codes.get(String(row.category_id ?? "")) ?? FALLBACK_EXPENSE_CODE,
        }),
    });
  }

  return outcome;
}

/* ─── Vendor bills ─────────────────────────────────────────── */

export async function projectVendorBills(opts?: {
  limit?: number;
}): Promise<ProjectionOutcome> {
  const outcome = emptyOutcome("vendor_bill");
  const ctx = await getServerTenantContext();
  if (!ctx) {
    outcome.refused.push({ sourceId: "-", reason: "Supabase tenant not configured" });
    return outcome;
  }

  const [{ data, error }, codes, existing] = await Promise.all([
    ctx.sb
      .from("accounts_desk_vendor_bills")
      .select("id, vendor_id, bill_no, bill_date, grand_total_paise, category_id, narration")
      .eq("tenant_id", ctx.tenantId)
      .order("bill_date")
      .limit(opts?.limit ?? 2000),
    expenseCategoryCodes(),
    existingBySource(["vendor_bill"]),
  ]);
  if (error) {
    outcome.refused.push({ sourceId: "-", reason: error.message });
    return outcome;
  }
  if (!existing.ok) {
    outcome.refused.push({ sourceId: "-", reason: existing.error ?? "read failed" });
    return outcome;
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  outcome.scanned = rows.length;

  for (const row of rows) {
    const id = String(row.id);
    await applyRecord({
      key: `vendor_bill:${id}`,
      existing: existing.map,
      cancelled: false,
      cancelReason: "",
      sourceId: id,
      outcome,
      build: () =>
        buildVendorBillVoucher({
          bill: {
            id,
            vendorId: String(row.vendor_id ?? ""),
            billNo: String(row.bill_no ?? ""),
            billDate: String(row.bill_date ?? ""),
            grandTotalPaise: Number(row.grand_total_paise ?? 0),
            narration: String(row.narration ?? ""),
          },
          expenseAccountCode:
            codes.get(String(row.category_id ?? "")) ?? "5060",
        }),
    });
  }

  return outcome;
}

/* ─── Payroll ──────────────────────────────────────────────── */

/**
 * Posted and paid runs only.
 *
 * A draft or submitted run is a proposal, not an expense — putting it in the
 * books would overstate salary for every month somebody experimented with a
 * calculation.
 */
const PAYROLL_ACCRUAL_STATUSES = new Set(["posted", "paid"]);

export async function projectPayrollRuns(opts?: {
  limit?: number;
}): Promise<ProjectionOutcome> {
  const outcome = emptyOutcome("payroll_run");
  const ctx = await getServerTenantContext();
  if (!ctx) {
    outcome.refused.push({ sourceId: "-", reason: "Supabase tenant not configured" });
    return outcome;
  }

  const [{ data, error }, existing] = await Promise.all([
    ctx.sb
      .from("payroll_desk_runs")
      .select("id, month, status, posted_by, posted_at, paid_at")
      .eq("tenant_id", ctx.tenantId)
      .order("month")
      .limit(opts?.limit ?? 500),
    existingBySource(["payroll_run", "payroll_payment"]),
  ]);
  if (error) {
    outcome.refused.push({ sourceId: "-", reason: error.message });
    return outcome;
  }
  if (!existing.ok) {
    outcome.refused.push({ sourceId: "-", reason: existing.error ?? "read failed" });
    return outcome;
  }

  const runs = (data ?? []) as Record<string, unknown>[];
  outcome.scanned = runs.length;
  if (runs.length === 0) return outcome;

  const eligible = runs.filter((r) =>
    PAYROLL_ACCRUAL_STATUSES.has(String(r.status ?? "").toLowerCase()),
  );
  outcome.skipped += runs.length - eligible.length;
  if (eligible.length === 0) return outcome;

  const { data: lineRows } = await ctx.sb
    .from("payroll_desk_run_lines")
    .select("run_id, staff_id, full_name, gross, net_pay, advance_deduct, amount_payable")
    .eq("tenant_id", ctx.tenantId)
    .in("run_id", eligible.map((r) => String(r.id)));

  const linesBy = new Map<string, Record<string, unknown>[]>();
  for (const l of (lineRows ?? []) as Record<string, unknown>[]) {
    const k = String(l.run_id);
    (linesBy.get(k) ?? linesBy.set(k, []).get(k)!).push(l);
  }

  for (const run of eligible) {
    const id = String(run.id);
    const month = String(run.month ?? "");
    const deskLines = (linesBy.get(id) ?? []).map((l) => ({
      staffId: String(l.staff_id ?? ""),
      fullName: String(l.full_name ?? ""),
      grossPaise: Number(l.gross ?? 0),
      netPaise: Number(l.amount_payable ?? l.net_pay ?? 0),
      advanceDeductPaise: Number(l.advance_deduct ?? 0),
    }));
    const accrualDate = monthEndIso(month);

    await applyRecord({
      key: `payroll_run:${id}`,
      existing: existing.map,
      cancelled: false,
      cancelReason: "",
      sourceId: id,
      outcome,
      build: () =>
        accrualDate
          ? buildPayrollAccrualVoucher({
              run: {
                id,
                month,
                status: String(run.status ?? ""),
                postedBy: String(run.posted_by ?? ""),
              },
              lines: deskLines,
              date: accrualDate,
            })
          : { ok: false, reason: `payroll run ${id} has no usable month` },
    });

    // Payment is its own event, on its own date.
    if (String(run.status ?? "").toLowerCase() === "paid" && run.paid_at) {
      const net = deskLines.reduce((n, l) => n + Math.round(l.netPaise || 0), 0);
      const paidDate = String(run.paid_at).slice(0, 10);
      await applyRecord({
        key: `payroll_payment:${id}`,
        existing: existing.map,
        cancelled: false,
        cancelReason: "",
        sourceId: `${id} (payment)`,
        outcome,
        build: () =>
          buildPayrollPaymentVoucher({
            run: {
              id,
              month,
              status: String(run.status ?? ""),
              postedBy: String(run.posted_by ?? ""),
            },
            netPaise: net,
            date: paidDate,
          }),
      });
    }
  }

  return outcome;
}

/* ─── Run everything ───────────────────────────────────────── */

export async function projectAll(opts?: {
  limit?: number;
}): Promise<{ ok: boolean; outcomes: ProjectionOutcome[] }> {
  // Order matters only for readability of the report; each projector is
  // independent and idempotent.
  const outcomes = [
    await projectFeeReceipts(opts),
    await projectExpenseVouchers(opts),
    await projectVendorBills(opts),
    await projectPayrollRuns(opts),
  ];
  return {
    ok: outcomes.every((o) => o.refused.length === 0),
    outcomes,
  };
}

/* ─── Reconciliation ───────────────────────────────────────── */

export type ReconciliationRow = {
  source: string;
  deskRecords: number;
  ledgerVouchers: number;
  missingInLedger: string[];
  orphanedInLedger: string[];
};

/**
 * The phase's exit criterion, as a query.
 *
 * Every desk record that should be in the book is, and every voucher in the
 * book still has the desk record it came from. Both directions matter: the
 * first catches a projection that never ran, the second catches a desk row
 * deleted out from under a posting that is now unexplainable.
 */
export async function ledgerReconciliation(): Promise<{
  ok: boolean;
  rows: ReconciliationRow[];
  error?: string;
}> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, rows: [], error: "Supabase tenant not configured" };

  const specs: {
    source: string;
    table: string;
    cancelledColumn?: string;
  }[] = [
    { source: "fee_receipt", table: "fee_desk_vouchers", cancelledColumn: "voided_at" },
    {
      source: "expense_voucher",
      table: "accounts_desk_expense_vouchers",
      cancelledColumn: "cancelled_at",
    },
    { source: "vendor_bill", table: "accounts_desk_vendor_bills" },
  ];

  const rows: ReconciliationRow[] = [];

  for (const spec of specs) {
    const cols = spec.cancelledColumn ? `id, ${spec.cancelledColumn}` : "id";
    const { data: deskRows, error } = await ctx.sb
      .from(spec.table)
      .select(cols)
      .eq("tenant_id", ctx.tenantId);
    if (error) return { ok: false, rows, error: error.message };

    // The column list is built at runtime, so supabase-js cannot type the
    // result; go through unknown rather than pretend it knows the shape.
    const desk = ((deskRows ?? []) as unknown) as Record<string, unknown>[];
    // A cancelled record that was never posted is correctly absent.
    const expected = desk.filter(
      (r) => !spec.cancelledColumn || !r[spec.cancelledColumn],
    );
    const expectedIds = new Set(expected.map((r) => String(r.id)));
    const allDeskIds = new Set(desk.map((r) => String(r.id)));

    const { data: ledgerRows } = await ctx.sb
      .from("ledger_vouchers")
      .select("source_id")
      .eq("tenant_id", ctx.tenantId)
      .eq("source_type", spec.source);
    const ledgerIds = new Set(
      ((ledgerRows ?? []) as { source_id: string }[]).map((r) => String(r.source_id)),
    );

    rows.push({
      source: spec.source,
      deskRecords: expected.length,
      ledgerVouchers: ledgerIds.size,
      missingInLedger: [...expectedIds].filter((id) => !ledgerIds.has(id)).slice(0, 50),
      orphanedInLedger: [...ledgerIds].filter((id) => !allDeskIds.has(id)).slice(0, 50),
    });
  }

  return {
    ok: rows.every((r) => r.missingInLedger.length === 0 && r.orphanedInLedger.length === 0),
    rows,
  };
}

/* ─── Fees received in advance ─────────────────────────────── */

/**
 * What sits in Fees Received in Advance (2400), per session.
 *
 * The session tag is the cost centre the projection stamped on each advance
 * line. A positive balance is money collected for a session that has not been
 * recognised as income yet.
 */
export async function feeAdvanceBalances(): Promise<
  { ok: boolean; error?: string; rows: { academicYearCode: string; balancePaise: number }[] }
> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured", rows: [] };

  const { data, error } = await ctx.sb
    .from("ledger_lines")
    .select(
      "debit_paise, credit_paise, account:ledger_accounts!inner(code), cc:ledger_cost_centres(code)",
    )
    .eq("tenant_id", ctx.tenantId)
    .eq("account.code", L_FEE_ADVANCES);
  if (error) return { ok: false, error: error.message, rows: [] };

  const by = new Map<string, number>();
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const cc = (r.cc as { code?: string } | null)?.code ?? "";
    const key = cc || "(untagged)";
    by.set(key, (by.get(key) ?? 0) + Number(r.credit_paise ?? 0) - Number(r.debit_paise ?? 0));
  }
  return {
    ok: true,
    rows: [...by.entries()]
      .map(([academicYearCode, balancePaise]) => ({ academicYearCode, balancePaise }))
      .filter((r) => r.balancePaise !== 0)
      .sort((a, b) => a.academicYearCode.localeCompare(b.academicYearCode)),
  };
}

/**
 * Recognise a session's advance fees as income.
 *
 * Posts Dr 2400 / Cr 4000 for the session's CURRENT advance balance, dated
 * on or after the session start. Keyed on (session, date), so pressing the
 * button twice on one day posts once; advances that arrive later (backdated
 * receipts synced after the release) simply leave a new balance for a later
 * release — nothing is lost, and each release states what it moved.
 */
export async function releaseFeeAdvances(input: {
  academicYearCode: string;
  date: string;
  createdBy: string;
}): Promise<{ ok: boolean; error?: string; voucherNo?: string; amountPaise?: number }> {
  const year = input.academicYearCode.trim();
  const start = sessionStartOf(year);
  if (!start) return { ok: false, error: `"${year}" is not a session code (expected e.g. 2026-27)` };
  if (input.date < start) {
    return {
      ok: false,
      error: `The ${year} session starts ${start} — its advances become income on or after that day, not before`,
    };
  }

  const balances = await feeAdvanceBalances();
  if (!balances.ok) return { ok: false, error: balances.error };
  const row = balances.rows.find((r) => r.academicYearCode === year);
  const amount = row?.balancePaise ?? 0;
  if (amount <= 0) {
    return { ok: false, error: `Nothing to release — ${year} holds no advance balance` };
  }

  const res = await ledgerPost({
    voucherType: "journal",
    date: input.date,
    narration: `Fees received in advance for ${year} recognised as income`,
    sourceType: "fee_advance_release",
    sourceId: `${year}@${input.date}`,
    createdBy: input.createdBy,
    lines: [
      {
        accountCode: L_FEE_ADVANCES,
        debitPaise: amount,
        creditPaise: 0,
        costCentreCode: year,
        narration: `Release advances of ${year}`,
      },
      {
        accountCode: L_FEE_INCOME,
        debitPaise: 0,
        creditPaise: amount,
        costCentreCode: year,
        narration: `Session ${year} fees recognised`,
      },
    ],
  });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, voucherNo: res.voucherNo, amountPaise: amount };
}
