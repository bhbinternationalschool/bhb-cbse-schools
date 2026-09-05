import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { ensureStudentLeaveHydratedServer } from "@/lib/studentLeavePersistence";
import {
  leaveDayCount,
  leaveTypeLabel,
  loadStudentLeave,
  pendingApproverHint,
} from "@/lib/studentLeave";
import { loadSis } from "@/lib/sis";
import { scopeAllows, staffSectionScope } from "@/lib/api/v1/staffScope";

export const runtime = "nodejs";

/** Over 3 days, medical or long leave is the principal's call, not the class teacher's. */
export function needsLeadership(req: { fromDate: string; toDate: string; leaveType: string }): boolean {
  return leaveDayCount(req) > 3 || req.leaveType === "ML" || req.leaveType === "LL";
}

/**
 * GET /api/v1/staff/student-leave?status=pending|decided — parents' leave
 * requests for the sections this teacher is responsible for (every section
 * for leadership / office), with who may decide each.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "student_leave", "view");
    const url = new URL(request.url);
    const which = url.searchParams.get("status") === "decided" ? "decided" : "pending";
    const scope = await staffSectionScope(ctx);

    await ensureSchoolMirrorHydrated();
    await Promise.all([ensureSisHydratedServer(), ensureStudentLeaveHydratedServer()]);
    const ay = ctx.session.academicYearCode;
    const sis = loadSis();
    const studentById = new Map(sis.students.map((s) => [s.id, s]));
    const classNameOf = (id: string) =>
      ctx.masters.classes.find((c) => c.id === id)?.name || "";
    const sectionNameOf = (id: string) =>
      ctx.masters.sections.find((s) => s.id === id)?.name || "";

    const rows = loadStudentLeave()
      .requests.filter((r) => !r.academicYearCode || r.academicYearCode === ay)
      .filter((r) => (which === "pending" ? r.status === "pending" : r.status !== "pending"))
      .map((r) => ({ r, st: studentById.get(r.studentId) }))
      .filter(({ st }) => !!st && scopeAllows(scope, st.classId, st.sectionId))
      .sort((a, b) => b.r.createdAt.localeCompare(a.r.createdAt))
      .slice(0, which === "pending" ? 200 : 60)
      .map(({ r, st }) => {
        const leadershipOnly = needsLeadership(r);
        return {
          id: r.id,
          studentId: r.studentId,
          studentName: st!.fullName,
          classLabel: `${classNameOf(st!.classId)} ${sectionNameOf(st!.sectionId)}`.trim(),
          fromDate: r.fromDate,
          toDate: r.toDate,
          days: leaveDayCount(r),
          leaveType: r.leaveType,
          leaveTypeLabel: leaveTypeLabel(r.leaveType),
          reason: r.reason,
          status: r.status,
          requestedBy: r.requestedBy,
          createdAt: r.createdAt,
          decidedBy: r.decidedBy,
          decidedAt: r.decidedAt,
          decisionNote: r.decisionNote,
          approverHint: pendingApproverHint(r),
          canDecide:
            r.status === "pending" &&
            (scope.kind === "leadership" || (!leadershipOnly && scope.unrestricted) ||
              (!leadershipOnly && scope.classTeacherOf.has(`${st!.classId}|${st!.sectionId}`))),
        };
      });

    return apiOk({ status: which, requests: rows });
  } catch (e) {
    return apiErr(e);
  }
}
