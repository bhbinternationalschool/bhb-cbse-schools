import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth, type ApiAuthContext } from "@/lib/api/v1/auth";
import { staffSectionScope, type StaffScope } from "@/lib/api/v1/staffScope";
import {
  addQuestions,
  classBooks,
  gameNow,
  listQuestions,
  poolCounts,
  questionsFromPapers,
  reviewQuestion,
} from "@/lib/learningGames.server";
import { checkQuestionDraft, gameGrade } from "@/lib/learningGames";
import { GAME_QUESTIONS_PER_DRAFT } from "@/lib/learningGamesAi";
import { subjectDisplayName } from "@/lib/tutorSyllabus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// An AI draft of ten questions can take a while on a thinking model.
export const maxDuration = 60;

/**
 * The question pool for one class (its grade), for teachers of that class
 * and the office.
 *
 * GET  ?classId=&review=pending|approved|rejected&subjectKey=
 *      → { grade, books (the class's own books and chapters), counts, questions }
 * POST { op: "add", classId, subjectKey, textbookId?, chapterPosition?, prompt, options, answerIndex }
 *        a teacher's own question — approved as written (the teacher is the reviewer).
 *      { op: "import_papers", classId }
 *        the publisher-keyed multiple-choice questions of the class's imported
 *        papers; approved by source (the publisher's own key), rejectable one by one.
 *      { op: "generate", classId, textbookId, chapterPosition }
 *        ten AI drafts from that chapter's name and topics — saved PENDING;
 *        no child sees one until a teacher approves it.
 *      { op: "review", id, review: "approved" | "rejected" }
 */

function assertClass(ctx: ApiAuthContext, scope: StaffScope, classId: string): { grade: number; className: string } {
  const cls = ctx.masters.classes.find((c) => c.id === classId);
  if (!cls) throw new ApiError("bad_request", "Pick a class.", 400);
  if (!scope.unrestricted && !scope.teaching.some((t) => t.classId === classId)) {
    throw new ApiError("forbidden", `You do not teach ${cls.name}.`, 403);
  }
  const grade = gameGrade(cls.name);
  if (grade === null) throw new ApiError("bad_request", `Could not tell the level of "${cls.name}".`, 400);
  return { grade, className: cls.name };
}

export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const scope = await staffSectionScope(ctx);
    const url = new URL(request.url);
    const { grade, className } = assertClass(ctx, scope, url.searchParams.get("classId") ?? "");
    const review = url.searchParams.get("review") ?? "";
    const subjectKey = url.searchParams.get("subjectKey") ?? "";
    const [books, counts, questions] = await Promise.all([
      classBooks(grade),
      poolCounts(grade),
      listQuestions(grade, {
        review: ["pending", "approved", "rejected"].includes(review) ? review : undefined,
        subjectKey: subjectKey || undefined,
      }),
    ]);
    return apiOk({ grade, className, books, counts, questions });
  } catch (e) {
    return apiErr(e);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const scope = await staffSectionScope(ctx);
    const nowMs = gameNow(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const by = ctx.session.fullName || ctx.session.email || "staff";

    if (body.op === "review") {
      const review = body.review === "approved" ? "approved" : body.review === "rejected" ? "rejected" : null;
      if (!review) throw new ApiError("bad_request", "review must be approved or rejected", 400);
      const myGrades = new Set(
        scope.teaching.map((t) => gameGrade(t.className)).filter((g): g is number => g !== null),
      );
      await reviewQuestion(String(body.id ?? ""), review, by, nowMs, (g) => scope.unrestricted || myGrades.has(g));
      return apiOk({ reviewed: true });
    }

    const classId = String(body.classId ?? "");
    const { grade, className } = assertClass(ctx, scope, classId);
    const books = await classBooks(grade);
    const chapterOf = (textbookId: string, position: number | null) => {
      if (!textbookId || position === null) return null;
      const b = books.find((x) => x.textbookId === textbookId);
      const c = b?.chapters.find((x) => x.position === position);
      return b && c ? { book: b, chapter: c } : null;
    };
    const position = body.chapterPosition === undefined || body.chapterPosition === null || body.chapterPosition === "" ? null : Math.round(Number(body.chapterPosition));

    if (body.op === "add") {
      const subjectKey = String(body.subjectKey ?? "").slice(0, 30);
      if (!subjectKey) throw new ApiError("bad_request", "Choose a subject.", 400);
      const checked = checkQuestionDraft({
        prompt: String(body.prompt ?? ""),
        options: Array.isArray(body.options) ? body.options.map(String) : [],
        answerIndex: Number(body.answerIndex),
      });
      if (!checked.ok) throw new ApiError("bad_request", `This question cannot be used: ${checked.reason}.`, 400);
      const textbookId = String(body.textbookId ?? "");
      const found = chapterOf(textbookId, position);
      if (textbookId && !found) throw new ApiError("bad_request", "That chapter is not in this class's books.", 400);
      const r = await addQuestions(
        [
          {
            grade,
            classId,
            subjectKey,
            textbookId: found ? textbookId : "",
            chapterPosition: found ? position : null,
            chapterName: found?.chapter.name ?? "",
            lang: /[ऀ-ॿ]/.test(checked.q.prompt) ? "hi" : "en",
            q: checked.q,
            source: "teacher",
            sourceRef: "",
            review: "approved",
            reviewedBy: by,
          },
        ],
        by,
        nowMs,
      );
      return apiOk(r);
    }

    if (body.op === "import_papers") {
      const found = await questionsFromPapers(ctx, classId);
      const r = await addQuestions(
        found.accepted.map((a) => ({
          grade,
          classId,
          subjectKey: a.subjectKey,
          textbookId: "",
          chapterPosition: null,
          chapterName: "",
          lang: a.lang,
          q: a.q,
          source: "publisher_key" as const,
          sourceRef: a.sourceRef,
          review: "approved" as const,
          reviewedBy: "Publisher's answer key",
        })),
        by,
        nowMs,
      );
      return apiOk({ papers: found.papers, usable: found.accepted.length, added: r.added, skipped: found.skipped });
    }

    if (body.op === "generate") {
      const found = chapterOf(String(body.textbookId ?? ""), position);
      if (!found) throw new ApiError("bad_request", "Pick a chapter of this class's books.", 400);
      const lang = found.book.subjectKey === "hindi" || found.book.subjectKey === "sanskrit" ? "hi" : "en";
      const { generateGameQuestionsJson } = await import("@/lib/aiLlm.server");
      const r = await generateGameQuestionsJson({
        facts: {
          className,
          grade,
          subjectLabel: subjectDisplayName(found.book.subjectKey),
          bookName: found.book.name,
          chapterName: found.chapter.name,
          topics: found.chapter.topics,
          lang,
          count: GAME_QUESTIONS_PER_DRAFT,
        },
        requester: ctx.session.staffId ? `staff:${ctx.session.staffId}` : undefined,
      });
      if (!r.ok) throw new ApiError("server_error", `The AI could not draft questions just now (${r.error}).`, 503);
      const saved = await addQuestions(
        r.drafts.map((q, i) => ({
          grade,
          classId,
          subjectKey: found.book.subjectKey,
          textbookId: found.book.textbookId,
          chapterPosition: found.chapter.position,
          chapterName: found.chapter.name,
          lang,
          q,
          source: "ai" as const,
          sourceRef: `${r.generationId}:${i}`,
          review: "pending" as const,
          reviewedBy: "",
        })),
        by,
        nowMs,
      );
      return apiOk({ drafted: r.drafts.length, added: saved.added, generationId: r.generationId });
    }

    throw new ApiError("bad_request", "op must be add, import_papers, generate or review", 400);
  } catch (e) {
    return apiErr(e);
  }
}
