/**
 * Fee desk ancillary — cheques, day close, charge vouchers, plans (server-only).
 */

import type {
  CarriedForwardDue,
  ChargeVoucher,
  ChequeInstrument,
  DayCloseSession,
  FeesState,
  ManualBookSeries,
} from "@/lib/fees";
import type { InstallmentPlan, PlanAllocation } from "@/lib/installmentPlans";
import type { FeeDeskAncillary } from "@/lib/feesDeskAncillary.types";
import { feesDualWriteDbEnabled } from "@/lib/feesDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";

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

async function deleteStale(
  sb: Awaited<ReturnType<typeof ctx>> extends infer C
    ? C extends { sb: infer S }
      ? S
      : never
    : never,
  tenantId: string,
  table: string,
  keepIds: Set<string>,
) {
  // An empty keep-set means every stored row is "stale", which would delete
  // the whole table. A client with nothing to say has lost its cache; it is
  // not asking for the school's records to be erased. See the identical guard
  // in the *Normalized.server.ts modules and docs/TODO.md.
  if (keepIds.size === 0) {
    console.warn(
      `[${table}] refusing to prune: the payload holds no ids at all.`,
    );
    return;
  }
  const { data, error } = await sb
    .from(table)
    .select("id")
    .eq("tenant_id", tenantId);
  if (error) {
    console.error(
      `[${table}] prune skipped — could not read existing ids:`,
      error.message,
    );
    return;
  }
  const stale = (data ?? [])
    .map((r) => String((r as { id: string }).id))
    .filter((id) => !keepIds.has(id));
  if (stale.length > 0) {
    await sb.from(table).delete().in("id", stale);
  }
}

export async function pushFeeDeskAncillaryToDb(
  ancillary: FeeDeskAncillary,
): Promise<{ ok: boolean; error?: string }> {
  if (!feesDualWriteDbEnabled()) return { ok: true };
  const c = await ctx();
  if (!c) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = c;
  const now = new Date().toISOString();

  const cheques = ancillary.cheques ?? [];
  await deleteStale(sb, tenantId, "fee_desk_cheques", new Set(cheques.map((x) => x.id)));
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
    const { error } = await sb.from("fee_desk_cheques").upsert(rows, { onConflict: "id" });
    if (error) return { ok: false, error: error.message };
  }

  const books = ancillary.manualBooks ?? [];
  await deleteStale(sb, tenantId, "fee_desk_manual_books", new Set(books.map((x) => x.id)));
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

  const closes = ancillary.dayCloses ?? [];
  await deleteStale(sb, tenantId, "fee_desk_day_closes", new Set(closes.map((x) => x.id)));
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
    const { error } = await sb.from("fee_desk_day_closes").upsert(rows, { onConflict: "id" });
    if (error) return { ok: false, error: error.message };
  }

  const charges = ancillary.chargeVouchers ?? [];
  await deleteStale(
    sb,
    tenantId,
    "fee_desk_charge_vouchers",
    new Set(charges.map((x) => x.id)),
  );
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
    const { error } = await sb
      .from("fee_desk_charge_vouchers")
      .upsert(rows, { onConflict: "id" });
    if (error) return { ok: false, error: error.message };
  }
  if (chargeLineRows.length) {
    const cvIds = charges.map((c) => c.id);
    await sb
      .from("fee_desk_charge_voucher_lines")
      .delete()
      .eq("tenant_id", tenantId)
      .in("charge_voucher_id", cvIds);
    const { error } = await sb
      .from("fee_desk_charge_voucher_lines")
      .upsert(chargeLineRows, { onConflict: "id" });
    if (error) return { ok: false, error: error.message };
  }

  const plans = ancillary.installmentPlans ?? [];
  await deleteStale(
    sb,
    tenantId,
    "fee_desk_installment_plans",
    new Set(plans.map((x) => x.id)),
  );
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
    const { error } = await sb
      .from("fee_desk_installment_plans")
      .upsert(rows, { onConflict: "id" });
    if (error) return { ok: false, error: error.message };
  }

  const allocs = ancillary.planAllocations ?? [];
  await deleteStale(
    sb,
    tenantId,
    "fee_desk_plan_allocations",
    new Set(allocs.map((x) => x.id)),
  );
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
    const { error } = await sb
      .from("fee_desk_plan_allocations")
      .upsert(rows, { onConflict: "id" });
    if (error) return { ok: false, error: error.message };
  }

  const carried = ancillary.carriedForwardDues ?? [];
  await deleteStale(
    sb,
    tenantId,
    "fee_desk_carried_forward",
    new Set(carried.map((x) => x.id)),
  );
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
    const { error } = await sb
      .from("fee_desk_carried_forward")
      .upsert(rows, { onConflict: "id" });
    if (error) return { ok: false, error: error.message };
  }

  await sb.from("fee_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      cheque_count: cheques.length,
      charge_voucher_count: charges.filter((c) => !c.voidedAt).length,
      ancillary_updated_at: now,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true };
}

export async function fetchFeeDeskAncillaryFromDb(): Promise<FeeDeskAncillary> {
  const c = await ctx();
  if (!c) return emptyAncillary();
  const { sb, tenantId } = c;

  const [
    { data: chequeRows },
    { data: bookRows },
    { data: closeRows },
    { data: chargeRows },
    { data: chargeLineRows },
    { data: planRows },
    { data: allocRows },
    { data: carriedRows },
  ] = await Promise.all([
    sb.from("fee_desk_cheques").select("*").eq("tenant_id", tenantId),
    sb.from("fee_desk_manual_books").select("*").eq("tenant_id", tenantId),
    sb.from("fee_desk_day_closes").select("*").eq("tenant_id", tenantId),
    sb.from("fee_desk_charge_vouchers").select("*").eq("tenant_id", tenantId),
    sb.from("fee_desk_charge_voucher_lines").select("*").eq("tenant_id", tenantId),
    sb.from("fee_desk_installment_plans").select("*").eq("tenant_id", tenantId),
    sb.from("fee_desk_plan_allocations").select("*").eq("tenant_id", tenantId),
    sb.from("fee_desk_carried_forward").select("*").eq("tenant_id", tenantId),
  ]);

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

  return {
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
  for (const student of sis.students) {
    if (student.status !== "active") continue;
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

  // Upsert-then-delete-stale, not delete-then-insert: two rebuilds for the
  // same tenant+year can legitimately overlap (e.g. two staff editing fees
  // at once, each triggering a debounced sync). A blanket DELETE up front
  // raced against a concurrent run's UPSERTs into the same rows and
  // produced real Postgres deadlocks (AccessExclusiveLock contention,
  // "deadlock detected") in production. Writing fresh rows first (upsert
  // is row-level and PK-safe under concurrency) and only removing rows
  // stamped strictly before this run's `now` means a concurrent rebuild's
  // writes are never clobbered mid-flight, and only genuinely-stale dues
  // (ones this run recomputed as gone) get removed.
  if (rows.length > 0) {
    const chunk = 500;
    for (let i = 0; i < rows.length; i += chunk) {
      const { error } = await sb
        .from("fee_desk_open_dues")
        .upsert(rows.slice(i, i + chunk));
      if (error) return { ok: false, count: 0, error: error.message };
    }
  }

  await sb
    .from("fee_desk_open_dues")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("academic_year_code", ay)
    .lt("updated_at", now);

  await sb.from("fee_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      open_dues_count: rows.length,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true, count: rows.length };
}

export async function fetchOpenDuesSummary(academicYearCode?: string): Promise<{
  count: number;
  totalBalancePaise: number;
}> {
  const c = await ctx();
  if (!c) return { count: 0, totalBalancePaise: 0 };
  let q = c.sb
    .from("fee_desk_open_dues")
    .select("balance_paise")
    .eq("tenant_id", c.tenantId)
    .gt("balance_paise", 0);
  if (academicYearCode) {
    q = q.eq("academic_year_code", academicYearCode);
  }
  const { data } = await q;
  const rows = data ?? [];
  return {
    count: rows.length,
    totalBalancePaise: rows.reduce(
      (s, r) => s + Number(r.balance_paise || 0),
      0,
    ),
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
