import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import { composeStudentMessage, maskMobile, messageTargetFor } from "@/lib/studentContact";
import { loadStudentContact, sendStudentNotice } from "@/lib/studentContact.server";

export const runtime = "nodejs";

type Body = { studentId?: string; text?: string; dryRun?: boolean };

/**
 * POST /api/v1/staff/student-contact/message
 * { studentId, text, dryRun? } — a teacher's WhatsApp to ONE family of a
 * section they teach, from the school's number.
 *
 * `dryRun` defaults to TRUE: the app first shows the exact message the
 * family will read and sends only when the teacher presses Send (requests
 * mr_mv9ze8pqksu2, mr_mv9zkoot06df: never send on tap). The permission is
 * "Message my classes" (class_broadcast) — the same teacher may already
 * message the whole section; this is one family of it.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertMobileFeature(ctx, "class_broadcast");
    assertPermission(ctx, "students", "view");
    const body = (await request.json().catch(() => ({}))) as Body;
    const dryRun = body.dryRun !== false;
    const c = await loadStudentContact(ctx, body.studentId || "");
    const h = c.household;
    if (!h) throw new ApiError("bad_request", "This child has no family record — ask the office", 400);
    const mobile = messageTargetFor(h);
    if (!mobile) {
      throw new ApiError(
        "bad_request",
        "No WhatsApp number on record for this family" + (c.isClassTeacher ? " — add it from My class" : " — ask the class teacher or the office"),
        400,
      );
    }
    const composed = composeStudentMessage({
      teacherName: ctx.session.fullName || "",
      classLabel: c.classLabel,
      childName: c.student.fullName,
      text: body.text || "",
    });
    if (!composed.ok) throw new ApiError("bad_request", composed.error, 400);

    const r = await sendStudentNotice({ household: h, mobile, title: composed.title, body: composed.body, dryRun });
    if (r.kind === "preview") {
      return apiOk({ sent: false, dryRun: true, to: maskMobile(mobile), language: r.language, preview: r.preview });
    }
    if (!dryRun) {
      const meta = requestMeta(request);
      await writeAudit({
        session: ctx.session,
        module: "notifications",
        action: "create",
        entityType: "wa_staff_send",
        entityId: h.id,
        summary:
          r.kind === "sent"
            ? `Sent a WhatsApp about ${c.student.fullName} (${c.classLabel}) to ${h.guardianName || "the family"} from the school's number`
            : `Held a WhatsApp about ${c.student.fullName}: ${r.reason}`,
        after: { studentId: c.student.id, text: composed.body.slice(0, 500) },
        ip: meta.ip,
        userAgent: meta.userAgent,
      }).catch(() => undefined);
    }
    if (r.kind === "held") return apiOk({ sent: false, dryRun: false, held: true, reason: r.reason });
    return apiOk({ sent: true, dryRun: false, to: maskMobile(mobile), language: r.language });
  } catch (e) {
    return apiErr(e);
  }
}
