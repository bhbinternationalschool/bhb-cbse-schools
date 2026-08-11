/**
 * Student leave desk — Supabase normalized tables (student_leave_desk_*).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  StudentLeaveRequest,
  StudentLeaveState,
  StudentLeaveStatus,
  StudentLeaveType,
} from "@/lib/studentLeave";
import { studentLeaveDualWriteDbEnabled } from "@/lib/studentLeaveDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";

export type StudentLeaveDeskSyncMeta = {
  requestCount: number;
  pendingCount: number;
  approvedCount: number;
  lastRequestAt: string | null;
  updatedAt: string;
};

export type StudentLeaveDeskBundle = {
  requests: StudentLeaveRequest[];
};

const META_SELECT =
  "request_count, pending_count, approved_count, last_request_at, updated_at";

async function resolveCtx(): Promise<{
  sb: SupabaseClient;
  tenantId: string;
} | null> {
  return getServerTenantContext();
}

/**
 * Delete rows the client no longer holds — never on an empty payload.
 *
 * An empty keep-set means every stored row is "stale", so this deleted the
 * entire table. That is never what a sync means: a client with nothing to say
 * is a client whose cache was dropped, not an instruction to erase the
 * school's records.
 *
 * It is not hypothetical. On 2026-08-11 the attendance register for the
 * previous day was gone — pushed away by a phone whose localStorage had been
 * dropped on quota, with the emptiness check running AFTER the delete. This
 * same function is copied into 20 modules and called from 86 places, almost
 * none of them guarded, covering bank and cash ledgers, payroll runs, fee
 * cheques, library issues and 1,919 admission records.
 *
 * This floor stops the catastrophic case everywhere at once. It does NOT make
 * a partial payload safe — a client holding 3 of 900 rows still prunes 897.
 * That needs per-module scoping, the way attendance now prunes only within
 * the dates its payload covers. See docs/TODO.md.
 *
 * The read error is also surfaced now. It was discarded, which happened to
 * fail safe here (no data → nothing deleted), but "we could not read the
 * table" and "the table is empty" must not be the same value in a function
 * that deletes.
 */
async function deleteStale(
  sb: SupabaseClient,
  tenantId: string,
  table: string,
  keepIds: Set<string>,
) {
  if (keepIds.size === 0) {
    console.warn(
      `[${table}] refusing to prune: the payload holds no ids at all. ` +
        "An empty client is not an instruction to delete every row.",
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

function requestToRow(
  tenantId: string,
  r: StudentLeaveRequest,
): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: r.id,
    tenant_id: tenantId,
    academic_year_code: r.academicYearCode,
    student_id: r.studentId,
    from_date: r.fromDate,
    to_date: r.toDate,
    leave_type: r.leaveType,
    reason: r.reason || "",
    attachment_url: r.attachmentUrl || "",
    status: r.status,
    requested_by: r.requestedBy || "",
    household_id: r.householdId || "",
    created_at: r.createdAt || now,
    decided_by: r.decidedBy || "",
    decided_at: r.decidedAt || null,
    decision_note: r.decisionNote || "",
    attendance_applied: !!r.attendanceApplied,
    updated_at: now,
  };
}

function rowToRequest(r: Record<string, unknown>): StudentLeaveRequest {
  const leaveType = String(r.leave_type) as StudentLeaveType;
  const status = String(r.status) as StudentLeaveStatus;
  return {
    id: String(r.id),
    academicYearCode: String(r.academic_year_code),
    studentId: String(r.student_id),
    fromDate: String(r.from_date).slice(0, 10),
    toDate: String(r.to_date).slice(0, 10),
    leaveType:
      leaveType === "HD_AM" ||
      leaveType === "HD_PM" ||
      leaveType === "ML" ||
      leaveType === "OD" ||
      leaveType === "LL"
        ? leaveType
        : "SL",
    reason: String(r.reason || ""),
    attachmentUrl: String(r.attachment_url || ""),
    status:
      status === "approved" ||
      status === "rejected" ||
      status === "cancelled"
        ? status
        : "pending",
    requestedBy: String(r.requested_by || ""),
    householdId: String(r.household_id || ""),
    createdAt: String(r.created_at),
    decidedBy: String(r.decided_by || ""),
    decidedAt: r.decided_at ? String(r.decided_at) : "",
    decisionNote: String(r.decision_note || ""),
    attendanceApplied: !!r.attendance_applied,
  };
}

function mapMetaRow(
  metaRow: Record<string, unknown> | null,
): StudentLeaveDeskSyncMeta | null {
  if (!metaRow) return null;
  return {
    requestCount: metaRow.request_count as number,
    pendingCount: metaRow.pending_count as number,
    approvedCount: metaRow.approved_count as number,
    lastRequestAt: metaRow.last_request_at as string | null,
    updatedAt: String(metaRow.updated_at),
  };
}

export async function pushStudentLeaveDeskToDb(
  state: StudentLeaveState,
): Promise<{ ok: boolean; error?: string }> {
  if (!studentLeaveDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = new Date().toISOString();

  const requests = state.requests ?? [];
  await deleteStale(
    sb,
    tenantId,
    "student_leave_desk_requests",
    new Set(requests.map((r) => r.id)),
  );

  const r = await upsertChunks(
    sb,
    "student_leave_desk_requests",
    requests.map((req) => requestToRow(tenantId, req)),
  );
  if (!r.ok) return r;

  let lastRequestAt: string | null = null;
  for (const req of requests) {
    const at = req.createdAt;
    if (at && (!lastRequestAt || at > lastRequestAt)) lastRequestAt = at;
  }

  await sb.from("student_leave_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      request_count: requests.length,
      pending_count: requests.filter((x) => x.status === "pending").length,
      approved_count: requests.filter((x) => x.status === "approved").length,
      last_request_at: lastRequestAt,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true };
}

export async function fetchStudentLeaveDeskFromDb(): Promise<{
  bundle: StudentLeaveDeskBundle;
  meta: StudentLeaveDeskSyncMeta | null;
  /** false = tenant/query could not be resolved; bundle is NOT a confirmed empty state. */
  ok: boolean;
}> {
  const ctx = await resolveCtx();
  const empty: StudentLeaveDeskBundle = { requests: [] };
  if (!ctx) return { bundle: empty, meta: null, ok: false };
  const { sb, tenantId } = ctx;

  const [{ data: requestRows, error: requestErr }, { data: metaRow }] = await Promise.all([
    sb.from("student_leave_desk_requests").select("*").eq("tenant_id", tenantId),
    sb
      .from("student_leave_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  if (requestErr) {
    console.warn("[student-leave-db] fetch failed", requestErr.message);
    return { bundle: empty, meta: null, ok: false };
  }

  return {
    bundle: {
      requests: (requestRows ?? []).map((r) =>
        rowToRequest(r as Record<string, unknown>),
      ),
    },
    meta: mapMetaRow(metaRow as Record<string, unknown> | null),
    ok: true,
  };
}
