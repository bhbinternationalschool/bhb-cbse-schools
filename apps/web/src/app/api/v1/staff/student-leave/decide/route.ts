import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { ensureAttendanceHydratedServer } from "@/lib/attendancePersistence";
import { findRegister, loadAttendance } from "@/lib/attendance";
import {
  ensureStudentLeaveHydratedServer,
  pushStudentLeaveRemoteServer,
} from "@/lib/studentLeavePersistence";
import {
  decideStudentLeave,
  leaveDayCount,
  leaveTypeLabel,
  loadStudentLeave,
  writeStudentLeaveLocalRaw,
} from "@/lib/studentLeave";
import { loadSis } from "@/lib/sis";
import { staffSectionScope } from "@/lib/api/v1/staffScope";
import { sendPushToSubject } from "@/lib/webPush.server";
import { needsLeadership } from "../route";

export const runtime = "nodejs";

type Body = { id?: string; approve?: boolean; note?: string };

function datesInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return out;
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * POST /api/v1/staff/student-leave/decide {id, approve, note} — class
 * teacher (≤3 days, not medical/long) or leadership decides a parent's
 * request. Approval writes the leave onto the attendance registers exactly
 * as the desk does; the registers touched are pushed to the DB, and the
 * parent gets a push either way.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "student_leave", "approve");
    const body = (await request.json().catch(() => ({}))) as Body;
    const id = (body.id || "").trim();
    if (!id) throw new ApiError("bad_request", "id required", 400);
    const approve = !!body.approve;
    const note = (body.note || "").trim().slice(0, 300);

    const scope = await staffSectionScope(ctx);
    await ensureSchoolMirrorHydrated();
    await Promise.all([
      ensureSisHydratedServer(),
      ensureStudentLeaveHydratedServer(),
      ensureAttendanceHydratedServer(),
    ]);
    const req = loadStudentLeave().requests.find((r) => r.id === id);
    if (!req) throw new ApiError("not_found", "Request not found", 404);
    if (req.status !== "pending") throw new ApiError("bad_request", "Already decided", 400);
    const sis = loadSis();
    const student = sis.students.find((s) => s.id === req.studentId);
    if (!student) throw new ApiError("not_found", "Student not found", 404);

    const key = `${student.classId}|${student.sectionId}`;
    const leadershipOnly = needsLeadership(req);
    const allowed =
      scope.kind === "leadership" ||
      (!leadershipOnly && (scope.unrestricted || scope.classTeacherOf.has(key)));
    if (!allowed) {
      throw new ApiError(
        "forbidden",
        leadershipOnly
          ? "Over 3 days, medical or long leave is decided by the principal"
          : "Only the class teacher or the principal can decide this",
        403,
      );
    }

    const result = decideStudentLeave({
      id,
      approve,
      by: ctx.session.fullName || "Teacher",
      note,
    });
    if (!result.ok) throw new ApiError("bad_request", result.error, 400);

    // decideStudentLeave saves through the browser path, a no-op here.
    const state = loadStudentLeave();
    const next = {
      ...state,
      requests: state.requests.map((r) => (r.id === id ? result.request : r)),
    };
    writeStudentLeaveLocalRaw(next);
    const pushed = await pushStudentLeaveRemoteServer(next);
    if (!pushed.ok) {
      console.warn("[staff-student-leave-v1] db push failed", pushed.error);
      throw new ApiError("server_error", "Could not save — try again", 503);
    }

    let registersPushed = 0;
    if (approve && result.request.attendanceApplied) {
      const { pushAttendanceRegisterToDb } = await import("@/lib/attendanceNormalized.server");
      const att = loadAttendance();
      for (const date of datesInclusive(req.fromDate, req.toDate)) {
        const reg = findRegister(req.academicYearCode, student.sectionId, date, att);
        if (!reg) continue;
        const r = await pushAttendanceRegisterToDb(reg);
        if (r.ok) registersPushed += 1;
        else console.warn("[staff-student-leave-v1] register push failed", date, r.error);
      }
    }

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "student_leave",
      action: "approve",
      entityType: "leave_request",
      entityId: id,
      summary: `Leave ${result.request.status} for ${student.fullName}: ${leaveTypeLabel(req.leaveType)} ${req.fromDate}${req.toDate !== req.fromDate ? ` to ${req.toDate}` : ""}`,
      after: { status: result.request.status, note, registersPushed },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    if (student.householdId) {
      const span = req.fromDate === req.toDate ? req.fromDate : `${req.fromDate} to ${req.toDate}`;
      await sendPushToSubject("parent", student.householdId, {
        title: approve ? `Leave approved · ${student.fullName}` : `Leave not approved · ${student.fullName}`,
        body: `${leaveTypeLabel(req.leaveType)} ${span}${note ? ` · ${note}` : ""}`,
        url: `/leave?studentId=${encodeURIComponent(student.id)}`,
        data: { kind: "student_leave_decision", studentId: student.id, status: result.request.status },
      }).catch(() => undefined);
    }

    return apiOk({
      id,
      status: result.request.status,
      days: leaveDayCount(req),
      attendanceApplied: result.request.attendanceApplied,
      registersPushed,
    });
  } catch (e) {
    return apiErr(e);
  }
}
