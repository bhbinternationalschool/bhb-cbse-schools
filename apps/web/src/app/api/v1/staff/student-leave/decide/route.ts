import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import {
  leaveDayCount,
  leaveTypeLabel,
  loadStudentLeave,
  writeStudentLeaveLocalRaw,
  type StudentLeaveRequest,
} from "@/lib/studentLeave";
import {
  fetchStudentLeaveRequestFromDb,
  recordStudentLeaveDecisionInDb,
  setStudentLeaveAttendanceAppliedInDb,
} from "@/lib/studentLeaveNormalized.server";
import { applyApprovedLeaveToRegisters } from "@/lib/studentLeaveAttendance.server";
import { loadSisForStaff } from "@/lib/sis";
import { staffSectionScope } from "@/lib/api/v1/staffScope";
import { sendPushToSubject } from "@/lib/webPush.server";
import { needsLeadership } from "@/lib/api/v1/studentLeaveRules";

export const runtime = "nodejs";

type Body = { id?: string; approve?: boolean; note?: string };

/**
 * POST /api/v1/staff/student-leave/decide {id, approve, note} — class
 * teacher (≤3 days, not medical/long) or leadership decides a parent's
 * request. The staff app and, since 2026-09-29, the web desk in teacher
 * mode both decide here.
 *
 * What changed on 2026-09-29, and why:
 *  - The decision is written as ONE row, and only while that row is still
 *    pending in the database. It used to push the whole leave desk from
 *    this instance's memory (a replace that prunes what it does not hold).
 *  - Approval puts the leave mark on that one child's EXISTING registers,
 *    read fresh from the database. It used to run the browser helper,
 *    which on the server marks every other child present on dates with no
 *    register — and whose writes to the server cache the push loop then
 *    read back inconsistently. Dates without a register are reported back
 *    (`unmarkedDates`) for the teacher to mark; nothing is invented.
 *  - The parent still gets a push either way.
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
    await ensureSisHydratedServer();
    // The request as the database holds it now — not this instance's cached
    // desk, and without emptying that cache (another request on this
    // instance may be mid-way through reading it).
    const found = await fetchStudentLeaveRequestFromDb(id);
    if (!found.ok) {
      console.warn("[staff-student-leave-v1] request read failed", found.error);
      throw new ApiError("server_error", "Could not read the leave request — try again", 503);
    }
    const req = found.request;
    if (!req) throw new ApiError("not_found", "Request not found", 404);
    if (req.status !== "pending") throw new ApiError("bad_request", `Already ${req.status}`, 400);
    const sis = loadSisForStaff();
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

    const decided: StudentLeaveRequest = {
      ...req,
      status: approve ? "approved" : "rejected",
      decidedBy: ctx.session.fullName || "Teacher",
      decidedAt: new Date().toISOString(),
      decisionNote: note,
      attendanceApplied: false,
    };
    const saved = await recordStudentLeaveDecisionInDb(decided);
    if (!saved.ok) {
      console.warn("[staff-student-leave-v1] decision not saved", saved.error);
      throw new ApiError(
        saved.conflict ? "conflict" : "server_error",
        saved.conflict ? saved.error : "The decision could not be saved — try again",
        saved.conflict ? 409 : 503,
      );
    }

    let appliedDates: string[] = [];
    let unmarkedDates: string[] = [];
    let failedDates: string[] = [];
    if (approve) {
      const applied = await applyApprovedLeaveToRegisters({
        request: decided,
        sectionId: student.sectionId,
      });
      ({ appliedDates, unmarkedDates, failedDates } = applied);
      // "Attendance applied" only when every date of the leave carries the
      // mark — a leave approved in advance is not applied yet.
      if (appliedDates.length > 0 && !unmarkedDates.length && !failedDates.length) {
        decided.attendanceApplied = true;
        const flag = await setStudentLeaveAttendanceAppliedInDb(id, true);
        if (!flag.ok) {
          decided.attendanceApplied = false;
          console.warn("[staff-student-leave-v1] applied flag not saved", flag.error);
        }
      }
    }

    // Keep this instance's cache in step with the row just written (only
    // when it already holds that row — never seed a cold cache with one).
    const state = loadStudentLeave();
    if (state.requests.some((r) => r.id === id)) {
      writeStudentLeaveLocalRaw({
        ...state,
        requests: state.requests.map((r) => (r.id === id ? decided : r)),
      });
    }

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "student_leave",
      action: "approve",
      entityType: "leave_request",
      entityId: id,
      summary: `Leave ${decided.status} for ${student.fullName}: ${leaveTypeLabel(req.leaveType)} ${req.fromDate}${req.toDate !== req.fromDate ? ` to ${req.toDate}` : ""}`,
      after: { status: decided.status, note, appliedDates, unmarkedDates, failedDates },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    if (student.householdId) {
      const span = req.fromDate === req.toDate ? req.fromDate : `${req.fromDate} to ${req.toDate}`;
      await sendPushToSubject("parent", student.householdId, {
        title: approve ? `Leave approved · ${student.fullName}` : `Leave not approved · ${student.fullName}`,
        body: `${leaveTypeLabel(req.leaveType)} ${span}${note ? ` · ${note}` : ""}`,
        url: `/leave?studentId=${encodeURIComponent(student.id)}`,
        data: { kind: "student_leave_decision", studentId: student.id, status: decided.status },
      }).catch(() => undefined);
    }

    return apiOk({
      id,
      status: decided.status,
      days: leaveDayCount(req),
      attendanceApplied: decided.attendanceApplied,
      // Kept for the staff app, which reads this count.
      registersPushed: appliedDates.length,
      appliedDates,
      unmarkedDates,
      failedDates,
    });
  } catch (e) {
    return apiErr(e);
  }
}
