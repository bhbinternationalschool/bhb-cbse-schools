import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadSis } from "@/lib/sis";
import { imageDimensions, sniffKind } from "@/lib/uploadValidation";
import { getSession } from "@/lib/onlineClasses.server";
import { listQuestions, submitAnswer } from "@/lib/onlineClassQa.server";

export const runtime = "nodejs";

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * POST multipart { sessionId, questionId, studentId, file } — a child's
 * photographed answer. The bytes are sniffed (a renamed PDF is not a
 * photo), size-capped, and stored privately; the teacher's wall updates
 * on its next refresh.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "parent") {
      throw new ApiError("forbidden", "Parent session required", 403);
    }
    const form = await request.formData().catch(() => null);
    if (!form) throw new ApiError("bad_request", "Expected a multipart form", 400);
    const sessionId = String(form.get("sessionId") ?? "").trim();
    const questionId = String(form.get("questionId") ?? "").trim();
    const studentId = String(form.get("studentId") ?? "").trim();
    const file = form.get("file");
    if (!sessionId || !questionId || !studentId || !(file instanceof File)) {
      throw new ApiError("bad_request", "sessionId, questionId, studentId and file required", 400);
    }
    if (file.size > MAX_BYTES) throw new ApiError("bad_request", "The photo is too large (8 MB max)", 400);

    await ensureSchoolMirrorHydrated();
    await ensureSisHydratedServer();
    const student = loadSis().students.find((s) => s.id === studentId);
    if (!student) throw new ApiError("not_found", "Student not found", 404);
    if (ctx.session.householdId && student.householdId !== ctx.session.householdId) {
      throw new ApiError("forbidden", "Not your child", 403);
    }
    const s = await getSession(sessionId);
    if (!s || s.sectionId !== student.sectionId) throw new ApiError("not_found", "Class not found", 404);
    if (s.status === "cancelled") throw new ApiError("bad_request", "This class was cancelled", 400);
    const q = (await listQuestions(s.id)).find((x) => x.id === questionId);
    if (!q) throw new ApiError("not_found", "Question not found", 404);
    if (q.closedAt || s.status === "ended") {
      throw new ApiError("conflict", "The teacher has closed this question", 409, { reason: "closed" });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = sniffKind(bytes);
    if (kind !== "jpg" && kind !== "png" && kind !== "webp") {
      throw new ApiError("bad_request", "Send a photo (JPG, PNG or WebP)", 400);
    }
    const dims = imageDimensions(bytes);
    if (dims && Math.min(dims.width, dims.height) < 200) {
      throw new ApiError("bad_request", "That photo is too small to read", 400);
    }
    const mime = kind === "png" ? "image/png" : kind === "webp" ? "image/webp" : "image/jpeg";
    const r = await submitAnswer({
      session: s, question: q, studentId, householdId: student.householdId || "",
      bytes, mime, text: String(form.get("text") ?? ""),
    });
    if (!r.ok) throw new ApiError("bad_request", r.error, 400);
    return apiOk({
      answerId: r.value.id,
      submittedAt: r.value.submittedAt,
      photoUrl: `/api/v1/online-classes/answer-photo/${r.value.id}`,
    });
  } catch (e) {
    return apiErr(e);
  }
}
