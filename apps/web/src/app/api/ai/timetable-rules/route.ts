import { NextResponse } from "next/server";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { apiErr } from "@/lib/api/v1/errors";
import { generateTimetableRulesJson } from "@/lib/aiLlm.server";
import type { TimetableRulesFacts } from "@/lib/timetableRulesAi";

export const runtime = "nodejs";

/**
 * POST /api/ai/timetable-rules {classId, facts} → suggested periods/week and
 * placement rules for one class (director, 5 Oct 2026). Nothing is saved
 * here: the Timetable screen shows the proposal beside the current values
 * and the office accepts what it wants.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertPermission(ctx, "timetable", "edit");
    const body = (await request.json().catch(() => ({}))) as { classId?: string; facts?: TimetableRulesFacts };
    const classId = String(body.classId || "");
    const f = body.facts;
    if (!classId || !f || !Array.isArray(f.subjects) || f.subjects.length === 0) {
      return NextResponse.json({ ok: false, error: "Class and its subjects are required" }, { status: 400 });
    }
    const facts: TimetableRulesFacts = {
      className: String(f.className || "").slice(0, 40),
      stage: String(f.stage || "").slice(0, 80),
      weeklyCapacity: Math.max(0, Math.min(80, Math.round(Number(f.weeklyCapacity) || 0))),
      periodsPerDay: Math.max(0, Math.min(14, Math.round(Number(f.periodsPerDay) || 0))),
      periodMinutes: Math.max(0, Math.min(120, Math.round(Number(f.periodMinutes) || 0))),
      subjects: f.subjects.slice(0, 30).map((s) => ({
        id: String(s.id).slice(0, 60),
        name: String(s.name || "").slice(0, 80),
        kind: s.kind === "co-scholastic" ? "co-scholastic" : "scholastic",
        currentPeriodsPerWeek: Math.max(0, Math.min(20, Math.round(Number(s.currentPeriodsPerWeek) || 0))),
      })),
    };
    const r = await generateTimetableRulesJson(facts, classId);
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error, engine: r.engine }, { status: 503 });
    return NextResponse.json({ ok: true, engine: r.engine, generationId: r.generationId, suggestions: r.suggestions });
  } catch (e) {
    return apiErr(e);
  }
}
