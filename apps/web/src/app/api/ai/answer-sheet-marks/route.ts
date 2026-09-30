import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth, type ApiAuthContext } from "@/lib/api/v1/auth";
import { assertSectionScope, scopeAllowsSubjectCode } from "@/lib/api/v1/staffScope";
import { getServerTenantContext } from "@/lib/serverTenant";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadSis } from "@/lib/sis";
import { normalizePaper, type ExamPaper } from "@/lib/examPapers";
import {
  ANSWER_SHEET_MAX_PAGE_B64,
  ANSWER_SHEET_MAX_PAGES,
  ANSWER_SHEET_MAX_QUESTIONS,
  ANSWER_SHEET_MAX_TOTAL_B64,
  answerSheetFactsFromPaper,
  questionHasBasis,
} from "@/lib/answerSheetAi";
import { suggestAnswerSheetMarks } from "@/lib/aiLlm.server";

export const runtime = "nodejs";
/** Up to eight pages through the pro vision model; a minute is common. */
export const maxDuration = 180;

/**
 * Scan a child's written answer sheet → suggested marks per question
 * (2026-09-30).
 *
 * GET  ?classId&sectionId&subjectCode[&termId] — the papers a scan can be
 *      marked against, with how many of their questions carry a key.
 * POST { paperId, setCode?, studentId, classId, sectionId, subjectCode,
 *        pages: [{ imageBase64, mimeType }] } — the suggestion.
 *
 * Both answer only to the teacher who may enter that subject's marks for
 * that section — the same scope as /api/v1/staff/exams/marks, since a
 * suggestion is the first half of a mark entry. The paper and its key are
 * read here, from the server's copy: a key carried in by the browser could
 * be anything. Nothing is saved; the teacher's confirmed total goes through
 * the marks grid's own Save.
 */

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

async function authorise(
  request: Request,
  classId: string,
  sectionId: string,
  subjectCode: string,
): Promise<ApiAuthContext> {
  const ctx = await resolveApiAuth(request);
  if (ctx.session.persona !== "staff") {
    throw new ApiError("forbidden", "Staff session required", 403);
  }
  assertPermission(ctx, "exams", "edit");
  if (!classId || !sectionId || !subjectCode) {
    throw new ApiError("bad_request", "classId, sectionId, subjectCode required", 400);
  }
  const scope = await assertSectionScope(ctx, classId, sectionId);
  if (!scopeAllowsSubjectCode(scope, classId, sectionId, subjectCode)) {
    throw new ApiError(
      "forbidden",
      `${subjectCode} is not one of your subjects in this class — ask the office to add it (Staff → Duties)`,
      403,
    );
  }
  return ctx;
}

/**
 * The papers slice only — the bank and blueprints are not needed and the
 * bank is the larger of the three. A failed read is an error, never "no
 * papers": a teacher told there is no paper would mark by hand for nothing.
 */
async function loadPapers(): Promise<ExamPaper[]> {
  const tenant = await getServerTenantContext();
  if (!tenant) throw new ApiError("server_error", "Tenant not configured", 503);
  const { data, error } = await tenant.sb
    .from("exam_papers_desk_slices")
    .select("payload")
    .eq("tenant_id", tenant.tenantId)
    .eq("slice_key", "papers")
    .maybeSingle();
  if (error) {
    console.warn("[answer-sheet-marks] papers read failed", error.message);
    throw new ApiError("server_error", "Could not read the question papers — try again", 503);
  }
  const rows = Array.isArray((data as { payload?: unknown } | null)?.payload)
    ? ((data as { payload: unknown[] }).payload as Partial<ExamPaper>[])
    : [];
  return rows.map((p) => normalizePaper(p)).filter((p): p is ExamPaper => !!p);
}

function subjectCodeOf(ctx: ApiAuthContext, subjectId: string): string {
  return (ctx.masters.subjects.find((s) => s.id === subjectId)?.code || "").trim().toUpperCase();
}

function papersFor(ctx: ApiAuthContext, papers: ExamPaper[], classId: string, subjectCode: string): ExamPaper[] {
  const want = subjectCode.trim().toUpperCase();
  return papers.filter(
    (p) => p.status !== "archived" && p.classId === classId && subjectCodeOf(ctx, p.subjectId) === want,
  );
}

function labelsFor(ctx: ApiAuthContext, paper: ExamPaper) {
  const subject = ctx.masters.subjects.find((s) => s.id === paper.subjectId);
  const cls = ctx.masters.classes.find((c) => c.id === paper.classId);
  return {
    subjectLabel: subject?.nameEn || subject?.code || "",
    classLabel: cls?.name || "",
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const classId = (url.searchParams.get("classId") || "").trim();
    const sectionId = (url.searchParams.get("sectionId") || "").trim();
    const subjectCode = (url.searchParams.get("subjectCode") || "").trim();
    const termId = (url.searchParams.get("termId") || "").trim();
    const ctx = await authorise(request, classId, sectionId, subjectCode);

    const papers = papersFor(ctx, await loadPapers(), classId, subjectCode)
      .map((p) => ({
        id: p.id,
        paperCode: p.paperCode,
        title: p.title,
        examName: p.examName,
        examTermId: p.examTermId,
        termMatch: !!termId && p.examTermId === termId,
        maxMarks: p.maxMarks,
        activeSetCode: p.activeSetCode,
        updatedAt: p.updatedAt,
        sets: p.sets.map((s) => {
          const facts = answerSheetFactsFromPaper(p, s.setCode, labelsFor(ctx, p));
          return {
            setCode: s.setCode,
            label: s.source?.publisherLabel || s.label,
            questionCount: facts?.questions.length ?? 0,
            keyedCount: facts?.questions.filter(questionHasBasis).length ?? 0,
            maxTotal: facts?.maxTotal ?? 0,
          };
        }),
      }))
      // This exam's paper first, then the most recently touched.
      .sort((a, b) => Number(b.termMatch) - Number(a.termMatch) || b.updatedAt.localeCompare(a.updatedAt));

    return apiOk({ papers });
  } catch (e) {
    return apiErr(e);
  }
}

type Body = {
  paperId?: string;
  setCode?: string;
  studentId?: string;
  classId?: string;
  sectionId?: string;
  subjectCode?: string;
  pages?: { imageBase64?: string; mimeType?: string }[];
};

export async function POST(request: Request) {
  try {
    // Refuse an oversized upload before reading it into memory.
    const length = Number(request.headers.get("content-length") || 0);
    if (length > ANSWER_SHEET_MAX_TOTAL_B64 + 200_000) {
      throw new ApiError("bad_request", "The photos are too large — retake them, or send fewer pages", 413);
    }
    const body = (await request.json().catch(() => ({}))) as Body;
    const classId = (body.classId || "").trim();
    const sectionId = (body.sectionId || "").trim();
    const subjectCode = (body.subjectCode || "").trim();
    const studentId = (body.studentId || "").trim();
    const paperId = (body.paperId || "").trim();
    const ctx = await authorise(request, classId, sectionId, subjectCode);
    if (!studentId || !paperId) throw new ApiError("bad_request", "studentId and paperId required", 400);

    const rawPages = Array.isArray(body.pages) ? body.pages : [];
    if (!rawPages.length) throw new ApiError("bad_request", "Add at least one photo of the answer sheet", 400);
    if (rawPages.length > ANSWER_SHEET_MAX_PAGES) {
      throw new ApiError("bad_request", `At most ${ANSWER_SHEET_MAX_PAGES} pages per scan`, 400);
    }
    let total = 0;
    const pages = rawPages.map((p, i) => {
      const mimeType = (p?.mimeType || "").trim().toLowerCase();
      const base64 = (p?.imageBase64 || "").trim().replace(/^data:[^;]+;base64,/, "");
      if (!IMAGE_TYPES.has(mimeType)) throw new ApiError("bad_request", `Page ${i + 1} is not a photo`, 400);
      if (!base64 || !/^[A-Za-z0-9+/=\s]+$/.test(base64)) {
        throw new ApiError("bad_request", `Page ${i + 1} is empty or damaged`, 400);
      }
      if (base64.length > ANSWER_SHEET_MAX_PAGE_B64) {
        throw new ApiError("bad_request", `Page ${i + 1} is too large — retake it`, 413);
      }
      total += base64.length;
      return { base64, mimeType };
    });
    if (total > ANSWER_SHEET_MAX_TOTAL_B64) {
      throw new ApiError("bad_request", "The photos are too large together — send fewer pages", 413);
    }

    // The child must be in the section the teacher was cleared for; the
    // scope check alone would let any student id ride along.
    await ensureSchoolMirrorHydrated();
    await ensureSisHydratedServer();
    const student = loadSis().students.find((s) => s.id === studentId);
    if (!student || student.classId !== classId || student.sectionId !== sectionId) {
      throw new ApiError("forbidden", "That student is not in this class and section", 403);
    }

    const paper = papersFor(ctx, await loadPapers(), classId, subjectCode).find((p) => p.id === paperId);
    if (!paper) throw new ApiError("not_found", "That question paper is not one for this class and subject", 404);
    const setCode = (body.setCode || paper.activeSetCode || "").trim().toUpperCase();
    const facts = answerSheetFactsFromPaper(paper, setCode, labelsFor(ctx, paper));
    if (!facts) throw new ApiError("bad_request", `Set ${setCode || "?"} of this paper has no questions with marks`, 400);
    if (facts.questions.length > ANSWER_SHEET_MAX_QUESTIONS) {
      throw new ApiError("bad_request", "This paper has too many questions to scan in one go — mark it by hand", 400);
    }

    const r = await suggestAnswerSheetMarks({
      facts,
      pages,
      requester: ctx.session.email || ctx.session.fullName || "staff",
    });
    if (!r.ok) {
      if (r.failure === "budget") throw new ApiError("forbidden", r.error, 429);
      if (r.failure === "not-configured") throw new ApiError("server_error", "Answer-sheet reading is not set up on the server", 503);
      console.warn("[answer-sheet-marks] read failed", r.error);
      throw new ApiError("server_error", "The answer sheet could not be read — try again, or mark by hand", 502);
    }

    const byId = new Map(facts.questions.map((q) => [q.id, q]));
    return apiOk({
      generationId: r.generationId,
      paperId: paper.id,
      setCode: facts.setCode,
      maxTotal: r.result.maxTotal,
      totalSuggested: r.result.totalSuggested,
      unknownCount: r.result.unknownCount,
      questions: r.result.questions.map((s) => {
        const q = byId.get(s.questionId);
        return {
          ...s,
          text: q?.text ?? "",
          type: q?.type ?? "short",
          hasKey: q ? questionHasBasis(q) : false,
        };
      }),
    });
  } catch (e) {
    return apiErr(e);
  }
}
