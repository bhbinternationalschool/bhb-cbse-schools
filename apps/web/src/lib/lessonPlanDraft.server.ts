/**
 * One AI lesson-plan draft — the grounding and the router call shared by
 * the web editor's route (/api/ai/lesson-plan) and the staff app's
 * (/api/v1/staff/ai/lesson-plan). Lifted out of the web route on
 * 2026-10-13 so the phone gets exactly the same draft, not a copy of the
 * prompt logic that drifts:
 *
 *   1. the school's own books for the class and subject (Propel), when
 *      loaded — never NCERT's books for Classes 1–8; for Nursery–UKG,
 *      NCERT's learning outcomes as a minimum;
 *   2. the learning outcomes a teacher AGREED WITH for any ticked chapter
 *      the teacher left blank (their own words always win);
 *   3. one draft from the LLM router (ai_generations row, budget, engine).
 *
 * Nothing is saved here. The caller returns the draft; the teacher edits and
 * saves through the lesson-plan save path, which records ai / ai_edited.
 */

import "server-only";
import { TENANT } from "@/lib/types";
import { generateLessonPlanJson } from "@/lib/aiLlm.server";
import { geminiModel } from "@/lib/erpAiGemini.server";
import { openAiModel } from "@/lib/openAi.server";
import { ncertTextbooksListing } from "@/lib/tutorSyllabus.server";
import type { LessonPlanAiInput, LessonPlanDraft } from "@/lib/lessonPlanAi";
import { fillAgreedOutcomes } from "@/lib/chapterStandards";
import { loadAgreedOutcomesByPosition } from "@/lib/chapterStandards.server";

export type LessonPlanDraftResult =
  | {
      ok: true;
      engine: string;
      model: string;
      generationId: string;
      draft: LessonPlanDraft;
      /** "chapters" (Classes 1–8, the school's books), "outcomes" (Nursery–UKG) or "none". */
      booksKind: "chapters" | "outcomes" | "none";
      /** Ticked chapters drafted on outcomes a teacher agreed with. */
      agreedOutcomeUnits: number;
    }
  | { ok: false; error: string; engine: string };

export async function draftLessonPlan(input: LessonPlanAiInput): Promise<LessonPlanDraftResult> {
  // Only the lesson's own subject, in the plan's language, so a Hindi plan
  // quotes the Hindi-medium chapter names. Empty (never an error) when
  // nothing is loaded.
  const books = await ncertTextbooksListing({
    className: input.classLabel,
    subjectLabel: input.subjectName,
    coreFallback: false,
    medium: input.language === "hi" ? "Hindi" : "English",
  });

  const agreed = await loadAgreedOutcomesByPosition({
    classLabel: input.classLabel,
    subjectName: input.subjectName,
  });
  const grounded = fillAgreedOutcomes(input.units, agreed);

  const r = await generateLessonPlanJson({
    input: { ...input, units: grounded.units },
    schoolName: TENANT.nameDisplay,
    textbooks: books.text,
    textbooksKind: books.kind,
  });
  if (!r.ok) return { ok: false, error: r.error, engine: r.engine };
  return {
    ok: true,
    engine: r.engine,
    model: r.engine === "gemini" ? geminiModel() : r.engine === "openai" ? openAiModel() : "",
    generationId: r.generationId,
    draft: r.draft,
    booksKind: books.kind,
    agreedOutcomeUnits: grounded.filled,
  };
}
