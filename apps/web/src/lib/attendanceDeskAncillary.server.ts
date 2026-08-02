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

async function deleteStale(
  sb: NonNullable<Awaited<ReturnType<typeof ctx>>>["sb"],
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

export async function pushAttendanceDeskAncillaryToDb(
  ancillary: AttendanceDeskAncillary,
): Promise<{ ok: boolean; error?: string }> {
  if (!attendanceDualWriteDbEnabled()) return { ok: true };
  const c = await ctx();
  if (!c) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = c;
  const now = new Date().toISOString();

  const policy = ancillary.policy ?? defaultPolicy();
  const { error: pErr } = await sb.from("attendance_desk_policy").upsert(
    {
      tenant_id: tenantId,
      teacher_cutoff_time: policy.teacherCutoffTime || "10:30",
      lock_teachers_after_cutoff: !!policy.lockTeachersAfterCutoff,
      absent_nudge_enabled: !!policy.absentNudgeEnabled,
      absent_nudge_max_open: Math.min(
        40,
        Math.max(1, Number(policy.absentNudgeMaxOpen) || 12),
      ),
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );
  if (pErr) return { ok: false, error: pErr.message };

  const nudges = (ancillary.absentNudges ?? []).slice(0, 500);
  await deleteStale(
    sb,
    tenantId,
    "attendance_desk_absent_nudges",
    new Set(nudges.map((x) => x.id)),
  );
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
      .upsert(rows, { onConflict: "id" });
    if (error) return { ok: false, error: error.message };
  }

  const exceptions = ancillary.exceptions ?? [];
  await deleteStale(
    sb,
    tenantId,
    "attendance_desk_exceptions",
    new Set(exceptions.map((x) => x.id)),
  );
  if (exceptions.length) {
    const rows = exceptions.map((e: AttendanceException) => ({
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

  const openCount = exceptions.filter((e) => e.status !== "resolved").length;
  await sb.from("attendance_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      ancillary_updated_at: now,
      nudge_count: nudges.length,
      exception_count: exceptions.length,
      open_exception_count: openCount,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true };
}

export async function fetchAttendanceDeskAncillaryFromDb(): Promise<AttendanceDeskAncillary> {
  const c = await ctx();
  if (!c) return emptyAncillary();
  const { sb, tenantId } = c;

  const [{ data: policyRow }, { data: nudgeRows }, { data: exceptionRows }] =
    await Promise.all([
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
      sb
        .from("attendance_desk_exceptions")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }),
    ]);

  const policy: AttendancePolicy = policyRow
    ? {
        teacherCutoffTime: String(
          policyRow.teacher_cutoff_time || defaultPolicy().teacherCutoffTime,
        ),
        lockTeachersAfterCutoff: !!policyRow.lock_teachers_after_cutoff,
        absentNudgeEnabled: !!policyRow.absent_nudge_enabled,
        absentNudgeMaxOpen: Number(policyRow.absent_nudge_max_open) || 12,
      }
    : defaultPolicy();

  return {
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
