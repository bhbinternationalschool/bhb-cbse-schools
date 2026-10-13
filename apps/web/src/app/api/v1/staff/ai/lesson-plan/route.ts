import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { assertAiClassSubject, loadClassSubjectUnits, pickUnits } from "@/lib/api/v1/staffAi.server";
import { cleanLessonPlanAiInput, LESSON_PLAN_MAX_UNITS } from "@/lib/lessonPlanAi";
import { draftLessonPlan } from "@/lib/lessonPlanDraft.server";
import { subjectLabel } from "@/lib/homework";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  classId?: string;
  subjectId?: string;
  unitIds?: unknown;
  periods?: number;
  language?: string;
  existing?: Record<string, unknown>;
  teacherNote?: string;
};

/**
 * POST /api/v1/staff/ai/lesson-plan — the staff app's AI lesson-plan draft.
 * The same grounding and generator as the web editor (lib/lessonPlanDraft:
 * the school's own books for the class and subject — never NCERT's for
 * Classes 1–8 — and agreed learning outcomes), behind the same teaching.edit
 * plus the class + subject scope the lesson-plan save already enforces.
 *
 * The ticked chapters arrive as ids and are read from the Teaching plan
 * here. Nothing is saved: the teacher edits the draft and saves it through
 * /api/v1/teaching/lesson-plan with source ai / ai_edited.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "teaching", "edit");
    const body = (await request.json().catch(() => ({}))) as Body;
    const classId = String(body.classId || "").trim();
    const subjectId = String(body.subjectId || "").trim();
    await ensureSchoolMirrorHydrated();
    await assertAiClassSubject(ctx, classId, subjectId);

    const { units: all } = await loadClassSubjectUnits(ctx, classId, subjectId);
    const units = pickUnits(all, body.unitIds, LESSON_PLAN_MAX_UNITS);
    // The web editor's payload, built from the server's own copy.
    const input = cleanLessonPlanAiInput({
      classLabel: ctx.masters.classes.find((c) => c.id === classId)?.name ?? "",
      subjectName: subjectLabel(ctx.masters, subjectId),
      periods: Number(body.periods) || 1,
      language: body.language === "hi" ? "hi" : "en",
      units: units.map((u) => ({
        level: u.level,
        code: u.code,
        title: u.title,
        learningOutcomes: u.learningOutcomes,
        plannedPeriods: u.plannedPeriods,
      })),
      existing: body.existing ?? {},
      teacherNote: String(body.teacherNote ?? ""),
    });
    if (!input) {
      throw new ApiError("bad_request", "Pick at least one chapter, or give the lesson a title", 400);
    }

    const r = await draftLessonPlan(input);
    if (!r.ok) {
      if (/daily AI|budget/i.test(r.error)) throw new ApiError("forbidden", r.error, 429);
      throw new ApiError("server_error", r.error || "The draft could not be written — try again", 502);
    }
    return apiOk({
      language: input.language,
      engine: r.engine,
      model: r.model,
      generationId: r.generationId,
      booksKind: r.booksKind,
      agreedOutcomeUnits: r.agreedOutcomeUnits,
      unitIds: units.map((u) => u.id),
      draft: r.draft,
    });
  } catch (e) {
    return apiErr(e);
  }
}
