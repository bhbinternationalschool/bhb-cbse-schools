import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { requireParentHousehold } from "@/lib/api/v1/household";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import {
  COMPLAINT_CATEGORIES,
  complaintCategoryLabel,
  complaintStatusLabel,
} from "@/lib/complaints";
import { listHouseholdComplaintTickets } from "@/lib/complaintsServer";
import { loadSis } from "@/lib/sis";

export const runtime = "nodejs";

/**
 * GET /api/v1/complaints/list — the household's complaint tickets, newest
 * first, with the category catalogue. Tickets come from both the office's
 * triaged copy and the server intake store (see listHouseholdComplaintTickets);
 * a read failure is a 503, never an empty list.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);

    await ensureSchoolMirrorHydrated();
    const tickets = await listHouseholdComplaintTickets(householdId);
    if (tickets === null) {
      throw new ApiError("server_error", "Complaints are unavailable right now", 503);
    }

    const sis = loadSis();
    const nameOf = new Map(sis.students.map((s) => [s.id, s.fullName]));

    return apiOk({
      tickets: tickets.map((t) => ({
        id: t.id,
        studentId: t.studentId,
        studentName: t.studentId ? nameOf.get(t.studentId) ?? "" : "",
        category: t.category,
        categoryLabel: complaintCategoryLabel(t.category),
        subject: t.subject,
        description: t.description,
        date: t.date,
        status: t.status,
        statusLabel: complaintStatusLabel(t.status),
        resolutionNote: t.resolutionNote,
        resolvedAt: t.resolvedAt,
        createdAt: t.createdAt,
      })),
      categories: COMPLAINT_CATEGORIES,
    });
  } catch (e) {
    return apiErr(e);
  }
}
