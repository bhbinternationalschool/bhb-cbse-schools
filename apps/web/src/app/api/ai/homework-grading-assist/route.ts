import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { generateHomeworkGradingAssistJson } from "@/lib/aiLlm.server";
import { visionConfigured, visionExtractText } from "@/lib/googleVision.server";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    service: "ai-homework-grading-assist",
    visionConfigured: visionConfigured(),
    note: "POST { imageBase64, mimeType?, assignmentTitle, subjectLabel?, referenceAnswer?, studentLabel } — staff-only, reads a submitted homework photo and drafts a completeness note",
  });
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 401 });
  }
  const masters = loadMasters();
  if (!hasPermission(session, masters, "homework", "edit")) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  let body: {
    imageBase64?: string;
    mimeType?: string;
    assignmentTitle?: string;
    subjectLabel?: string;
    referenceAnswer?: string;
    studentLabel?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const imageBase64 = (body.imageBase64 || "").trim();
  const assignmentTitle = (body.assignmentTitle || "").trim();
  const studentLabel = (body.studentLabel || "").trim();
  if (!imageBase64 || !assignmentTitle || !studentLabel) {
    return NextResponse.json(
      { error: "imageBase64, assignmentTitle, studentLabel required" },
      { status: 400 },
    );
  }

  if (!visionConfigured()) {
    return NextResponse.json(
      { error: "Google Vision not configured", visionConfigured: false },
      { status: 503 },
    );
  }

  const vision = await visionExtractText({ imageBase64, mimeType: body.mimeType });
  if (!vision.ok) {
    return NextResponse.json({ ok: false, error: vision.error }, { status: 400 });
  }

  const r = await generateHomeworkGradingAssistJson({
    assignmentTitle,
    subjectLabel: body.subjectLabel,
    referenceAnswer: body.referenceAnswer,
    extractedText: vision.text,
    studentLabel,
  });

  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    generationId: r.generationId,
    extractedText: vision.text,
    completeness: r.completeness,
    feedbackDraft: r.feedbackDraft,
    engine: r.engine,
  });
}
