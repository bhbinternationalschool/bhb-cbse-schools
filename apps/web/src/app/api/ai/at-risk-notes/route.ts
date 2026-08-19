/**
 * "What to do" notes for students the school's own at-risk rules flagged.
 * The client sends the facts + the flags it computed (lib/academicRisk.ts);
 * the server re-runs the rules on the same facts and only writes notes for
 * students that are actually flagged — the model never picks who is at
 * risk. Drafts only; nothing persisted.
 */

import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { TENANT } from "@/lib/types";
import { generateRiskNotesJson, llmStatus } from "@/lib/aiLlm.server";
import { geminiModel } from "@/lib/erpAiGemini.server";
import { openAiModel } from "@/lib/openAi.server";
import {
  assessStudentRisk,
  chunkRiskStudents,
  cleanRiskFacts,
  RISK_NOTES_MAX_STUDENTS,
  type RiskNoteDraft,
  type RiskNoteLanguage,
} from "@/lib/academicRisk";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET() {
  const status = llmStatus();
  return NextResponse.json({
    service: "at-risk-notes",
    llmConfigured: status.primaryEngine !== "none",
    primaryEngine: status.primaryEngine,
    maxStudents: RISK_NOTES_MAX_STUDENTS,
    note: "POST { language?: en|hi, students: StudentRiskFacts[] } — staff with exams:edit; rules re-run server-side, notes only for flagged students; saves nothing",
  });
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  }
  await ensureSchoolMirrorHydrated();
  const masters = loadMasters();
  if (!hasPermission(session, masters, "exams", "edit")) {
    return NextResponse.json({ error: "Exams edit permission required" }, { status: 403 });
  }
  let body: { language?: unknown; students?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const language: RiskNoteLanguage = body.language === "hi" ? "hi" : "en";
  const facts = (Array.isArray(body.students) ? body.students : [])
    .map(cleanRiskFacts)
    .filter((f): f is NonNullable<typeof f> => !!f)
    .slice(0, RISK_NOTES_MAX_STUDENTS);
  // Server-side re-assessment — the client's flags are advisory only.
  const flagged = facts
    .map((f) => ({ ...f, flags: assessStudentRisk(f).flags }))
    .filter((f) => f.flags.length > 0);
  if (flagged.length === 0) {
    return NextResponse.json({ error: "No flagged students in the request" }, { status: 400 });
  }

  const notes: RiskNoteDraft[] = [];
  const generationIds: string[] = [];
  const errors: string[] = [];
  let engine = "none";
  for (const batch of chunkRiskStudents(flagged)) {
    const r = await generateRiskNotesJson({ students: batch, language, schoolName: TENANT.nameDisplay });
    if (!r.ok) {
      errors.push(r.error);
      continue;
    }
    engine = r.engine;
    generationIds.push(r.generationId);
    notes.push(...r.notes);
  }
  if (notes.length === 0) {
    return NextResponse.json({ error: errors[0] || "AI did not return any notes", engine }, { status: 502 });
  }
  return NextResponse.json({
    ok: true,
    engine,
    model: engine === "gemini" ? geminiModel() : engine === "openai" ? openAiModel() : "",
    language,
    generatedAt: new Date().toISOString(),
    generationIds,
    notes,
    missing: flagged.map((f) => f.studentId).filter((id) => !notes.some((n) => n.studentId === id)),
    warnings: errors,
  });
}
