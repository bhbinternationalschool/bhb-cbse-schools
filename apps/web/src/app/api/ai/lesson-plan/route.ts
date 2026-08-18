/**
 * AI lesson-plan draft — draft only, nothing persisted.
 *
 * The Lesson plans editor (Teaching → Lesson plans) sends the chapters /
 * topics the teacher ticked (title, code, learning outcomes, planned
 * periods), the class + subject labels, the period count, whatever the
 * teacher already typed and an optional note. This route:
 *   1. gates on staff session + teaching:edit,
 *   2. asks the LLM router for one draft (English or Hindi),
 *   3. returns it. The teacher edits and saves in the editor;
 *      `LessonPlan.source` records ai / ai_edited / manual on save.
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
import {
  cleanLessonPlanAiInput,
  LESSON_PLAN_MAX_PERIODS,
  LESSON_PLAN_MAX_UNITS,
} from "@/lib/lessonPlanAi";

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

  const r = await generateLessonPlanJson({
    input,
    schoolName: TENANT.nameDisplay,
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
    draft: r.draft,
  });
}
