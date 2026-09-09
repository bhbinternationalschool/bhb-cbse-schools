import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadSis } from "@/lib/sis";
import { getSession } from "@/lib/onlineClasses.server";
import { listAnswers, listQuestions } from "@/lib/onlineClassQa.server";

export const runtime = "nodejs";

/**
 * GET /api/v1/parent/online-classes/questions?sessionId=&studentId= — the
 * teacher's questions for this class with the child's own answer and mark.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId")?.trim() || "";
    const studentId = url.searchParams.get("studentId")?.trim() || "";
    if (!sessionId || !studentId) throw new ApiError("bad_request", "sessionId and studentId required", 400);

    await ensureSchoolMirrorHydrated();
    await ensureSisHydratedServer();
    const student = loadSis().students.find((s) => s.id === studentId);
    if (!student) throw new ApiError("not_found", "Student not found", 404);
    if (ctx.session.persona === "parent") {
      if (ctx.session.householdId && student.householdId !== ctx.session.householdId) {
        throw new ApiError("forbidden", "Not your child", 403);
      }
    } else {
      assertPermission(ctx, "online_classes", "view");
    }
    const s = await getSession(sessionId);
    if (!s || s.sectionId !== student.sectionId) throw new ApiError("not_found", "Class not found", 404);

    const [questions, answers] = await Promise.all([listQuestions(s.id), listAnswers(s.id)]);
    const mine = new Map(answers.filter((a) => a.studentId === studentId).map((a) => [a.questionId, a]));
    return apiOk({
      sessionId: s.id,
      status: s.status,
      questions: questions.map((q) => {
        const a = mine.get(q.id);
        return {
          id: q.id,
          orderNo: q.orderNo,
          text: q.text,
          askedAt: q.askedAt,
          closed: !!q.closedAt || s.status === "ended" || s.status === "cancelled",
          answer: a
            ? {
                id: a.id,
                submittedAt: a.submittedAt,
                verdict: a.verdict,
                photoUrl: a.photoPath ? `/api/v1/online-classes/answer-photo/${a.id}` : "",
              }
            : null,
        };
      }),
    });
  } catch (e) {
    return apiErr(e);
  }
}
