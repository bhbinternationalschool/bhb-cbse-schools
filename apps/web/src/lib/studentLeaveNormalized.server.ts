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
import { deleteNamedIds, type NamedDeletes } from "@/lib/deskNamedDeletes.server";
import { fetchAllPages, fetchByIds } from "@/lib/supabase/pageAll";
import { planStudentLeavePush } from "@/lib/studentLeavePushPlan";

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

async function upsertChunks(
  sb: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  chunk = 200,
  opts?: { onConflict?: string; ignoreDuplicates?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  for (let i = 0; i < rows.length; i += chunk) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + chunk), opts);
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

/** The only leave table a desk save deletes from — by named id. */
export const STUDENT_LEAVE_DELETABLE_TABLES = ["student_leave_desk_requests"] as const;
/** Desk slice each deletable table stores (for function-only writers). */
export const STUDENT_LEAVE_TABLE_SLICES: Record<string, string> = {
  student_leave_desk_requests: "requests",
};

export async function pushStudentLeaveDeskToDb(
  state: StudentLeaveState,
  deletes: NamedDeletes = {},
): Promise<{ ok: boolean; error?: string; kept?: string[] }> {
  if (!studentLeaveDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = new Date().toISOString();

  // No prune by absence. Parents file and cancel leave from the app, which
  // writes on the server; an office tab that read earlier deleted those
  // requests on its next save — and a parent's push from a server whose read
  // had failed held one request and deleted every other. A request goes only
  // when the office deleted it (pending or cancelled), named.
  const gone = new Set(deletes["student_leave_desk_requests"] ?? []);
  const requests = (state.requests ?? []).filter((r) => r?.id && !gone.has(r.id));

  // No stale copy over a decision. A request leaves "pending" once, on the
  // staff app, WhatsApp, the parent app or this desk — and an office tab
  // still holding it as pending wrote "pending" back. Read what is stored;
  // a failed read writes nothing (unknown is not "not there").
  const stored = await fetchByIds<Record<string, unknown>>(
    requests.map((r) => r.id),
    (chunk, from, to) =>
      sb
        .from("student_leave_desk_requests")
        .select("*")
        .eq("tenant_id", tenantId)
        .in("id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
    { chunkSize: 100 },
  );
  if (stored.error) return { ok: false, error: stored.error };
  const plan = planStudentLeavePush(
    requests,
    new Map(stored.rows.map((r) => [String(r.id), rowToRequest(r)])),
  );
  const kept = [...plan.kept];

  const ins = await upsertChunks(
    sb,
    "student_leave_desk_requests",
    plan.insert.map((req) => requestToRow(tenantId, req)),
    200,
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (!ins.ok) return ins;
  for (const req of plan.update) {
    const row = requestToRow(tenantId, req);
    delete row.id;
    delete row.tenant_id;
    delete row.created_at;
    const { data, error } = await sb
      .from("student_leave_desk_requests")
      .update(row)
      .eq("tenant_id", tenantId)
      .eq("id", req.id)
      .eq("status", "pending")
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!data?.length) kept.push(req.id); // decided between the read and the write
  }
  const del = await deleteNamedIds(sb, tenantId, "student_leave_desk_requests", [...gone]);
  if (!del.ok) return del;

  // Counts from the database, not from this copy (it may be partly kept).
  await touchStudentLeaveMeta(sb, tenantId, now).catch(() => undefined);
  if (kept.length) console.warn("[student-leave-db] kept decided requests over a stale copy", kept);
  return { ok: true, kept };
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

  // Paged: PostgREST stops at 1,000 rows, and the whole desk is pushed
  // back (pruning) from a copy read here.
  const [{ data: requestRows, error: requestErr }, { data: metaRow }] = await Promise.all([
    fetchAllPages<Record<string, unknown>>((from, to) =>
      sb
        .from("student_leave_desk_requests")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("id", { ascending: true })
        .range(from, to),
    ).then((r) => ({ data: r.rows, error: r.error ? { message: r.error } : null })),
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

/** One request, straight from the database. `ok: false` = the read failed
 * (not "no such request"). */
export async function fetchStudentLeaveRequestFromDb(
  id: string,
): Promise<{ ok: true; request: StudentLeaveRequest | null } | { ok: false; error: string }> {
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { data, error } = await ctx.sb
    .from("student_leave_desk_requests")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, request: data ? rowToRequest(data as Record<string, unknown>) : null };
}

/** Recount the desk meta after a single-row write, so a browser's hydrate
 * (which compares `updated_at`) sees that something changed. */
async function touchStudentLeaveMeta(
  sb: SupabaseClient,
  tenantId: string,
  now: string,
): Promise<void> {
  const count = (status?: StudentLeaveStatus) => {
    let q = sb
      .from("student_leave_desk_requests")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    if (status) q = q.eq("status", status);
    return q;
  };
  const [all, pending, approved, latest] = await Promise.all([
    count(),
    count("pending"),
    count("approved"),
    sb
      .from("student_leave_desk_requests")
      .select("created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const row: Record<string, unknown> = { tenant_id: tenantId, updated_at: now };
  // A failed count leaves the old figure alone rather than writing a zero.
  if (!all.error && typeof all.count === "number") row.request_count = all.count;
  if (!pending.error && typeof pending.count === "number") row.pending_count = pending.count;
  if (!approved.error && typeof approved.count === "number") row.approved_count = approved.count;
  if (!latest.error) row.last_request_at = (latest.data as { created_at?: string } | null)?.created_at ?? null;
  await sb.from("student_leave_desk_sync_meta").upsert(row, { onConflict: "tenant_id" });
}

/**
 * Record ONE decision on ONE request (2026-09-29).
 *
 * The decide route used to push the whole desk from this instance's memory
 * — a replace that prunes every row it does not hold, from a copy that may
 * be minutes old. Here only the decided row changes, and only while it is
 * still pending in the database: two people deciding at once cannot both
 * win, and the second is told plainly (`conflict`).
 */
export async function recordStudentLeaveDecisionInDb(
  decided: StudentLeaveRequest,
): Promise<{ ok: true } | { ok: false; conflict: boolean; error: string }> {
  if (!studentLeaveDualWriteDbEnabled()) {
    return {
      ok: false,
      conflict: false,
      error:
        "Student leave is not being saved to the school database (STUDENT_LEAVE_DUAL_WRITE_DB is off)",
    };
  }
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, conflict: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = new Date().toISOString();
  const { data, error } = await sb
    .from("student_leave_desk_requests")
    .update({
      status: decided.status,
      decided_by: decided.decidedBy || "",
      decided_at: decided.decidedAt || now,
      decision_note: decided.decisionNote || "",
      attendance_applied: !!decided.attendanceApplied,
      updated_at: now,
    })
    .eq("tenant_id", tenantId)
    .eq("id", decided.id)
    .eq("status", "pending")
    .select("id");
  if (error) return { ok: false, conflict: false, error: error.message };
  if (!data?.length) {
    return {
      ok: false,
      conflict: true,
      error: "This request was already decided or withdrawn — refresh the list",
    };
  }
  await touchStudentLeaveMeta(sb, tenantId, now).catch(() => undefined);
  return { ok: true };
}

/** Flip `attendance_applied` on one request once its marks are saved. */
export async function setStudentLeaveAttendanceAppliedInDb(
  id: string,
  applied: boolean,
): Promise<{ ok: boolean; error?: string }> {
  if (!studentLeaveDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = new Date().toISOString();
  const { error } = await sb
    .from("student_leave_desk_requests")
    .update({ attendance_applied: applied, updated_at: now })
    .eq("tenant_id", tenantId)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  await touchStudentLeaveMeta(sb, tenantId, now).catch(() => undefined);
  return { ok: true };
}
