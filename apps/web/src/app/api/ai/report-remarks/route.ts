/**
 * AI report-card remarks — drafts only.
 *
 * The client (Exams → Remarks tab) sends compact per-student facts it
 * already holds (marks, grades, previous-term delta, attendance %,
 * co-scholastic ratings — see lib/reportRemarkAi.ts for exactly what and
 * why nothing more). This route:
 *   1. gates on staff session + exams:edit,
 *   2. asks the LLM router for English drafts in batches,
 *   3. renders Hindi through Sarvam (translation layer) when requested,
 *      falling back to a second LLM pass if Sarvam is not configured,
 *   4. returns drafts + which engines produced them.
 * Nothing is persisted here — the teacher accepts/edits in the UI and
 * saveSheetRemarks() records provenance on the mark sheet.
 */

import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { TENANT } from "@/lib/types";
import {
  generateReportRemarksJson,
  llmStatus,
  translateRemarksToHindiJson,
} from "@/lib/aiLlm.server";
import { sarvamConfigured, sarvamTranslateMany } from "@/lib/sarvam.server";
import { geminiModel } from "@/lib/erpAiGemini.server";
import { openAiModel } from "@/lib/openAi.server";
import {
  chunkStudents,
  REMARK_MAX_STUDENTS_PER_REQUEST,
  type RemarkLanguage,
  type RemarkTone,
  type StudentRemarkDraft,
  type StudentRemarkFacts,
} from "@/lib/reportRemarkAi";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET() {
  const status = llmStatus();
  return NextResponse.json({
    service: "report-remarks-ai",
    llmConfigured: status.primaryEngine !== "none",
    primaryEngine: status.primaryEngine,
    hindiEngine: sarvamConfigured()
      ? "sarvam"
      : status.primaryEngine !== "none"
        ? status.primaryEngine
        : "none",
    maxStudents: REMARK_MAX_STUDENTS_PER_REQUEST,
    note: "POST { tone, language, includeSubjectRemarks?, students: StudentRemarkFacts[] } — staff with exams:edit; returns drafts, saves nothing",
  });
}

function cleanFacts(raw: unknown): StudentRemarkFacts | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const studentId = String(r.studentId ?? "").trim();
  const firstName = String(r.firstName ?? "").trim().slice(0, 40);
  if (!studentId || !firstName) return null;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const subjects = Array.isArray(r.subjects)
    ? r.subjects
        .map((s) => {
          const x = (s ?? {}) as Record<string, unknown>;
          const subjectId = String(x.subjectId ?? "").trim();
          const subjectName = String(x.subjectName ?? "").trim().slice(0, 60);
          if (!subjectId || !subjectName) return null;
          return {
            subjectId,
            subjectName,
            marksObtained: num(x.marksObtained),
            maxMarks: num(x.maxMarks) ?? 100,
            grade: String(x.grade ?? "—").slice(0, 4),
            previousGrade: String(x.previousGrade ?? "").slice(0, 4),
            deltaPercent: num(x.deltaPercent),
          };
        })
        .filter((s): s is NonNullable<typeof s> => !!s)
        .slice(0, 20)
    : [];
  const coScholastic = Array.isArray(r.coScholastic)
    ? r.coScholastic
        .map((c) => {
          const x = (c ?? {}) as Record<string, unknown>;
          return {
            domainLabel: String(x.domainLabel ?? "").slice(0, 40),
            ratingLabel: String(x.ratingLabel ?? "").slice(0, 40),
          };
        })
        .filter((c) => c.domainLabel && c.ratingLabel)
        .slice(0, 6)
    : [];
  return {
    studentId,
    firstName,
    classLabel: String(r.classLabel ?? "").slice(0, 20),
    examLabel: String(r.examLabel ?? "").slice(0, 60),
    percent: num(r.percent) ?? 0,
    overallGrade: String(r.overallGrade ?? "—").slice(0, 4),
    previousPercent: num(r.previousPercent),
    previousExamLabel: String(r.previousExamLabel ?? "").slice(0, 60),
    attendancePercent: num(r.attendancePercent),
    subjects,
    coScholastic,
    existingOverallRemark: String(r.existingOverallRemark ?? "").slice(0, 400),
  };
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  }
  await ensureSchoolMirrorHydrated();
  const masters = loadMasters();
  if (!hasPermission(session, masters, "exams", "edit")) {
    return NextResponse.json(
      { error: "Exams edit permission required" },
      { status: 403 },
    );
  }

  let body: {
    tone?: RemarkTone;
    language?: RemarkLanguage;
    includeSubjectRemarks?: boolean;
    students?: unknown[];
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const tone: RemarkTone =
    body.tone === "encouraging" || body.tone === "firm" ? body.tone : "balanced";
  const language: RemarkLanguage =
    body.language === "hi" || body.language === "both" ? body.language : "en";
  const includeSubjectRemarks = body.includeSubjectRemarks !== false;

  const students = (Array.isArray(body.students) ? body.students : [])
    .map(cleanFacts)
    .filter((s): s is StudentRemarkFacts => !!s);
  if (students.length === 0) {
    return NextResponse.json({ error: "students required" }, { status: 400 });
  }
  if (students.length > REMARK_MAX_STUDENTS_PER_REQUEST) {
    return NextResponse.json(
      { error: `At most ${REMARK_MAX_STUDENTS_PER_REQUEST} students per request` },
      { status: 400 },
    );
  }

  // 1. English drafts, batched.
  const drafts: StudentRemarkDraft[] = [];
  const errors: string[] = [];
  let engine = "none";
  for (const batch of chunkStudents(students)) {
    const r = await generateReportRemarksJson({
      students: batch,
      tone,
      includeSubjectRemarks,
      schoolName: TENANT.nameDisplay,
    });
    if (!r.ok) {
      errors.push(r.error);
      continue;
    }
    engine = r.engine;
    drafts.push(...r.drafts);
  }
  if (drafts.length === 0) {
    return NextResponse.json(
      { error: errors[0] || "AI did not return any remarks", engine },
      { status: 502 },
    );
  }

  // 2. Hindi rendering — same content, translated; never authored separately.
  let hindiEngine: string = "none";
  if (language !== "en") {
    if (sarvamConfigured()) {
      const t = await sarvamTranslateMany({
        texts: drafts.map((d) => d.overall),
        from: "en-IN",
        to: "hi-IN",
        mode: "formal",
      });
      drafts.forEach((d, i) => {
        d.overallHi = t.texts[i] ?? "";
      });
      hindiEngine = "sarvam";
      errors.push(...t.errors.slice(0, 3));
    } else {
      const t = await translateRemarksToHindiJson({
        items: drafts.map((d) => ({ id: d.studentId, text: d.overall })),
      });
      if (t.ok) {
        const byId = new Map(t.items.map((i) => [i.id, i.text]));
        for (const d of drafts) d.overallHi = byId.get(d.studentId) ?? "";
        hindiEngine = t.engine;
      } else {
        errors.push(t.error);
      }
    }
  }

  const generatedAt = new Date().toISOString();
  const missing = students
    .map((s) => s.studentId)
    .filter((id) => !drafts.some((d) => d.studentId === id));

  return NextResponse.json({
    ok: true,
    tone,
    language,
    engine,
    hindiEngine,
    model:
      engine === "gemini" ? geminiModel() : engine === "openai" ? openAiModel() : "",
    generatedAt,
    drafts,
    missing,
    warnings: errors,
  });
}
