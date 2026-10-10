import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { generateSubstitutionSummaryJson } from "@/lib/aiLlm.server";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    service: "ai-substitution-summary",
    note: "POST { teacherLabel, date, startTime, endTime, reason, covered[], uncovered[] } — staff-only, drafts a plain-language summary of an already-saved substitution outcome",
  });
}

type CoveredRow = {
  periodLabel?: string;
  classSection?: string;
  subject?: string;
  substituteName?: string;
};
type UncoveredRow = { periodLabel?: string; classSection?: string; subject?: string };

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 401 });
  }
  const masters = loadMasters();
  if (!hasPermission(session, masters, "timetable", "view")) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  let body: {
    teacherLabel?: string;
    date?: string;
    startTime?: string;
    endTime?: string;
    reason?: string;
    covered?: CoveredRow[];
    uncovered?: UncoveredRow[];
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const teacherLabel = (body.teacherLabel || "").trim();
  const date = (body.date || "").trim();
  const startTime = (body.startTime || "").trim();
  const endTime = (body.endTime || "").trim();
  const reason = (body.reason || "").trim();
  if (!teacherLabel || !date || !startTime || !endTime || !reason) {
    return NextResponse.json(
      { error: "teacherLabel, date, startTime, endTime, reason required" },
      { status: 400 },
    );
  }

  const covered = (Array.isArray(body.covered) ? body.covered : []).map((c) => ({
    periodLabel: String(c.periodLabel || ""),
    classSection: String(c.classSection || ""),
    subject: String(c.subject || ""),
    substituteName: String(c.substituteName || ""),
  }));
  const uncovered = (Array.isArray(body.uncovered) ? body.uncovered : []).map((c) => ({
    periodLabel: String(c.periodLabel || ""),
    classSection: String(c.classSection || ""),
    subject: String(c.subject || ""),
  }));

  const r = await generateSubstitutionSummaryJson({
    teacherLabel,
    date,
    startTime,
    endTime,
    reason,
    covered,
    uncovered,
  });

  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error }, { status: 502 });
  }

  return NextResponse.json({ ok: true, summary: r.summary, engine: r.engine, generationId: r.generationId });
}
