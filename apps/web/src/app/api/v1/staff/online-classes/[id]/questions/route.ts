import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { assertSectionScope } from "@/lib/api/v1/staffScope";
import { getSession } from "@/lib/onlineClasses.server";
import { readQuestionText, readVerdict } from "@/lib/onlineClassQa";
import {
  answerWall,
  askQuestion,
  closeQuestion,
  getAnswer,
  listQuestions,
  setVerdict,
} from "@/lib/onlineClassQa.server";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

async function load(request: Request, params: Params["params"], action: "view" | "edit") {
  const ctx = await resolveApiAuth(request);
  if (ctx.session.persona !== "staff") {
    throw new ApiError("forbidden", "Staff session required", 403);
  }
  assertPermission(ctx, "online_classes", action);
  await ensureSchoolMirrorHydrated();
  const { id } = await params;
  const s = await getSession(id);
  if (!s) throw new ApiError("not_found", "Class not found", 404);
  await assertSectionScope(ctx, s.classId, s.sectionId);
  return { ctx, s };
}

/** GET — every question with its answers by name, and who has not answered. */
export async function GET(request: Request, { params }: Params) {
  try {
    const { s } = await load(request, params, "view");
    const wall = await answerWall(s);
    return apiOk({
      sessionId: s.id,
      status: s.status,
      rosterCount: wall.rosterCount,
      questions: wall.questions.map((q) => ({
        ...q,
        answers: q.answers.map((a) => ({
          id: a.id,
          studentId: a.studentId,
          fullName: a.fullName,
          rollNo: a.rollNo,
          submittedAt: a.submittedAt,
          text: a.text,
          verdict: a.verdict,
          verdictBy: a.verdictBy,
          photoUrl: a.photoPath ? `/api/v1/online-classes/answer-photo/${a.id}` : "",
        })),
      })),
    });
  } catch (e) {
    return apiErr(e);
  }
}

/** POST { text } — ask; pushes to the section's phones. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { ctx, s } = await load(request, params, "edit");
    if (s.status === "cancelled" || s.status === "ended") {
      throw new ApiError("bad_request", "The class is over — questions go out during a class", 400);
    }
    const body = (await request.json().catch(() => ({}))) as { text?: unknown };
    const text = readQuestionText(body.text);
    if (!text) throw new ApiError("bad_request", "Type the question (2–600 characters)", 400);
    const r = await askQuestion(s, text, ctx.session.fullName || ctx.session.email || "");
    if (!r.ok) throw new ApiError("bad_request", r.error, 400);
    return apiOk(r.value);
  } catch (e) {
    return apiErr(e);
  }
}

/** PATCH { answerId, verdict } to mark, or { questionId, closed } to stop answers. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { ctx, s } = await load(request, params, "edit");
    const body = (await request.json().catch(() => ({}))) as {
      answerId?: unknown; verdict?: unknown; questionId?: unknown; closed?: unknown;
    };
    if (body.answerId !== undefined) {
      const a = await getAnswer(String(body.answerId));
      if (!a || a.sessionId !== s.id) throw new ApiError("not_found", "Answer not found", 404);
      const verdict = readVerdict(body.verdict);
      if (verdict === null) throw new ApiError("bad_request", "verdict must be right, wrong, partial or empty", 400);
      const q = (await listQuestions(s.id)).find((x) => x.id === a.questionId);
      const ok = await setVerdict(a, verdict, ctx.session.fullName || "", q?.text || "");
      if (!ok) throw new ApiError("bad_request", "Could not save the mark", 400);
      return apiOk({ answerId: a.id, verdict });
    }
    if (body.questionId !== undefined) {
      const q = (await listQuestions(s.id)).find((x) => x.id === String(body.questionId));
      if (!q) throw new ApiError("not_found", "Question not found", 404);
      const ok = await closeQuestion(q.id, body.closed !== false);
      if (!ok) throw new ApiError("bad_request", "Could not update the question", 400);
      return apiOk({ questionId: q.id, closed: body.closed !== false });
    }
    throw new ApiError("bad_request", "answerId or questionId required", 400);
  } catch (e) {
    return apiErr(e);
  }
}
