import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { requireParentHousehold } from "@/lib/api/v1/household";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureStudentLeaveHydratedServer } from "@/lib/studentLeavePersistence";
import {
  emptyStudentLeaveState,
  leaveDayCount,
  leaveTypeLabel,
  loadStudentLeave,
  STUDENT_LEAVE_TYPES,
  writeStudentLeaveLocalRaw,
} from "@/lib/studentLeave";
import { loadSis } from "@/lib/sis";

export const runtime = "nodejs";

/**
 * GET /api/v1/leave/list?studentId= — the household's leave requests,
 * newest first, plus the leave-type catalogue so the app does not hard-code
 * it. studentId narrows to one child; omitted, every child is listed.
 *
 * The server-side leave cache is reset before hydrating so the answer is
 * what the database holds, not what an earlier request on this instance
 * left behind.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);
    const url = new URL(request.url);
    const studentId = url.searchParams.get("studentId")?.trim() || "";

    await ensureSchoolMirrorHydrated();
    writeStudentLeaveLocalRaw(emptyStudentLeaveState());
    await ensureStudentLeaveHydratedServer();

    const sis = loadSis();
    const nameOf = new Map(sis.students.map((s) => [s.id, s.fullName]));

    const requests = loadStudentLeave()
      .requests.filter(
        (r) =>
          r.householdId === householdId &&
          (!studentId || r.studentId === studentId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => ({
        id: r.id,
        studentId: r.studentId,
        studentName: nameOf.get(r.studentId) ?? "",
        fromDate: r.fromDate,
        toDate: r.toDate,
        days: leaveDayCount(r),
        leaveType: r.leaveType,
        leaveTypeLabel: leaveTypeLabel(r.leaveType),
        reason: r.reason,
        status: r.status,
        createdAt: r.createdAt,
        decidedAt: r.decidedAt,
        decisionNote: r.decisionNote,
      }));

    return apiOk({
      requests,
      leaveTypes: STUDENT_LEAVE_TYPES.map((t) => ({
        code: t.code,
        label: t.label,
        note: t.note,
      })),
    });
  } catch (e) {
    return apiErr(e);
  }
}
