import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { generateTutorText, llmStatus } from "@/lib/aiLlm.server";

export const runtime = "nodejs";

export async function GET() {
  const status = llmStatus();
  return NextResponse.json({
    service: "ptm-feedback-digest",
    configured: status.tutorEngine !== "none",
    engine: status.tutorEngine,
    note: "POST { eventLabel?, entries: [{studentName, strengths, areas, followUp}] }",
  });
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  }

  let body: {
    eventLabel?: string;
    entries?: {
      studentName?: string;
      strengths?: string;
      areas?: string;
      followUp?: string;
    }[];
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const entries = Array.isArray(body.entries) ? body.entries : [];
  if (entries.length === 0) {
    return NextResponse.json({ error: "entries required" }, { status: 400 });
  }

  const listing = entries
    .slice(0, 60)
    .map((e, i) => {
      const parts: string[] = [];
      if (e.strengths?.trim()) parts.push(`strengths: ${e.strengths.trim()}`);
      if (e.areas?.trim()) parts.push(`areas to improve: ${e.areas.trim()}`);
      if (e.followUp?.trim()) parts.push(`follow-up: ${e.followUp.trim()}`);
      return `${i + 1}. ${e.studentName || "Student"} — ${parts.join("; ") || "(no notes)"}`;
    })
    .join("\n")
    .slice(0, 6000);

  const system = `You summarize parent-teacher meeting (PTM) feedback notes for a school principal/head who did not attend each meeting individually.
Use ONLY what's in the feedback entries given — never invent a student name, detail, or theme not present in them.
Write a short digest: overall tone across the meetings, 2-4 common themes or patterns (recurring strengths, recurring concerns), and call out any follow-up items that need office/teacher action.
No greeting, no markdown, plain text only.`;

  const userMessage = `PTM event: ${body.eventLabel || "Parent-teacher meeting"}
Feedback entries (${entries.length} total, oldest to newest):
${listing}`;

  const result = await generateTutorText({ system, userMessage });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, engine: result.engine },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    engine: result.engine,
    digest: result.text.trim(),
  });
}
