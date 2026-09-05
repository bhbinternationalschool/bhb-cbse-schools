import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadSis } from "@/lib/sis";
import {
  COMPLAINT_STATUSES,
  complaintCategoryLabel,
  complaintSourceLabel,
  complaintStatusLabel,
} from "@/lib/complaints";
import { listAllComplaintTickets } from "@/lib/complaintsServer";
import { staffSectionScope } from "@/lib/api/v1/staffScope";
import { complaintInScope, OPEN_STATUSES } from "@/lib/api/v1/staffComplaints";

export const runtime = "nodejs";

/**
 * GET /api/v1/staff/complaints?status=open|resolved — parents' complaints
 * this staff member should see: all of them for leadership / office, else
 * those assigned to them or about a child in their sections.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "complaints", "view");
    const url = new URL(request.url);
    const which = url.searchParams.get("status") === "resolved" ? "resolved" : "open";
    const scope = await staffSectionScope(ctx);

    await ensureSchoolMirrorHydrated();
    await ensureSisHydratedServer();
    const tickets = await listAllComplaintTickets();
    if (tickets === null) {
      throw new ApiError("server_error", "Complaints are unavailable right now", 503);
    }
    const sis = loadSis();
    const studentById = new Map(sis.students.map((s) => [s.id, s]));
    const classNameOf = (id: string) =>
      ctx.masters.classes.find((c) => c.id === id)?.name || "";
    const sectionNameOf = (id: string) =>
      ctx.masters.sections.find((s) => s.id === id)?.name || "";
    const staffNameOf = (id: string | null) =>
      id ? ctx.masters.staff.find((s) => s.id === id)?.fullName || "" : "";

    const rows = tickets
      .filter((t) => (which === "open" ? OPEN_STATUSES.has(t.status) : !OPEN_STATUSES.has(t.status)))
      .filter((t) => complaintInScope(ctx, scope, t, studentById))
      .slice(0, which === "open" ? 200 : 60)
      .map((t) => {
        const st = t.studentId ? studentById.get(t.studentId) : undefined;
        return {
          id: t.id,
          studentId: t.studentId,
          studentName: st?.fullName || "",
          classLabel: st ? `${classNameOf(st.classId)} ${sectionNameOf(st.sectionId)}`.trim() : "",
          raisedByName: t.raisedByName,
          raisedByMobile: t.raisedByMobile,
          category: t.category,
          categoryLabel: complaintCategoryLabel(t.category),
          subject: t.subject,
          description: t.description,
          date: t.date,
          status: t.status,
          statusLabel: complaintStatusLabel(t.status),
          source: t.source,
          sourceLabel: complaintSourceLabel(t.source),
          assignedToStaffId: t.assignedToStaffId,
          assignedToName: staffNameOf(t.assignedToStaffId),
          assignedToMe: !!t.assignedToStaffId && t.assignedToStaffId === ctx.session.staffId,
          dueByDate: t.dueByDate,
          resolutionNote: t.resolutionNote,
          resolvedAt: t.resolvedAt,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        };
      });

    return apiOk({
      status: which,
      unrestricted: scope.unrestricted,
      statuses: COMPLAINT_STATUSES,
      tickets: rows,
    });
  } catch (e) {
    return apiErr(e);
  }
}
