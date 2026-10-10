import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { childOfHousehold, requireParentHousehold } from "@/lib/api/v1/household";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import {
  COMPLAINT_CATEGORIES,
  complaintCategoryLabel,
  type ComplaintCategory,
} from "@/lib/complaints";
import { appendServerComplaintTicket } from "@/lib/complaintsServer";
import { householdWhatsApp, loadSis } from "@/lib/sis";
import { leadershipStaffIds } from "@/lib/staffHomeKind.server";
import { resolveClassTeachers } from "@/lib/staffResolve";
import { sendPushToSubjects } from "@/lib/webPush.server";

export const runtime = "nodejs";

type Body = {
  studentId?: string | null;
  category?: string;
  subject?: string;
  description?: string;
};

const CATEGORY_CODES = new Set<string>(COMPLAINT_CATEGORIES.map((c) => c.value));

/**
 * POST /api/v1/complaints/create — a parent raises a complaint from the app.
 *
 * It goes into the same server intake store WhatsApp Flow tickets use, with
 * source "parent_portal", and the office's complaints workspace merges it in
 * on its next load exactly as it does those. The office's copy then carries
 * assignment and status; /list shows the parent whichever copy is newer.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);

    const body = (await request.json().catch(() => ({}))) as Body;
    const studentId = (body.studentId ?? "").trim();
    const category = (body.category ?? "").trim();
    const subject = (body.subject ?? "").trim();
    const description = (body.description ?? "").trim();
    if (!CATEGORY_CODES.has(category)) {
      throw new ApiError("bad_request", "Unknown category", 400);
    }
    if (!subject) throw new ApiError("bad_request", "Subject required", 400);
    if (subject.length > 120) {
      throw new ApiError("bad_request", "Subject is too long (120 characters)", 400);
    }
    if (!description) throw new ApiError("bad_request", "Description required", 400);
    if (description.length > 2000) {
      throw new ApiError("bad_request", "Description is too long (2000 characters)", 400);
    }

    await ensureSchoolMirrorHydrated();
    const sis = loadSis();
    const household = sis.households.find((h) => h.id === householdId);
    if (!household) throw new ApiError("not_found", "Household not found", 404);
    const student = studentId ? childOfHousehold(sis, studentId, householdId) : null;

    const result = await appendServerComplaintTicket({
      householdId,
      studentId: student?.id ?? null,
      raisedByName: ctx.session.fullName || household.guardianName || "Parent",
      raisedByMobile: householdWhatsApp(household) || household.mobile || "",
      category: category as ComplaintCategory,
      subject,
      description,
      source: "parent_portal",
    });
    if (!result.ok) throw new ApiError("bad_request", result.error, 400);

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "complaints",
      action: "edit",
      entityType: "ticket",
      entityId: result.ticket.id,
      summary: `Complaint raised from the app: ${subject} (${complaintCategoryLabel(
        result.ticket.category,
      )})`,
      after: { studentId: student?.id ?? null, category },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    // Leadership always; the child's class teacher too, so a classroom
    // complaint reaches the person who can act on it today. Best-effort.
    try {
      const teachers = student
        ? resolveClassTeachers(
            ctx.masters,
            student.classId,
            student.sectionId,
            student.academicYearCode,
          ).map((t) => t.id)
        : [];
      await sendPushToSubjects(
        "staff",
        [...new Set([...leadershipStaffIds(ctx.masters), ...teachers])],
        {
          title: `New complaint · ${complaintCategoryLabel(result.ticket.category)}`,
          body: `${subject}${student ? ` · ${student.fullName}` : ""}`,
          url: "/complaints",
          data: { kind: "complaint", ticketId: result.ticket.id },
        },
      );
    } catch (e) {
      console.warn("[complaints-v1] staff push failed", (e as Error)?.message);
    }

    return apiOk({
      id: result.ticket.id,
      status: result.ticket.status,
      date: result.ticket.date,
      createdAt: result.ticket.createdAt,
    });
  } catch (e) {
    return apiErr(e);
  }
}
