/**
 * Attendance desk ancillary — policy, absent nudges, exceptions (server-only).
 */

import type {
  AbsentNudgeLog,
  AttendanceException,
  AttendancePolicy,
  AttendanceState,
} from "@/lib/attendance";
import { attendanceDualWriteDbEnabled } from "@/lib/attendanceDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";
import { deleteNamedIds, type NamedDeletes } from "@/lib/deskNamedDeletes.server";
import { fetchAllPages, fetchByIds } from "@/lib/supabase/pageAll";

export type AttendanceDeskAncillary = Pick<
  AttendanceState,
  "policy" | "absentNudges" | "exceptions"
>;

function defaultPolicy(): AttendancePolicy {
  return {
    teacherCutoffTime: "10:30",
    lockTeachersAfterCutoff: true,
    absentNudgeEnabled: true,
    absentNudgeMaxOpen: 12,
  };
}

function emptyAncillary(): AttendanceDeskAncillary {
  return {
    policy: defaultPolicy(),
    absentNudges: [],
    exceptions: [],
  };
}

async function ctx() {
  return getServerTenantContext();
}

export async function pushAttendanceDeskAncillaryToDb(
  ancillary: AttendanceDeskAncillary,
  deletes: NamedDeletes = {},
): Promise<{ ok: boolean; error?: string }> {
  if (!attendanceDualWriteDbEnabled()) return { ok: true };
  const c = await ctx();
  if (!c) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = c;
  const now = new Date().toISOString();

  // No stale copy over a newer one (2026-10-10). Every attendance save
  // rewrote the policy, the nudges and the exceptions from the browser's
  // copy: a tab holding last week's cut-off put it back the moment anyone
  // marked a register, and a resolved exception came back open.
  //  - The policy is written only when it was changed after the stored one
  //    (its own updatedAt), or when none is stored.
  //  - Nudges are a log of messages sent: only ever added.
  //  - A resolved exception stays resolved.
  const policy = ancillary.policy ?? defaultPolicy();
  const { data: storedPolicy, error: spErr } = await sb
    .from("attendance_desk_policy")
    .select("updated_at")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (spErr) return { ok: false, error: `Could not read the stored attendance policy: ${spErr.message}` };
  const policyAt = Date.parse(policy.updatedAt || "");
  const writePolicy =
    !storedPolicy ||
    (Number.isFinite(policyAt) && policyAt > Date.parse(String((storedPolicy as { updated_at?: string }).updated_at || "")));
  const { error: pErr } = !writePolicy ? { error: null } : await sb.from("attendance_desk_policy").upsert(
    {
      tenant_id: tenantId,
      teacher_cutoff_time: policy.teacherCutoffTime || "10:30",
      lock_teachers_after_cutoff: !!policy.lockTeachersAfterCutoff,
      absent_nudge_enabled: !!policy.absentNudgeEnabled,
      absent_nudge_max_open: Math.min(
        40,
        Math.max(1, Number(policy.absentNudgeMaxOpen) || 12),
      ),
      updated_at: policy.updatedAt || now,
    },
    { onConflict: "tenant_id" },
  );
  if (pErr) return { ok: false, error: pErr.message };

  // No prune by absence. The browser keeps 500 nudges and rebuilds open
  // exceptions under fresh ids; saves used to delete everything else. Now a
  // nudge goes with the register the user deleted, and an exception the
  // rebuild superseded (or a duplicate dispute) is named — see attendance.ts.
  const goneNudges = new Set(deletes["attendance_desk_absent_nudges"] ?? []);
  const goneExceptions = new Set(deletes["attendance_desk_exceptions"] ?? []);
  const nudges = (ancillary.absentNudges ?? [])
    .filter((n) => !goneNudges.has(n.id))
    .slice(0, 500);
  if (nudges.length) {
    const rows = nudges.map((n: AbsentNudgeLog) => ({
      id: n.id,
      tenant_id: tenantId,
      student_id: n.studentId,
      register_id: n.registerId || "",
      attendance_date: n.date,
      section_id: n.sectionId || "",
      academic_year_code: n.academicYearCode,
      mobile: n.mobile || "",
      message: n.message || "",
      sent_at: n.sentAt || now,
      sent_by: n.sentBy || "",
      nudge_json: {},
      updated_at: now,
    }));
    const { error } = await sb
      .from("attendance_desk_absent_nudges")
      .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
    if (error) return { ok: false, error: error.message };
  }

  // One row per id: the same exception twice in a batch fails the upsert.
  const exceptions = [
    ...new Map(
      (ancillary.exceptions ?? [])
        .filter((e) => !goneExceptions.has(e.id))
        .map((e) => [e.id, e] as const),
    ).values(),
  ];
  // A resolved exception stays resolved: a copy holding it open is not written.
  const resolved = new Set<string>();
  if (exceptions.length) {
    const read = await fetchByIds<{ id: string; status: string }>(
      exceptions.map((e) => e.id),
      (chunk, from, to) =>
        sb
          .from("attendance_desk_exceptions")
          .select("id, status")
          .eq("tenant_id", tenantId)
          .in("id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
    );
    if (read.error) return { ok: false, error: `Could not read the stored exceptions: ${read.error}` };
    for (const r of read.rows) if (r.status === "resolved") resolved.add(String(r.id));
  }
  const writeExceptions = exceptions.filter((e) => e.status === "resolved" || !resolved.has(e.id));
  if (writeExceptions.length) {
    const rows = writeExceptions.map((e: AttendanceException) => ({
      id: e.id,
      tenant_id: tenantId,
      kind: e.kind,
      status: e.status === "resolved" ? "resolved" : "open",
      student_id: e.studentId,
      academic_year_code: e.academicYearCode,
      class_id: e.classId || "",
      section_id: e.sectionId || "",
      attendance_date: e.date,
      register_id: e.registerId || "",
      detail: e.detail || "",
      created_at: e.createdAt || now,
      resolved_at: e.resolvedAt || null,
      resolved_by: e.resolvedBy || "",
      resolve_note: e.resolveNote || "",
      exception_json: {},
      updated_at: now,
    }));
    const { error } = await sb
      .from("attendance_desk_exceptions")
      .upsert(rows, { onConflict: "id" });
    if (error) return { ok: false, error: error.message };
  }

  for (const [table, ids] of [
    ["attendance_desk_absent_nudges", goneNudges],
    ["attendance_desk_exceptions", goneExceptions],
  ] as const) {
    const del = await deleteNamedIds(sb, tenantId, table, [...ids]);
    if (!del.ok) return del;
  }

  // Counts from the tables, not from this copy (it may be partly written).
  const count = (table: string) =>
    sb.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  const [nc, ec, oc] = await Promise.all([
    count("attendance_desk_absent_nudges"),
    count("attendance_desk_exceptions"),
    count("attendance_desk_exceptions").eq("status", "open"),
  ]);
  const meta: Record<string, unknown> = { tenant_id: tenantId, ancillary_updated_at: now, updated_at: now };
  // A failed count leaves the old figure alone rather than writing a zero.
  const ok = (r: { error: unknown; count: number | null }) => !r.error && typeof r.count === "number";
  if (ok(nc)) meta.nudge_count = nc.count;
  if (ok(ec)) meta.exception_count = ec.count;
  if (ok(oc)) meta.open_exception_count = oc.count;
  await sb.from("attendance_desk_sync_meta").upsert(meta, { onConflict: "tenant_id" });

  return { ok: true };
}

export async function fetchAttendanceDeskAncillaryFromDb(): Promise<AttendanceDeskAncillary> {
  return (await readAttendanceDeskAncillary()).ancillary;
}

/**
 * The ancillary as stored, and whether every part of it was read. The
 * plain fetch above reads a failed table as empty — fine for a screen, not
 * for a save that merges onto it (a function holder's push to
 * school-data/attendance-registers), which must write nothing then.
 */
export async function readAttendanceDeskAncillary(): Promise<{
  ok: boolean;
  ancillary: AttendanceDeskAncillary;
}> {
  const c = await ctx();
  if (!c) return { ok: false, ancillary: emptyAncillary() };
  const { sb, tenantId } = c;

  const [
    { data: policyRow, error: policyErr },
    { data: nudgeRows, error: nudgeErr },
    { rows: exceptionRows, error: exceptionErr },
  ] = await Promise.all([
    sb
      .from("attendance_desk_policy")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    sb
      .from("attendance_desk_absent_nudges")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("sent_at", { ascending: false })
      .limit(500),
    // Paged: the push prunes exceptions to the ids it is given, and
    // PostgREST stops at 1,000 rows.
    fetchAllPages<Record<string, unknown>>((from, to) =>
      sb
        .from("attendance_desk_exceptions")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);
  const ok = !policyErr && !nudgeErr && !exceptionErr;

  const policy: AttendancePolicy = policyRow
    ? {
        teacherCutoffTime: String(
          policyRow.teacher_cutoff_time || defaultPolicy().teacherCutoffTime,
        ),
        lockTeachersAfterCutoff: !!policyRow.lock_teachers_after_cutoff,
        absentNudgeEnabled: !!policyRow.absent_nudge_enabled,
        absentNudgeMaxOpen: Number(policyRow.absent_nudge_max_open) || 12,
        updatedAt: String(policyRow.updated_at || ""),
      }
    : defaultPolicy();

  const ancillary: AttendanceDeskAncillary = {
    policy,
    absentNudges: (nudgeRows ?? []).map(
      (r): AbsentNudgeLog => ({
        id: String(r.id),
        studentId: String(r.student_id),
        registerId: String(r.register_id || ""),
        date: String(r.attendance_date).slice(0, 10),
        sectionId: String(r.section_id || ""),
        academicYearCode: String(r.academic_year_code),
        mobile: String(r.mobile || ""),
        message: String(r.message || ""),
        sentAt: String(r.sent_at),
        sentBy: String(r.sent_by || ""),
      }),
    ),
    exceptions: (exceptionRows ?? []).map(
      (r): AttendanceException => ({
        id: String(r.id),
        kind: r.kind as AttendanceException["kind"],
        status: r.status === "resolved" ? "resolved" : "open",
        studentId: String(r.student_id),
        academicYearCode: String(r.academic_year_code),
        classId: String(r.class_id || ""),
        sectionId: String(r.section_id || ""),
        date: String(r.attendance_date).slice(0, 10),
        registerId: String(r.register_id || ""),
        detail: String(r.detail || ""),
        createdAt: String(r.created_at),
        resolvedAt: r.resolved_at ? String(r.resolved_at) : "",
        resolvedBy: String(r.resolved_by || ""),
        resolveNote: String(r.resolve_note || ""),
      }),
    ),
  };
  return { ok, ancillary };
}

export async function fetchOpenExceptionCount(): Promise<number> {
  const c = await ctx();
  if (!c) return 0;
  const { count } = await c.sb
    .from("attendance_desk_exceptions")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", c.tenantId)
    .eq("status", "open");
  return count ?? 0;
}
