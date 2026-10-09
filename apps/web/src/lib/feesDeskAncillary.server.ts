/**
 * Fee desk ancillary — cheques, day close, charge vouchers, plans (server-only).
 */

import type {
  CarriedForwardDue,
  ChargeVoucher,
  ChequeInstrument,
  DayCloseSession,
  ManualBookSeries,
} from "@/lib/fees";
import type { InstallmentPlan, PlanAllocation } from "@/lib/installmentPlans";
import type { FeeDeskAncillary } from "@/lib/feesDeskAncillary.types";
import { feesDualWriteDbEnabled } from "@/lib/feesDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchAllPages, fetchByIds } from "@/lib/supabase/pageAll";
import type { SupabaseClient } from "@supabase/supabase-js";
import { replaceChildRows } from "./replaceChildRows.server";
import { deleteNamedIds, type NamedDeletes } from "@/lib/deskNamedDeletes.server";

export type { FeeDeskAncillary };

function emptyAncillary(): FeeDeskAncillary {
  return {
    cheques: [],
    manualBooks: [],
    dayCloses: [],
    installmentPlans: [],
    planAllocations: [],
    carriedForwardDues: [],
    chargeVouchers: [],
  };
}

async function ctx() {
  return getServerTenantContext();
}

/** The only fee-ancillary table a desk save deletes from — by named id. */
export const FEE_ANCILLARY_DELETABLE_TABLES = ["fee_desk_day_closes"] as const;

type Row = Record<string, unknown>;
const at = (v: unknown) => {
  const t = Date.parse(String(v ?? ""));
  return Number.isFinite(t) ? t : -Infinity;
};
const CHEQUE_RANK: Record<string, number> = { received: 0, deposited: 1, cleared: 2, bounced: 2 };
const closeActionAt = (r: Row) => Math.max(at(r.created_at), at(r.submitted_at), at(r.resolved_at));

/**
 * Whether the stored row is further along than this copy of it — a copy
 * that must not be written (2026-10-10). Every save upserted every row it
 * held, and the payload is often the server's cached desk (gateway
 * settlement, the staff app's collect, refunds): a cheque cleared at the
 * counter went back to "received", a voided charge came back, a cancelled
 * plan became active again, a submitted day close went back to draft.
 */
export const FEE_STALE_RULES: Record<string, { cols: string; stale: (stored: Row, mine: Row) => boolean }> = {
  // received → deposited → cleared | bounced; never backwards, and the two
  // ends are final.
  fee_desk_cheques: {
    cols: "id, status",
    stale: (s, m) => {
      const a = CHEQUE_RANK[String(s.status)] ?? 0;
      const b = CHEQUE_RANK[String(m.status)] ?? 0;
      return a > b || (a === 2 && s.status !== m.status);
    },
  },
  // draft → submitted → approved | rejected → (resubmitted). The latest
  // action wins; approved is final.
  fee_desk_day_closes: {
    cols: "id, status, created_at, submitted_at, resolved_at",
    stale: (s, m) => (s.status === "approved" && m.status !== "approved") || closeActionAt(s) > closeActionAt(m),
  },
  // Voided stays voided.
  fee_desk_charge_vouchers: { cols: "id, voided_at", stale: (s, m) => !!s.voided_at && !m.voided_at },
  fee_desk_carried_forward: { cols: "id, voided_at", stale: (s, m) => !!s.voided_at && !m.voided_at },
  // Completed ↔ active is real (voiding a receipt reopens a plan);
  // cancelled is final.
  fee_desk_installment_plans: { cols: "id, status", stale: (s, m) => s.status === "cancelled" && m.status !== "cancelled" },
};

/** `rows` without those whose stored copy is further along. A failed read writes nothing. */
export async function withoutStale(
  sb: SupabaseClient,
  tenantId: string,
  table: string,
  rows: Row[],
): Promise<{ ok: true; rows: Row[]; kept: string[] } | { ok: false; error: string }> {
  const rule = FEE_STALE_RULES[table];
  if (!rule || !rows.length) return { ok: true, rows, kept: [] };
  const stored = await fetchByIds<Row>(rows.map((r) => String(r.id)), (chunk, from, to) =>
    sb.from(table).select(rule.cols).eq("tenant_id", tenantId).in("id", chunk).order("id", { ascending: true }).range(from, to) as unknown as PromiseLike<{
      data: Row[] | null;
      error: { message: string } | null;
    }>,
  );
  if (stored.error) return { ok: false, error: `${table}: could not read the stored rows (${stored.error}) — nothing was written` };
  const byId = new Map(stored.rows.map((r) => [String(r.id), r]));
  const kept: string[] = [];
  const out = rows.filter((r) => {
    const cur = byId.get(String(r.id));
    if (cur && rule.stale(cur, r)) {
      kept.push(String(r.id));
      return false;
    }
    return true;
  });
  if (kept.length) console.warn(`[fees-db] ${table}: kept ${kept.length} stored row(s) further along than this copy`);
  return { ok: true, rows: out, kept };
}

/**
 * No prune by absence. Each of these tables used to lose every row the
 * payload lacked — and the payload is often the SERVER's cached copy (gateway
 * settlement, the staff app's collect, refunds), which watches only vouchers
 * for change. Cheques, plans, charge vouchers and carried-forward dues are
 * only ever voided or have their status changed, so nothing is deleted for
 * them. A day close replaced by a newer session for the same date and
 * counter is named. A voided receipt's plan allocations are removed because
 * the payload says the receipt is voided — scoped to those receipt ids.
 */
export async function pushFeeDeskAncillaryToDb(
  ancillary: FeeDeskAncillary,
  opts: { deletes?: NamedDeletes; voidedVoucherIds?: readonly string[] } = {},
): Promise<{ ok: boolean; error?: string }> {
  if (!feesDualWriteDbEnabled()) return { ok: true };
  const c = await ctx();
  if (!c) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = c;
  const now = new Date().toISOString();

  const cheques = ancillary.cheques ?? [];
  if (cheques.length) {
    const rows = cheques.map((ch: ChequeInstrument) => ({
      id: ch.id,
      tenant_id: tenantId,
      voucher_id: ch.voucherId,
      receipt_no: ch.receiptNo,
      household_id: ch.householdId || null,
      tender_index: ch.tenderIndex,
      cheque_no: ch.chequeNo,
      bank_name: ch.bankName,
      cheque_date: ch.chequeDate || null,
      amount_paise: ch.amountPaise,
      favouring: ch.favouring,
      status: ch.status,
      received_at: ch.receivedAt,
      deposited_at: ch.depositedAt,
      deposit_slip_no: ch.depositSlipNo || "",
      cleared_at: ch.clearedAt,
      bounced_at: ch.bouncedAt,
      bounce_reason: ch.bounceReason || "",
      cheque_json: {},
      updated_at: now,
    }));
    const fresh = await withoutStale(sb, tenantId, "fee_desk_cheques", rows);
    if (!fresh.ok) return fresh;
    const { error } = await sb.from("fee_desk_cheques").upsert(fresh.rows, { onConflict: "id" });
    if (error) return { ok: false, error: error.message };
  }

  const books = ancillary.manualBooks ?? [];
  if (books.length) {
    const rows = books.map((b: ManualBookSeries) => ({
      id: b.id,
      tenant_id: tenantId,
      series_code: b.seriesCode,
      label: b.label,
      is_active: b.isActive,
      updated_at: now,
    }));
    const { error } = await sb.from("fee_desk_manual_books").upsert(rows, { onConflict: "id" });
    if (error) return { ok: false, error: error.message };
  }

  const goneCloses = new Set(opts.deletes?.["fee_desk_day_closes"] ?? []);
  const closes = (ancillary.dayCloses ?? []).filter((d) => !goneCloses.has(d.id));
  if (closes.length) {
    const rows = closes.map((d: DayCloseSession) => ({
      id: d.id,
      tenant_id: tenantId,
      close_date: d.closeDate,
      counter_id: d.counterId || "front_office",
      cashier_name: d.cashierName,
      status: d.status,
      receipt_count: d.receiptCount,
      total_paise: d.totalPaise,
      system_cash_paise: d.systemCashPaise,
      physical_cash_paise: d.physicalCashPaise,
      variance_paise: d.variancePaise,
      cashier_remarks: d.cashierRemarks || "",
      receiver_name: d.receiverName || "",
      receiver_remarks: d.receiverRemarks || "",
      created_at: d.createdAt || now,
      submitted_at: d.submittedAt,
      resolved_at: d.resolvedAt,
      session_json: {
        voucherIds: d.voucherIds,
        modeTotals: d.modeTotals,
        denominations: d.denominations,
      },
      updated_at: now,
    }));
    const fresh = await withoutStale(sb, tenantId, "fee_desk_day_closes", rows);
    if (!fresh.ok) return fresh;
    const { error } = await sb.from("fee_desk_day_closes").upsert(fresh.rows, { onConflict: "id" });
    if (error) return { ok: false, error: error.message };
  }

  const delCloses = await deleteNamedIds(sb, tenantId, "fee_desk_day_closes", [...goneCloses]);
  if (!delCloses.ok) return delCloses;

  const charges = ancillary.chargeVouchers ?? [];
  const chargeLineRows: Record<string, unknown>[] = [];
  for (const cv of charges) {
    for (const line of cv.lines ?? []) {
      chargeLineRows.push({
        id: line.id || `${cv.id}:${line.feeHeadId}`,
        charge_voucher_id: cv.id,
        tenant_id: tenantId,
        fee_head_id: line.feeHeadId,
        fee_head_name: line.feeHeadName,
        amount_paise: line.amountPaise,
        note: line.note || "",
      });
    }
  }
  const skippedCharges = new Set<string>();
  if (charges.length) {
    const rows = charges.map((cv: ChargeVoucher) => ({
      id: cv.id,
      tenant_id: tenantId,
      code: cv.code,
      student_id: cv.studentId,
      household_id: cv.householdId || null,
      student_name: cv.studentName,
      academic_year_code: cv.academicYearCode,
      installment_id: cv.installmentId,
      installment_label: cv.installmentLabel || "",
      due_on: cv.dueOn,
      total_paise: cv.totalPaise,
      reason: cv.reason || "",
      created_at: cv.createdAt,
      created_by: cv.createdBy || "",
      voided_at: cv.voidedAt,
      voided_by: cv.voidedBy || "",
      updated_at: now,
    }));
    const fresh = await withoutStale(sb, tenantId, "fee_desk_charge_vouchers", rows);
    if (!fresh.ok) return fresh;
    for (const id of fresh.kept) skippedCharges.add(id);
    const { error } = await sb
      .from("fee_desk_charge_vouchers")
      .upsert(fresh.rows, { onConflict: "id" });
    if (error) return { ok: false, error: error.message };
  }
  // A charge whose stored copy is further along keeps its stored lines too.
  const lineRows = chargeLineRows.filter((l) => !skippedCharges.has(String(l.charge_voucher_id)));
  if (lineRows.length) {
    // One transaction. A charge voucher stripped of its lines is a charge
    // with an amount and nothing saying what was charged for.
    const write = await replaceChildRows(sb, {
      table: "fee_desk_charge_voucher_lines",
      tenantId,
      // Only charges that arrived WITH lines. Matching every charge in the
      // payload wiped the stored lines of any charge sent without its lines
      // (a compacted or stale copy) — the receipt-lines wipe, again.
      match: {
        charge_voucher_id: charges
          .filter((c) => (c.lines ?? []).length > 0 && !skippedCharges.has(c.id))
          .map((c) => c.id),
      },
      rows: lineRows,
    });
    if (!write.ok) return { ok: false, error: write.error };
  }

  const plans = ancillary.installmentPlans ?? [];
  if (plans.length) {
    const rows = plans.map((p: InstallmentPlan) => ({
      id: p.id,
      tenant_id: tenantId,
      student_id: p.studentId,
      household_id: p.householdId || null,
      academic_year_code: p.academicYearCode,
      status: p.status,
      plan_json: p,
      updated_at: now,
    }));
    const fresh = await withoutStale(sb, tenantId, "fee_desk_installment_plans", rows);
    if (!fresh.ok) return fresh;
    const { error } = await sb
      .from("fee_desk_installment_plans")
      .upsert(fresh.rows, { onConflict: "id" });
    if (error) return { ok: false, error: error.message };
  }

  // A voided receipt no longer pays anything towards a plan. The UI drops
  // its allocations; the payload says which receipts are voided, so their
  // allocations are removed — and only theirs. Written first, removed
  // second: the two sets never overlap (allocations of voided receipts are
  // not written), and a failed write then happens before anything is gone.
  const voided = new Set(opts.voidedVoucherIds ?? []);
  const allocs = (ancillary.planAllocations ?? []).filter((a) => !voided.has(a.voucherId));
  if (allocs.length) {
    const rows = allocs.map((a: PlanAllocation) => ({
      id: a.id,
      tenant_id: tenantId,
      plan_id: a.planId,
      voucher_id: a.voucherId,
      due_key: a.dueKey,
      amount_paise: a.amountPaise,
      created_at: a.createdAt,
    }));
    // Made with the receipt and never changed — only ever added.
    const { error } = await sb
      .from("fee_desk_plan_allocations")
      .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
    if (error) return { ok: false, error: error.message };
  }
  if (voided.size) {
    const ids = [...voided];
    for (let i = 0; i < ids.length; i += 100) {
      const { error } = await sb
        .from("fee_desk_plan_allocations")
        .delete()
        .eq("tenant_id", tenantId)
        .in("voucher_id", ids.slice(i, i + 100));
      if (error) return { ok: false, error: `fee_desk_plan_allocations: ${error.message}` };
    }
  }

  const carried = ancillary.carriedForwardDues ?? [];
  if (carried.length) {
    const rows = carried.map((c: CarriedForwardDue) => ({
      id: c.id,
      tenant_id: tenantId,
      student_id: c.studentId,
      from_academic_year_code: c.fromAcademicYearCode,
      to_academic_year_code: c.toAcademicYearCode,
      amount_paise: c.amountPaise,
      due_on: c.dueOn,
      label: c.label,
      transferred_at: c.transferredAt,
      transferred_by: c.transferredBy || "",
      voided_at: c.voidedAt,
      forward_json: {
        sourceDueKeys: c.sourceDueKeys,
        sourceBreakdown: c.sourceBreakdown,
      },
      updated_at: now,
    }));
    const fresh = await withoutStale(sb, tenantId, "fee_desk_carried_forward", rows);
    if (!fresh.ok) return fresh;
    const { error } = await sb
      .from("fee_desk_carried_forward")
      .upsert(fresh.rows, { onConflict: "id" });
    if (error) return { ok: false, error: error.message };
  }

  // Counts from the tables, not from this copy (it may be partly written).
  const [chq, chg] = await Promise.all([
    sb.from("fee_desk_cheques").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    sb
      .from("fee_desk_charge_vouchers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .is("voided_at", null),
  ]);
  const meta: Record<string, unknown> = { tenant_id: tenantId, ancillary_updated_at: now, updated_at: now };
  // A failed count leaves the old figure alone rather than writing a zero.
  if (!chq.error && typeof chq.count === "number") meta.cheque_count = chq.count;
  if (!chg.error && typeof chg.count === "number") meta.charge_voucher_count = chg.count;
  await sb.from("fee_desk_sync_meta").upsert(meta, { onConflict: "tenant_id" });

  return { ok: true };
}

export async function fetchFeeDeskAncillaryFromDb(): Promise<{
  ancillary: FeeDeskAncillary;
  /** false = a read failed; the lists are unknown, NOT empty. */
  ok: boolean;
  error?: string;
}> {
  const c = await ctx();
  if (!c) return { ancillary: emptyAncillary(), ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = c;

  // Paged: PostgREST stops at 1,000 rows and calls it success. Cheques, plan
  // allocations and day closes grow with every receipt, and a list cut at a
  // thousand reached the browser short. Errors are kept: the server's own
  // fee pushes (settlement, the staff app's collect) start from this read.
  const page = (table: string) =>
    fetchAllPages<Record<string, unknown>>((from, to) =>
      sb.from(table).select("*").eq("tenant_id", tenantId).order("id").range(from, to),
    );
  const results = await Promise.all([
    page("fee_desk_cheques"),
    page("fee_desk_manual_books"),
    page("fee_desk_day_closes"),
    page("fee_desk_charge_vouchers"),
    page("fee_desk_charge_voucher_lines"),
    page("fee_desk_installment_plans"),
    page("fee_desk_plan_allocations"),
    page("fee_desk_carried_forward"),
  ]);
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    console.error("[fees-db] ancillary fetch failed", failed.error);
    return { ancillary: emptyAncillary(), ok: false, error: failed.error };
  }
  const [
    chequeRows,
    bookRows,
    closeRows,
    chargeRows,
    chargeLineRows,
    planRows,
    allocRows,
    carriedRows,
  ] = results.map((r) => r.rows);

  const linesByCharge = new Map<string, ChargeVoucher["lines"]>();
  for (const row of chargeLineRows ?? []) {
    const cid = String(row.charge_voucher_id);
    const list = linesByCharge.get(cid) ?? [];
    list.push({
      id: String(row.id),
      feeHeadId: String(row.fee_head_id),
      feeHeadName: String(row.fee_head_name),
      amountPaise: Number(row.amount_paise),
      note: String(row.note || ""),
    });
    linesByCharge.set(cid, list);
  }

  const ancillary: FeeDeskAncillary = {
    cheques: (chequeRows ?? []).map(
      (r): ChequeInstrument => ({
        id: String(r.id),
        voucherId: String(r.voucher_id),
        receiptNo: String(r.receipt_no),
        householdId: String(r.household_id || ""),
        tenderIndex: Number(r.tender_index) || 0,
        chequeNo: String(r.cheque_no),
        bankName: String(r.bank_name),
        chequeDate: String(r.cheque_date || "").slice(0, 10),
        amountPaise: Number(r.amount_paise),
        favouring: String(r.favouring),
        status: r.status as ChequeInstrument["status"],
        receivedAt: String(r.received_at),
        depositedAt: (r.deposited_at as string) ?? null,
        depositSlipNo: String(r.deposit_slip_no || ""),
        clearedAt: (r.cleared_at as string) ?? null,
        bouncedAt: (r.bounced_at as string) ?? null,
        bounceReason: String(r.bounce_reason || ""),
      }),
    ),
    manualBooks: (bookRows ?? []).map(
      (r): ManualBookSeries => ({
        id: String(r.id),
        seriesCode: String(r.series_code),
        label: String(r.label),
        isActive: !!r.is_active,
      }),
    ),
    dayCloses: (closeRows ?? []).map((r): DayCloseSession => {
      const sj = (r.session_json as Record<string, unknown>) || {};
      return {
        id: String(r.id),
        closeDate: String(r.close_date).slice(0, 10),
        counterId: String(r.counter_id),
        cashierName: String(r.cashier_name),
        status: r.status as DayCloseSession["status"],
        voucherIds: (sj.voucherIds as string[]) ?? [],
        receiptCount: Number(r.receipt_count),
        totalPaise: Number(r.total_paise),
        modeTotals: (sj.modeTotals as DayCloseSession["modeTotals"]) ?? [],
        systemCashPaise: Number(r.system_cash_paise),
        denominations: (sj.denominations as DayCloseSession["denominations"]) ?? [],
        physicalCashPaise: Number(r.physical_cash_paise),
        variancePaise: Number(r.variance_paise),
        cashierRemarks: String(r.cashier_remarks || ""),
        receiverName: String(r.receiver_name || ""),
        receiverRemarks: String(r.receiver_remarks || ""),
        createdAt: String(r.created_at),
        submittedAt: (r.submitted_at as string) ?? null,
        resolvedAt: (r.resolved_at as string) ?? null,
      };
    }),
    chargeVouchers: (chargeRows ?? []).map((r): ChargeVoucher => ({
      id: String(r.id),
      code: String(r.code),
      studentId: String(r.student_id),
      householdId: String(r.household_id || ""),
      studentName: String(r.student_name),
      academicYearCode: String(r.academic_year_code),
      installmentId: (r.installment_id as string) ?? null,
      installmentLabel: String(r.installment_label || ""),
      dueOn: String(r.due_on).slice(0, 10),
      lines: linesByCharge.get(String(r.id)) ?? [],
      totalPaise: Number(r.total_paise),
      reason: String(r.reason || ""),
      createdAt: String(r.created_at),
      createdBy: String(r.created_by || ""),
      voidedAt: (r.voided_at as string) ?? null,
      voidedBy: String(r.voided_by || ""),
    })),
    installmentPlans: (planRows ?? []).map(
      (r) => r.plan_json as InstallmentPlan,
    ),
    planAllocations: (allocRows ?? []).map(
      (r): PlanAllocation => ({
        id: String(r.id),
        planId: String(r.plan_id),
        voucherId: String(r.voucher_id),
        dueKey: String(r.due_key),
        amountPaise: Number(r.amount_paise),
        createdAt: String(r.created_at),
      }),
    ),
    carriedForwardDues: (carriedRows ?? []).map((r): CarriedForwardDue => {
      const fj = (r.forward_json as Record<string, unknown>) || {};
      return {
        id: String(r.id),
        studentId: String(r.student_id),
        fromAcademicYearCode: String(r.from_academic_year_code),
        toAcademicYearCode: String(r.to_academic_year_code),
        amountPaise: Number(r.amount_paise),
        dueOn: String(r.due_on).slice(0, 10),
        label: String(r.label),
        sourceDueKeys: (fj.sourceDueKeys as string[]) ?? [],
        sourceBreakdown:
          (fj.sourceBreakdown as CarriedForwardDue["sourceBreakdown"]) ?? [],
        transferredAt: String(r.transferred_at),
        transferredBy: String(r.transferred_by || ""),
        voidedAt: (r.voided_at as string) ?? null,
      };
    }),
  };
  return { ancillary, ok: true };
}

export async function rebuildFeeOpenDuesCache(
  academicYearCode: string,
): Promise<{ ok: boolean; count: number; error?: string }> {
  if (!feesDualWriteDbEnabled()) return { ok: true, count: 0 };
  const c = await ctx();
  if (!c) return { ok: false, count: 0, error: "No tenant" };

  const { ensureSchoolMirrorHydrated } = await import(
    "@/lib/schoolDataMirror.server"
  );
  await ensureSchoolMirrorHydrated();
  // Forced, not TTL-gated: this table is what the reminders and the pay
  // links quote, so it is rebuilt from the transport desk and the posted
  // adjustments as they stand right now, never from a 60-second-old copy.
  const { ensureFeeDuesInputsHydrated } = await import(
    "@/lib/feeDuesInputs.server"
  );
  await ensureFeeDuesInputsHydrated({ force: true });

  const { loadMasters, currentAcademicYearCode } = await import("@/lib/masters");
  const { loadSis } = await import("@/lib/sis");
  const { computeStudentDues, loadFees, openFeeDues } = await import("@/lib/fees");

  const masters = loadMasters();
  const sis = loadSis();
  const fees = loadFees();
  const ay = academicYearCode || currentAcademicYearCode(masters);
  const { sb, tenantId } = c;
  const now = new Date().toISOString();

  const rows: Record<string, unknown>[] = [];
  // The Play review family's fictional dues do not belong in the school's
  // cached figure — they were ₹25,400 of it on 2026-09-12.
  const { isReviewDemoStudent, reviewDemoHouseholdIds } = await import("@/lib/reviewDemoRecords");
  const demoHouseholds = reviewDemoHouseholdIds(sis);
  for (const student of sis.students) {
    if (student.status !== "active") continue;
    if (isReviewDemoStudent(student) || (student.householdId && demoHouseholds.has(student.householdId))) continue;
    if (student.academicYearCode && student.academicYearCode !== ay) continue;
    const dues = computeStudentDues(student, masters, fees, {
      includeFuture: false,
    });
    for (const d of openFeeDues(dues)) {
      if (d.balancePaise <= 0) continue;
      rows.push({
        tenant_id: tenantId,
        student_id: student.id,
        academic_year_code: ay,
        due_key: d.dueKey,
        household_id: student.householdId || null,
        kind: d.kind,
        label: d.label,
        due_on: d.dueOn || null,
        billed_paise: d.billedPaise,
        concession_paise: d.concessionPaise,
        balance_paise: d.balancePaise,
        updated_at: now,
      });
    }
  }

  // One transaction on the server (fee_desk_replace_open_dues, migration
  // 20260818060000): rows absent from the payload are deleted, present rows
  // upserted only where they differ, sync meta updated — all or nothing.
  // The previous delete-all-then-upsert here ignored the delete's error,
  // deadlocked when two browsers pushed together, and left readers a window
  // where every due read as zero (audit 2026-08-18).
  const { data, error } = await sb.rpc("fee_desk_replace_open_dues", {
    p_tenant_id: tenantId,
    p_academic_year_code: ay,
    p_rows: rows.map((r) => {
      const { tenant_id, academic_year_code, updated_at, ...rest } = r;
      void tenant_id; void academic_year_code; void updated_at;
      return rest;
    }),
  });
  if (error) {
    console.warn("[fees] open-dues rebuild failed", error.message);
    return { ok: false, count: 0, error: error.message };
  }
  const result = (data ?? {}) as { count?: number };
  return { ok: true, count: Number(result.count ?? rows.length) };
}

export type OpenDuesSummary = {
  rows: number;
  students: number;
  families: number;
  totalBalancePaise: number;
  /** When the dues cache was last rebuilt; "" = never / unknown. */
  rebuiltAt: string;
};

/**
 * What the school is owed, as the REMINDERS see it.
 *
 * Summed by `fee_open_dues_summary` (migration 20260916130000), not here.
 * This used to select every row and add them up in Node — and PostgREST
 * caps a reply at 1,000 rows while the table holds 1,140, so the total was
 * quietly short by whatever the last 140 carried.
 *
 * This is the figure the WhatsApp reminders and the /pay/due links work
 * from, which is why both dashboards now show it rather than each computing
 * its own: the office was reading two different totals on two screens, and
 * neither was the one the parent was being asked to pay.
 */
export async function fetchOpenDuesSummary(
  academicYearCode?: string,
): Promise<OpenDuesSummary> {
  const empty: OpenDuesSummary = {
    rows: 0,
    students: 0,
    families: 0,
    totalBalancePaise: 0,
    rebuiltAt: "",
  };
  const c = await ctx();
  if (!c) return empty;
  const { data, error } = await c.sb.rpc("fee_open_dues_summary", {
    p_tenant_id: c.tenantId,
    p_academic_year_code: academicYearCode ?? null,
  });
  if (error) {
    console.warn("[fees] open-dues summary failed", error.message);
    return empty;
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!row) return empty;
  return {
    rows: Number(row.rows_count ?? 0),
    students: Number(row.student_count ?? 0),
    families: Number(row.family_count ?? 0),
    totalBalancePaise: Number(row.total_balance_paise ?? 0),
    rebuiltAt: row.rebuilt_at ? String(row.rebuilt_at) : "",
  };
}

export type CachedOpenDue = {
  dueKey: string;
  kind: string;
  label: string;
  dueOn: string | null;
  balancePaise: number;
  billedPaise: number;
  concessionPaise: number;
};

export async function fetchStudentOpenDuesFromCache(
  studentId: string,
  academicYearCode?: string,
): Promise<CachedOpenDue[]> {
  const c = await ctx();
  if (!c) return [];
  let q = c.sb
    .from("fee_desk_open_dues")
    .select(
      "due_key, kind, label, due_on, balance_paise, billed_paise, concession_paise",
    )
    .eq("tenant_id", c.tenantId)
    .eq("student_id", studentId)
    .gt("balance_paise", 0);
  if (academicYearCode) {
    q = q.eq("academic_year_code", academicYearCode);
  }
  const { data } = await q;
  return (data ?? []).map((r) => ({
    dueKey: String(r.due_key),
    kind: String(r.kind || "academic"),
    label: String(r.label || ""),
    dueOn: r.due_on ? String(r.due_on).slice(0, 10) : null,
    balancePaise: Number(r.balance_paise || 0),
    billedPaise: Number(r.billed_paise || 0),
    concessionPaise: Number(r.concession_paise || 0),
  }));
}
