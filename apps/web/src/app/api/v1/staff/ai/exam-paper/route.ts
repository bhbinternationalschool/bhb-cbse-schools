import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import {
  assertAiClassSubject,
  compactSection,
  loadClassSubjectUnits,
  pickUnits,
  unitFactsOf,
} from "@/lib/api/v1/staffAi.server";
import { cleanUnitFacts, suggestExamPaperDraftLlm } from "@/lib/examPaperAiLlm.server";
import { suggestExamPaperDraft } from "@/lib/examPaperAi";
import type { ExamPaperHardness } from "@/lib/examPapers";

export const runtime = "nodejs";
/** The pro tier writing a whole paper; the app waits up to two minutes. */
export const maxDuration = 120;

type Body = {
  classId?: string;
  subjectId?: string;
  hardness?: string;
  maxMarks?: number;
  /** Chapters / topics of the class + subject's Teaching plan. */
  unitIds?: unknown;
};

const HARDNESS = new Set<ExamPaperHardness>(["easy", "medium", "hard", "mixed"]);

/**
 * POST /api/v1/staff/ai/exam-paper — the staff app's "Question paper" tool.
 * The same draft as the web Exam papers editor's AI fill (/api/ai/exam-paper
 * mode "draft"): exams.edit, the pro-tier generator, competency codes and
 * unit ids allow-listed to the chapters given, and the built-in offline
 * draft when the model is unavailable (said so: `source: "local"`).
 *
 * Unlike the web route, the chapters arrive as ids and are read from the
 * Teaching plan here, and the teacher must teach the subject in the class.
 * Nothing is saved — the phone shows, copies and shares the draft.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "exams", "edit");
    const body = (await request.json().catch(() => ({}))) as Body;
    const classId = String(body.classId || "").trim();
    const subjectId = String(body.subjectId || "").trim();
    await ensureSchoolMirrorHydrated();
    await assertAiClassSubject(ctx, classId, subjectId);

    const hardness: ExamPaperHardness = HARDNESS.has(body.hardness as ExamPaperHardness)
      ? (body.hardness as ExamPaperHardness)
      : "mixed";
    const maxMarks =
      typeof body.maxMarks === "number" && body.maxMarks > 0 ? Math.min(100, Math.round(body.maxMarks)) : 50;
    const { units: all } = await loadClassSubjectUnits(ctx, classId, subjectId);
    const units = cleanUnitFacts(unitFactsOf(pickUnits(all, body.unitIds)));

    const llm = await suggestExamPaperDraftLlm({
      masters: ctx.masters,
      classId,
      subjectId,
      hardness,
      maxMarks,
      units,
    });
    if (llm.ok) {
      return apiOk({
        source: "llm",
        engine: llm.engine,
        generationId: llm.generationId,
        explanation: llm.explanation,
        maxMarks,
        sections: llm.sections.map(compactSection),
      });
    }
    if (/daily AI|budget/i.test(llm.error)) throw new ApiError("forbidden", llm.error, 429);

    const local = suggestExamPaperDraft({ masters: ctx.masters, classId, subjectId, hardness, maxMarks });
    return apiOk({
      source: "local",
      engine: "local",
      generationId: "",
      explanation: [...local.explanation, `AI was unavailable (${llm.error.slice(0, 120)}) — this is the built-in offline draft.`],
      maxMarks,
      sections: local.sections.map(compactSection),
    });
  } catch (e) {
    return apiErr(e);
  }
}
