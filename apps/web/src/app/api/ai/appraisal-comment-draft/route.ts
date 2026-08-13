import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { generateTutorText, llmStatus } from "@/lib/aiLlm.server";

export const runtime = "nodejs";

export async function GET() {
  const status = llmStatus();
  return NextResponse.json({
    service: "appraisal-comment-draft",
    configured: status.tutorEngine !== "none",
    engine: status.tutorEngine,
    note: "POST { staffName, cycleLabel?, scores: [{label, value}] }",
  });
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  }

  let body: {
    staffName?: string;
    cycleLabel?: string;
    scores?: { label?: string; value?: number }[];
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const scores = Array.isArray(body.scores) ? body.scores : [];
  if (scores.length === 0 || !body.staffName?.trim()) {
    return NextResponse.json(
      { error: "staffName and scores required" },
      { status: 400 },
    );
  }

  const scoreLines = scores
    .filter((s) => s.label && Number.isFinite(s.value))
    .map((s) => `${s.label}: ${s.value}/5`)
    .join(", ");

  const system = `You draft a short staff performance appraisal comment for a school HR review.
The rater has already chosen numeric ratings (1 = needs improvement, 5 = excellent) for each criterion — use ONLY those numbers as your signal, never invent a specific incident, behavior, or detail that isn't implied by the scores themselves.
Write 2-3 sentences, professional and constructive: acknowledge strengths where scores are 4-5, note growth areas where scores are 1-3 (phrased constructively, not harshly), and keep an encouraging overall tone.
No greeting, no markdown, plain text only — this is a draft the rater will review and edit before saving.`;

  const userMessage = `Staff member: ${body.staffName.trim()}
${body.cycleLabel ? `Appraisal cycle: ${body.cycleLabel}\n` : ""}Ratings (out of 5): ${scoreLines}`;

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
    draft: result.text.trim(),
  });
}
