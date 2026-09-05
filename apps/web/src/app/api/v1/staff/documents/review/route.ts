import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadSis, type StudentDocKey } from "@/lib/sis";
import { updateStudentDocsInDb } from "@/lib/sisProfile.server";
import { scopeAllows, staffSectionScope } from "@/lib/api/v1/staffScope";
import { sendPushToSubject } from "@/lib/webPush.server";
import { DOC_LABELS } from "@/lib/api/v1/studentDocs";

export const runtime = "nodejs";

type Body = { studentId?: string; key?: string; verdict?: "verified" | "rejected"; note?: string };

/**
 * POST /api/v1/staff/documents/review — class teacher / office verifies or
 * rejects one parent-uploaded document. The parent's app shows the result
 * on the child's profile and gets a push.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "students", "approve");
    const body = (await request.json().catch(() => ({}))) as Body;
    const studentId = (body.studentId || "").trim();
    const key = (body.key || "").trim() as StudentDocKey;
    const verdict = body.verdict === "rejected" ? "rejected" : body.verdict === "verified" ? "verified" : "";
    const note = (body.note || "").trim().slice(0, 300);
    if (!studentId || !key) throw new ApiError("bad_request", "studentId and key required", 400);
    if (!verdict) throw new ApiError("bad_request", "verdict must be verified or rejected", 400);
    if (!(key in DOC_LABELS)) throw new ApiError("bad_request", "Unknown document", 400);
    if (verdict === "rejected" && !note) {
      throw new ApiError("bad_request", "Say why it was rejected so the parent can fix it", 400);
    }

    const scope = await staffSectionScope(ctx);
    await ensureSchoolMirrorHydrated();
    await ensureSisHydratedServer();
    const sis = loadSis();
    const student = sis.students.find((s) => s.id === studentId);
    if (!student) throw new ApiError("not_found", "Student not found", 404);
    if (!scopeAllows(scope, student.classId, student.sectionId)) {
      throw new ApiError("forbidden", "Not a student of your class", 403);
    }
    const doc = student.docs?.[key];
    if (!doc || doc.status === "missing") {
      throw new ApiError("bad_request", "Nothing has been uploaded for this document", 400);
    }

    const now = new Date().toISOString();
    const docs = {
      ...student.docs,
      [key]: {
        ...doc,
        status: verdict,
        reviewedBy: ctx.session.fullName || "Teacher",
        reviewedAt: now,
        reviewNote: note,
      },
    };
    const written = await updateStudentDocsInDb(student.id, docs);
    if (!written.ok) {
      console.warn("[staff-docs-v1] write failed", written.error);
      throw new ApiError("server_error", "Could not save — try again", 503);
    }

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "students",
      action: "approve",
      entityType: "student_document",
      entityId: `${student.id}:${key}`,
      summary: `${DOC_LABELS[key]} ${verdict} for ${student.fullName}${note ? ` — ${note}` : ""}`,
      after: { key, verdict, note },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    if (student.householdId) {
      await sendPushToSubject("parent", student.householdId, {
        title:
          verdict === "verified"
            ? `${DOC_LABELS[key]} verified`
            : `${DOC_LABELS[key]} needs another upload`,
        body:
          verdict === "verified"
            ? `${student.fullName}'s ${DOC_LABELS[key].toLowerCase()} has been checked and accepted.`
            : `${student.fullName}: ${note}`,
        url: `/profile?studentId=${encodeURIComponent(student.id)}`,
        data: { kind: "document_review", studentId: student.id, key, verdict },
      }).catch(() => undefined);
    }

    return apiOk({ studentId: student.id, key, status: verdict, reviewedAt: now });
  } catch (e) {
    return apiErr(e);
  }
}
