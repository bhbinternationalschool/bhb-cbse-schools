import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMobileFeature, hasMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import { cleanClassTeacherPatch } from "@/lib/sisClassTeacher";
import { updateHouseholdByClassTeacher } from "@/lib/sisClassTeacher.server";
import { callTargetFor, checkNewWhatsAppNumber, messageTargetFor } from "@/lib/studentContact";
import { loadStudentContact } from "@/lib/studentContact.server";

export const runtime = "nodejs";

function istToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * GET /api/v1/staff/student-contact?studentId=
 *
 * One child's family as the staff app's Call / Message / Change-number
 * actions need it (requests mr_mv9ze8pqksu2, mr_mv9zkoot06df). Any teacher
 * of the child's section may read it — the same people who see the child on
 * the Students roster. A placeholder number (0000000000 …) comes back as
 * no number at all, never as something to dial.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertMobileFeature(ctx, "students_view");
    assertPermission(ctx, "students", "view");
    const studentId = new URL(request.url).searchParams.get("studentId") || "";
    const c = await loadStudentContact(ctx, studentId);
    const h = c.household;
    const call = callTargetFor(h);
    return apiOk({
      studentId: c.student.id,
      studentName: c.student.fullName,
      classLabel: c.classLabel,
      household: h ? { id: h.id, revisionAt: h.revisionAt || "", guardianName: h.guardianName || "" } : null,
      call,
      whatsapp: { number: messageTargetFor(h) },
      // Only the class teacher (or the office / leadership) changes a number.
      canChangeNumber: c.isClassTeacher && !!h,
      // The app chat is the class teacher's (lib/chatAuth.server).
      canChat: c.isClassTeacher,
      canMessage: !!h && hasMobileFeature(ctx, "class_broadcast"),
    });
  } catch (e) {
    return apiErr(e);
  }
}

type PostBody = { studentId?: string; whatsappMobile?: string; revisionAt?: string };

/**
 * POST /api/v1/staff/student-contact — the class teacher adds or changes
 * the family's WhatsApp number from My class.
 *
 * The same write the web's My class makes (PATCH /api/v1/staff/class-
 * students, kind "household"): cleanClassTeacherPatch → a write to that
 * family's row only, refused if someone saved it since `revisionAt` →
 * an audit line under the teacher's name. WhatsApp only; the guardian's
 * mobile and the parents' numbers are untouched (lib/sis setHouseholdWhatsApp).
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertMobileFeature(ctx, "students_view");
    assertPermission(ctx, "students", "view");
    const body = (await request.json().catch(() => ({}))) as PostBody;
    const c = await loadStudentContact(ctx, body.studentId || "");
    if (!c.isClassTeacher) {
      throw new ApiError(
        "forbidden",
        `Only the class teacher of ${c.classLabel || "this class"} can change a family's number — ask them or the office`,
        403,
      );
    }
    const h = c.household;
    if (!h) throw new ApiError("bad_request", "This child has no family record — ask the office", 400);

    const checked = checkNewWhatsAppNumber(body.whatsappMobile || "", h.whatsappMobile || "");
    if (!checked.ok) throw new ApiError("bad_request", checked.error, 400);
    const cleaned = cleanClassTeacherPatch("household", { whatsappMobile: checked.number }, istToday());
    if (!cleaned.ok) throw new ApiError("bad_request", cleaned.error, 400);

    const revisionAt = (body.revisionAt || "").trim() || undefined;
    const result = await updateHouseholdByClassTeacher(h.id, cleaned.values, revisionAt);
    if (!result.ok) {
      throw new ApiError(result.conflict ? "conflict" : "bad_request", result.error, result.conflict ? 409 : 400);
    }
    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "students",
      action: "edit",
      entityType: "household",
      entityId: h.id,
      summary: `Class teacher updated family ${h.id}: whatsappMobile (staff app, for ${c.student.fullName})`,
      before: { whatsappMobile: h.whatsappMobile || "" },
      after: cleaned.values,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return apiOk({ householdId: h.id, whatsappMobile: checked.number, updatedAt: result.updatedAt });
  } catch (e) {
    return apiErr(e);
  }
}
