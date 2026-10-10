/**
 * Remedial worksheet — questions aimed at the units / LO codes a class was
 * weak on (from item-score roll-ups). Uses the exam-paper "more questions"
 * generator (pro tier, LO tags restricted to the units given) with a
 * purpose line. Returns questions; the client saves them as a draft paper
 * if the teacher wants a printable sheet.
 */

import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { cleanUnitFacts, suggestMoreQuestionsLlm } from "@/lib/examPaperAiLlm.server";
import type { ExamPaperHardness } from "@/lib/examPapers";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function GET() {
  return NextResponse.json({
    service: "remedial-worksheet",
    note: "POST { classId, subjectId, units: [...], weakLabels: string[], count?, hardness? } — staff with exams:edit; returns questions tagged to the given units; saves nothing",
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
  let body: {
    classId?: string;
    subjectId?: string;
    units?: unknown;
    weakLabels?: unknown;
    count?: number;
    hardness?: ExamPaperHardness;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const classId = String(body.classId || "").trim();
  const subjectId = String(body.subjectId || "").trim();
  if (!classId || !subjectId) {
    return NextResponse.json({ error: "classId and subjectId required" }, { status: 400 });
  }
  const units = cleanUnitFacts(body.units);
  const weakLabels = (Array.isArray(body.weakLabels) ? body.weakLabels : [])
    .map((x) => String(x ?? "").trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 8);
  if (units.length === 0 && weakLabels.length === 0) {
    return NextResponse.json({ error: "Give at least one weak unit or area" }, { status: 400 });
  }
  const count = Math.min(12, Math.max(3, Math.floor(Number(body.count) || 8)));
  const r = await suggestMoreQuestionsLlm({
    masters,
    classId,
    subjectId,
    hardness: body.hardness === "easy" || body.hardness === "hard" ? body.hardness : "medium",
    count,
    units,
    focus: `Remedial practice worksheet for students who scored under 50% on: ${weakLabels.join("; ") || units.map((u) => u.title).join("; ")}. Start with two scaffolded items (worked pattern, then a near copy), then build to application. Every question must carry a full markingScheme and, where a unit has LO codes, a competencyCode.`,
    promptVersion: "v2-remedial",
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  return NextResponse.json({
    ok: true,
    engine: r.engine,
    generationId: r.generationId,
    questions: r.questions,
  });
}
