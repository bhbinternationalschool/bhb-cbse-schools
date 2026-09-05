import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { ensureStudentLeaveHydratedServer } from "@/lib/studentLeavePersistence";
import { loadStudentLeave } from "@/lib/studentLeave";
import { loadSis } from "@/lib/sis";
import { listAllComplaintTickets } from "@/lib/complaintsServer";
import { scopeAllows, staffSectionScope } from "@/lib/api/v1/staffScope";
import { complaintInScope, OPEN_STATUSES } from "@/lib/api/v1/staffComplaints";
import { loadStaffHrServer } from "@/lib/api/v1/staffLeave";

export const runtime = "nodejs";

/**
 * GET /api/v1/staff/approvals — what is waiting on this staff member:
 * staff leave (leadership), parents' leave requests, open complaints and
 * documents to verify, each counted within their scope. Drives the
 * "Waiting for you" card on every staff home.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    const scope = await staffSectionScope(ctx);
    await ensureSchoolMirrorHydrated();
    await Promise.all([ensureSisHydratedServer(), ensureStudentLeaveHydratedServer()]);
    const ay = ctx.session.academicYearCode;
    const sis = loadSis();
    const studentById = new Map(sis.students.map((s) => [s.id, s]));
    const inScope = (studentId: string) => {
      const st = studentById.get(studentId);
      return !!st && scopeAllows(scope, st.classId, st.sectionId);
    };

    const studentLeavePending = loadStudentLeave().requests.filter(
      (r) => r.status === "pending" && (!r.academicYearCode || r.academicYearCode === ay) && inScope(r.studentId),
    ).length;

    let documentsPending = 0;
    for (const st of sis.students) {
      if (st.status !== "active" || st.academicYearCode !== ay) continue;
      if (!scopeAllows(scope, st.classId, st.sectionId)) continue;
      for (const doc of Object.values(st.docs || {})) {
        if (doc?.status === "pending") documentsPending += 1;
      }
    }

    let complaintsOpen = 0;
    try {
      const tickets = await listAllComplaintTickets();
      complaintsOpen = (tickets ?? []).filter(
        (t) => OPEN_STATUSES.has(t.status) && complaintInScope(ctx, scope, t, studentById),
      ).length;
    } catch {
      /* counted as 0; the list route reports the failure */
    }

    let staffLeavePending = 0;
    if (scope.kind === "leadership") {
      try {
        const hr = await loadStaffHrServer();
        staffLeavePending = hr.leaveRequests.filter(
          (r) => (r.status === "pending" || r.status === "pending_l2") && r.staffId !== ctx.session.staffId,
        ).length;
      } catch {
        /* 0 */
      }
    }

    return apiOk({
      kind: scope.kind,
      unrestricted: scope.unrestricted,
      staffLeavePending,
      studentLeavePending,
      complaintsOpen,
      documentsPending,
      total: staffLeavePending + studentLeavePending + complaintsOpen + documentsPending,
    });
  } catch (e) {
    return apiErr(e);
  }
}
