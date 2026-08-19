import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { generateLeadNextActionJson, llmStatus } from "@/lib/aiLlm.server";
import { TENANT } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const status = llmStatus();
  return NextResponse.json({
    service: "lead-next-action",
    configured: status.tutorEngine !== "none",
    engine: status.tutorEngine,
    note: "POST { childName, classSoughtLabel, stageLabel, sourceLabel, daysSinceEnquiry, followUpSummary?, language? }",
  });
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  }

  let body: {
    childName?: string;
    classSoughtLabel?: string;
    stageLabel?: string;
    sourceLabel?: string;
    daysSinceEnquiry?: number;
    followUpSummary?: string;
    language?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const childName = (body.childName || "").trim().slice(0, 120);
  const stageLabel = (body.stageLabel || "").trim().slice(0, 40);
  if (!childName || !stageLabel) {
    return NextResponse.json(
      { error: "childName and stageLabel required" },
      { status: 400 },
    );
  }

  const result = await generateLeadNextActionJson({
    schoolName: TENANT.nameDisplay,
    childName,
    classSoughtLabel: (body.classSoughtLabel || "").trim().slice(0, 40),
    stageLabel,
    sourceLabel: (body.sourceLabel || "").trim().slice(0, 40),
    daysSinceEnquiry: Number.isFinite(body.daysSinceEnquiry)
      ? Math.max(0, Math.round(body.daysSinceEnquiry as number))
      : 0,
    followUpSummary: (body.followUpSummary || "").trim().slice(0, 600),
    language: body.language === "hi" ? "hi" : "en",
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, engine: result.engine },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    engine: result.engine,
    generationId: result.generationId,
    nextAction: result.nextAction,
    outreachMessage: result.outreachMessage,
  });
}
