/**
 * Payroll desk — Supabase normalized tables (payroll_desk_*).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PayrollAuditEntry,
  PayrollLineComponent,
  PayrollRun,
  PayrollStaffLine,
  PayrollState,
} from "@/lib/payroll";
import { payrollDualWriteDbEnabled } from "@/lib/payrollDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";

export type PayrollDeskSyncMeta = {
  runCount: number;
  lineCount: number;
  draftCount: number;
  lastRunMonth: string | null;
  updatedAt: string;
};

export type PayrollDeskBundle = Pick<PayrollState, "runs" | "audit">;

const META_SELECT =
  "run_count, line_count, draft_count, last_run_month, updated_at";

async function resolveCtx(): Promise<{
  sb: SupabaseClient;
  tenantId: string;
} | null> {
  return getServerTenantContext();
}

async function deleteStale(
  sb: SupabaseClient,
  tenantId: string,
  table: string,
  keepIds: Set<string>,
) {
  const { data } = await sb.from(table).select("id").eq("tenant_id", tenantId);
  const stale = (data ?? [])
    .map((r) => String((r as { id: string }).id))
    .filter((id) => !keepIds.has(id));
  if (stale.length > 0) {
    await sb.from(table).delete().in("id", stale);
  }
}

async function upsertChunks(
  sb: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  chunk = 200,
): Promise<{ ok: boolean; error?: string }> {
  for (let i = 0; i < rows.length; i += chunk) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + chunk));
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

function nowIso() {
  return new Date().toISOString();
}

function lineId(runId: string, idx: number) {
  return `${runId}_L${idx}`;
}

function runToRow(tenantId: string, r: PayrollRun): Record<string, unknown> {
  return {
    id: r.id,
    tenant_id: tenantId,
    academic_year_code: r.academicYearCode || "",
    month: r.month || "",
    day_count: r.dayCount ?? 30,
    kind: r.kind || "bulk",
    status: r.status || "draft",
    created_by: r.createdBy || "",
    created_at: r.createdAt || nowIso(),
    submitted_by: r.submittedBy || "",
    submitted_at: r.submittedAt || null,
    approved_by: r.approvedBy || "",
    approved_at: r.approvedAt || null,
    posted_by: r.postedBy || "",
    posted_at: r.postedAt || null,
    paid_by: r.paidBy || "",
    paid_at: r.paidAt || null,
    remark: r.remark || "",
    submission_note: r.submissionNote || "",
    rejection_note: r.rejectionNote || "",
    rejected_by: r.rejectedBy || "",
    rejected_at: r.rejectedAt || null,
    lock_version: r.lockVersion ?? 0,
    updated_at: nowIso(),
  };
}

function lineToRow(
  tenantId: string,
  runId: string,
  idx: number,
  line: PayrollStaffLine,
): Record<string, unknown> {
  return {
    id: lineId(runId, idx),
    tenant_id: tenantId,
    run_id: runId,
    line_index: idx,
    staff_id: line.staffId || "",
    emp_code: line.empCode || "",
    full_name: line.fullName || "",
    stream: line.stream || "",
    structure_id: line.structureId || "",
    structure_name: line.structureName || "",
    days_present: line.daysPresent ?? 0,
    days_absent: line.daysAbsent ?? 0,
    days_half: line.daysHalf ?? 0,
    days_leave_paid: line.daysLeavePaid ?? 0,
    days_lwp: line.daysLwp ?? 0,
    days_holiday: line.daysHoliday ?? 0,
    late_penalty: line.latePenalty ?? 0,
    lwp_deduction: line.lwpDeduction ?? 0,
    components: line.components ?? [],
    gross: line.gross ?? 0,
    total_deductions: line.totalDeductions ?? 0,
    employer_cost: line.employerCost ?? 0,
    net_pay: line.netPay ?? 0,
    june_hold: !!line.juneHold,
    eligible_for_june_draw: line.eligibleForJuneDraw !== false,
    amount_payable: line.amountPayable ?? 0,
    hold_note: line.holdNote || "",
    statutory_cover: line.statutoryCover || "",
    pf_govt_deposit: line.pfGovtDeposit ?? 0,
    esic_govt_deposit: line.esicGovtDeposit ?? 0,
    bonus: line.bonus ?? 0,
    special_deduction: line.specialDeduction ?? 0,
    special_deduction_label: line.specialDeductionLabel || "",
    advance_taken: line.advanceTaken ?? 0,
    advance_deduct: line.advanceDeduct ?? 0,
    advance_new_with_salary: line.advanceNewWithSalary ?? 0,
    payment_date: line.paymentDate || null,
    payment_mode: line.paymentMode || "bank_transfer",
    note: line.note || "",
    updated_at: nowIso(),
  };
}

function rowToLine(r: Record<string, unknown>): PayrollStaffLine {
  const components = r.components;
  return {
    staffId: String(r.staff_id || ""),
    empCode: String(r.emp_code || ""),
    fullName: String(r.full_name || ""),
    stream: String(r.stream || ""),
    structureId: String(r.structure_id || ""),
    structureName: String(r.structure_name || ""),
    daysPresent: Number(r.days_present ?? 0),
    daysAbsent: Number(r.days_absent ?? 0),
    daysHalf: Number(r.days_half ?? 0),
    daysLeavePaid: Number(r.days_leave_paid ?? 0),
    daysLwp: Number(r.days_lwp ?? 0),
    daysHoliday: Number(r.days_holiday ?? 0),
    latePenalty: Number(r.late_penalty ?? 0),
    lwpDeduction: Number(r.lwp_deduction ?? 0),
    components: Array.isArray(components)
      ? (components as PayrollLineComponent[])
      : [],
    gross: Number(r.gross ?? 0),
    totalDeductions: Number(r.total_deductions ?? 0),
    employerCost: Number(r.employer_cost ?? 0),
    netPay: Number(r.net_pay ?? 0),
    juneHold: r.june_hold === true,
    eligibleForJuneDraw: r.eligible_for_june_draw !== false,
    amountPayable: Number(r.amount_payable ?? 0),
    holdNote: String(r.hold_note || ""),
    statutoryCover: String(r.statutory_cover || ""),
    pfGovtDeposit: Number(r.pf_govt_deposit ?? 0),
    esicGovtDeposit: Number(r.esic_govt_deposit ?? 0),
    bonus: Number(r.bonus ?? 0),
    specialDeduction: Number(r.special_deduction ?? 0),
    specialDeductionLabel: String(r.special_deduction_label || ""),
    advanceTaken: Number(r.advance_taken ?? 0),
    advanceDeduct: Number(r.advance_deduct ?? 0),
    advanceNewWithSalary: Number(r.advance_new_with_salary ?? 0),
    paymentDate: r.payment_date ? String(r.payment_date).slice(0, 10) : "",
    paymentMode:
      r.payment_mode === "cash" ||
      r.payment_mode === "cheque" ||
      r.payment_mode === "upi" ||
      r.payment_mode === "other"
        ? r.payment_mode
        : "bank_transfer",
    note: String(r.note || ""),
  };
}

function rowToRun(
  r: Record<string, unknown>,
  lines: PayrollStaffLine[],
): PayrollRun {
  return {
    id: String(r.id),
    academicYearCode: String(r.academic_year_code || ""),
    month: String(r.month || ""),
    dayCount: Number(r.day_count ?? 30),
    kind: r.kind === "individual" ? "individual" : "bulk",
    status: String(r.status || "draft") as PayrollRun["status"],
    lines,
    createdBy: String(r.created_by || ""),
    createdAt: String(r.created_at || nowIso()),
    submittedBy: String(r.submitted_by || ""),
    submittedAt: r.submitted_at ? String(r.submitted_at) : "",
    approvedBy: String(r.approved_by || ""),
    approvedAt: r.approved_at ? String(r.approved_at) : "",
    postedBy: String(r.posted_by || ""),
    postedAt: r.posted_at ? String(r.posted_at) : "",
    paidBy: String(r.paid_by || ""),
    paidAt: r.paid_at ? String(r.paid_at) : "",
    remark: String(r.remark || ""),
    submissionNote: String(r.submission_note || ""),
    rejectionNote: String(r.rejection_note || ""),
    rejectedBy: String(r.rejected_by || ""),
    rejectedAt: r.rejected_at ? String(r.rejected_at) : "",
    lockVersion: Number(r.lock_version ?? 0),
  };
}

function auditToRow(
  tenantId: string,
  a: PayrollAuditEntry,
): Record<string, unknown> {
  return {
    id: a.id,
    tenant_id: tenantId,
    at: a.at || nowIso(),
    by_user: a.by || "",
    action: a.action || "",
    run_id: a.runId || "",
    month: a.month || "",
    academic_year_code: a.academicYearCode || "",
    detail: a.detail || "",
    updated_at: nowIso(),
  };
}

function rowToAudit(r: Record<string, unknown>): PayrollAuditEntry {
  return {
    id: String(r.id),
    at: String(r.at || nowIso()),
    by: String(r.by_user || ""),
    action: String(r.action || "") as PayrollAuditEntry["action"],
    runId: String(r.run_id || ""),
    month: String(r.month || ""),
    academicYearCode: String(r.academic_year_code || ""),
    detail: String(r.detail || ""),
  };
}

export async function pushPayrollDeskToDb(
  state: PayrollState,
): Promise<{ ok: boolean; error?: string }> {
  if (!payrollDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = nowIso();

  const runs = state.runs ?? [];
  const audit = state.audit ?? [];

  const lineKeep = new Set<string>();
  const lineRows: Record<string, unknown>[] = [];
  for (const run of runs) {
    (run.lines ?? []).forEach((line, idx) => {
      const lid = lineId(run.id, idx);
      lineKeep.add(lid);
      lineRows.push(lineToRow(tenantId, run.id, idx, line));
    });
  }

  await Promise.all([
    deleteStale(sb, tenantId, "payroll_desk_runs", new Set(runs.map((r) => r.id))),
    deleteStale(sb, tenantId, "payroll_desk_run_lines", lineKeep),
    deleteStale(sb, tenantId, "payroll_desk_audit", new Set(audit.map((a) => a.id))),
  ]);

  const tables: [string, Record<string, unknown>[]][] = [
    ["payroll_desk_runs", runs.map((r) => runToRow(tenantId, r))],
    ["payroll_desk_run_lines", lineRows],
    ["payroll_desk_audit", audit.map((a) => auditToRow(tenantId, a))],
  ];

  for (const [table, rows] of tables) {
    const r = await upsertChunks(sb, table, rows);
    if (!r.ok) return r;
  }

  const draftCount = runs.filter((r) => r.status === "draft").length;
  const lineCount = runs.reduce((n, r) => n + (r.lines?.length ?? 0), 0);
  let lastRunMonth: string | null = null;
  for (const r of runs) {
    if (r.month && (!lastRunMonth || r.month > lastRunMonth)) {
      lastRunMonth = r.month;
    }
  }

  await sb.from("payroll_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      run_count: runs.length,
      line_count: lineCount,
      draft_count: draftCount,
      last_run_month: lastRunMonth,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true };
}

export async function fetchPayrollDeskFromDb(): Promise<{
  bundle: PayrollDeskBundle;
  meta: PayrollDeskSyncMeta | null;
}> {
  const ctx = await resolveCtx();
  const empty: PayrollDeskBundle = { runs: [], audit: [] };
  if (!ctx) return { bundle: empty, meta: null };
  const { sb, tenantId } = ctx;

  const [
    { data: runRows },
    { data: lineRows },
    { data: auditRows },
    { data: metaRow },
  ] = await Promise.all([
    sb.from("payroll_desk_runs").select("*").eq("tenant_id", tenantId),
    sb.from("payroll_desk_run_lines").select("*").eq("tenant_id", tenantId),
    sb.from("payroll_desk_audit").select("*").eq("tenant_id", tenantId),
    sb
      .from("payroll_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  const linesByRun = new Map<string, PayrollStaffLine[]>();
  for (const row of lineRows ?? []) {
    const r = row as Record<string, unknown>;
    const runId = String(r.run_id);
    const list = linesByRun.get(runId) ?? [];
    list.push(rowToLine(r));
    linesByRun.set(runId, list);
  }

  const runs = (runRows ?? []).map((r) => {
    const rec = r as Record<string, unknown>;
    const id = String(rec.id);
    const lines = (linesByRun.get(id) ?? []).slice();
    return rowToRun(rec, lines);
  });

  return {
    bundle: {
      runs,
      audit: (auditRows ?? []).map((r) => rowToAudit(r as Record<string, unknown>)),
    },
    meta: metaRow
      ? {
          runCount: (metaRow as { run_count: number }).run_count,
          lineCount: (metaRow as { line_count: number }).line_count,
          draftCount: (metaRow as { draft_count: number }).draft_count,
          lastRunMonth: (metaRow as { last_run_month: string | null }).last_run_month,
          updatedAt: String((metaRow as { updated_at: string }).updated_at),
        }
      : null,
  };
}
