/**
 * AI lesson-plan draft — draft only, nothing persisted.
 *
 * The Lesson plans editor (Teaching → Lesson plans) sends the chapters /
 * topics the teacher ticked (title, code, learning outcomes, planned
 * periods), the class + subject labels, the period count, whatever the
 * teacher already typed and an optional note. This route:
 *   1. gates on staff session + teaching:edit,
 *   2. adds the school's own books for the class and subject (Propel), when
 *      loaded, so the plan follows the real chapter — never NCERT's books;
 *      for Nursery–UKG, NCERT's learning outcomes as a minimum,
 *   3. fills the learning outcomes of any ticked CHAPTER the teacher left
 *      blank with the ones a teacher has AGREED WITH (Teaching → Learning
 *      outcomes). Without this the prompt tells the model to derive outcomes
 *      from the chapter title, which is a fresh guess every draft. Agreed
 *      outcomes only: the read goes through `learning_chapter_outcomes`, which
 *      cannot show an unreviewed match. Nothing agreed → nothing changes.
 *   4. asks the LLM router for one draft (English or Hindi),
 *   5. returns it, saying how many chapters stood on agreed outcomes. The
 *      teacher edits and saves in the editor; `LessonPlan.source` records
 *      ai / ai_edited / manual on save.
 */

import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { TENANT } from "@/lib/types";
import { generateLessonPlanJson, llmStatus } from "@/lib/aiLlm.server";
import { geminiModel } from "@/lib/erpAiGemini.server";
import { openAiModel } from "@/lib/openAi.server";
import { ncertTextbooksListing } from "@/lib/tutorSyllabus.server";
import {
  cleanLessonPlanAiInput,
  LESSON_PLAN_MAX_PERIODS,
  LESSON_PLAN_MAX_UNITS,
} from "@/lib/lessonPlanAi";
import { fillAgreedOutcomes } from "@/lib/chapterStandards";
import { loadAgreedOutcomesByPosition } from "@/lib/chapterStandards.server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const status = llmStatus();
  return NextResponse.json({
    service: "lesson-plan-ai",
    llmConfigured: status.primaryEngine !== "none",
    primaryEngine: status.primaryEngine,
    maxUnits: LESSON_PLAN_MAX_UNITS,
    maxPeriods: LESSON_PLAN_MAX_PERIODS,
    note: "POST { classLabel, subjectName, periods, language: en|hi, units: [{level, code, title, learningOutcomes, plannedPeriods}], existing: {...}, teacherNote } — staff with teaching:edit; returns one draft, saves nothing",
  });
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  }
  await ensureSchoolMirrorHydrated();
  const masters = loadMasters();
  if (!hasPermission(session, masters, "teaching", "edit")) {
    return NextResponse.json(
      { error: "Teaching edit permission required" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const input = cleanLessonPlanAiInput(body);
  if (!input) {
    return NextResponse.json(
      { error: "Pick a subject and at least one chapter, or give the lesson a title" },
      { status: 400 },
    );
  }

  // Only the lesson's own subject — a Science plan gains nothing from the
  // Hindi book — and in the plan's language, so a Hindi plan quotes the
  // Hindi-medium chapter names. Classes 1–8: the school's own books; for
  // Nursery–UKG, NCERT's learning outcomes for the subject's developmental
  // goals, as a minimum. Empty (never an error) when nothing is loaded.
  const ncert = await ncertTextbooksListing({
    className: input.classLabel,
    subjectLabel: input.subjectName,
    coreFallback: false,
    medium: input.language === "hi" ? "Hindi" : "English",
  });

  // The outcomes somebody agreed with, for the chapters this lesson covers.
  // Without this the prompt tells the model to "derive sensible ones from its
  // title" — a guess about what the chapter teaches, made fresh every draft.
  // Only fills units the teacher left blank; their own words always win, and a
  // chapter nobody has agreed outcomes for is still left to the guess.
  const agreed = await loadAgreedOutcomesByPosition({
    classLabel: input.classLabel,
    subjectName: input.subjectName,
  });
  const grounded = fillAgreedOutcomes(input.units, agreed);
  const groundedInput = { ...input, units: grounded.units };

  const r = await generateLessonPlanJson({
    input: groundedInput,
    schoolName: TENANT.nameDisplay,
    textbooks: ncert.text,
    textbooksKind: ncert.kind,
  });
  if (!r.ok) {
    return NextResponse.json({ error: r.error, engine: r.engine }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    language: input.language,
    engine: r.engine,
    model:
      r.engine === "gemini" ? geminiModel() : r.engine === "openai" ? openAiModel() : "",
    generatedAt: new Date().toISOString(),
    /** ai_generations row — the editor reports accepted/edited/rejected against it */
    generationId: r.generationId,
    /** Whether the draft was written with a book list (the school's) or pre-primary outcomes. */
    groundedOnBooks: ncert.kind !== "none",
    /**
     * How many ticked chapters were drafted against outcomes a teacher agreed
     * with, rather than ones the model derived from the chapter title. 0 means
     * the draft was written exactly as it would have been before the Learning
     * outcomes tab existed — which is the honest answer until somebody works
     * through it.
     */
    agreedOutcomeUnits: grounded.filled,
    /** "chapters" (Classes 1–8, the school's books), "outcomes" (Nursery–UKG: NCERT's minimum) or "none". */
    booksKind: ncert.kind,
    /** @deprecated same as groundedOnBooks — kept for editors still reading the old name. */
    groundedOnNcert: ncert.kind !== "none",
    /** @deprecated same as booksKind. */
    ncertKind: ncert.kind,
    draft: r.draft,
  });
}
