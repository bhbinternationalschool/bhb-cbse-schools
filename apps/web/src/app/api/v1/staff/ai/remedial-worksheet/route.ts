import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import {
  assertAiClassSubject,
  compactQuestion,
  loadClassSubjectUnits,
  pickUnits,
  unitFactsOf,
} from "@/lib/api/v1/staffAi.server";
import {
  cleanUnitFacts,
  cleanWeakLabels,
  suggestRemedialWorksheetLlm,
} from "@/lib/examPaperAiLlm.server";
import type { ExamPaperHardness } from "@/lib/examPapers";

export const runtime = "nodejs";
export const maxDuration = 90;

type Body = {
  classId?: string;
  subjectId?: string;
  unitIds?: unknown;
  /** Areas the class was weak on, in the teacher's words. */
  weakLabels?: unknown;
  count?: number;
  hardness?: string;
};

/**
 * POST /api/v1/staff/ai/remedial-worksheet — the staff app's "Remedial
 * worksheet" tool. The same generator and purpose line as the web route
 * (/api/ai/remedial-worksheet, exams.edit); chapters arrive as ids and are
 * read from the Teaching plan here, and the teacher must teach the subject
 * in the class. Nothing is saved.
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

    const { units: all } = await loadClassSubjectUnits(ctx, classId, subjectId);
    const units = cleanUnitFacts(unitFactsOf(pickUnits(all, body.unitIds)));
    const weakLabels = cleanWeakLabels(body.weakLabels);
    if (units.length === 0 && weakLabels.length === 0) {
      throw new ApiError("bad_request", "Tick at least one chapter, or type what the class found hard", 400);
    }
    const r = await suggestRemedialWorksheetLlm({
      masters: ctx.masters,
      classId,
      subjectId,
      units,
      weakLabels,
      count: Number(body.count),
      hardness: (body.hardness || "medium") as ExamPaperHardness,
    });
    if (!r.ok) {
      if (/daily AI|budget/i.test(r.error)) throw new ApiError("forbidden", r.error, 429);
      throw new ApiError("server_error", r.error || "The worksheet could not be written — try again", 502);
    }
    return apiOk({
      engine: r.engine,
      generationId: r.generationId,
      questions: r.questions.map(compactQuestion),
    });
  } catch (e) {
    return apiErr(e);
  }
}
