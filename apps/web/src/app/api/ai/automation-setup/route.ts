import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { generateAutomationSetupJson, llmStatus } from "@/lib/aiLlm.server";

export const runtime = "nodejs";

export async function GET() {
  const status = llmStatus();
  return NextResponse.json({
    service: "automation-setup",
    configured: status.tutorEngine !== "none",
    engine: status.tutorEngine,
    note: "POST { ruleName, module, description?, hint }",
  });
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  }

  let body: {
    ruleName?: string;
    description?: string;
    module?: string;
    hint?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const hint = (body.hint || "").trim();
  if (!hint) {
    return NextResponse.json({ error: "hint required" }, { status: 400 });
  }
  if (hint.length > 600) {
    return NextResponse.json({ error: "hint too long" }, { status: 400 });
  }

  const result = await generateAutomationSetupJson({
    ruleName: (body.ruleName || "Automation rule").trim(),
    description: (body.description || "").trim(),
    module: body.module || "general",
    hint,
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
    audienceSummary: result.audienceSummary,
    audienceExplanation: result.audienceExplanation,
    triggerType: result.triggerType,
    cronExpr: result.cronExpr,
    intervalMinutes: result.intervalMinutes,
    eventKey: result.eventKey,
    scheduleExplanation: result.scheduleExplanation,
  });
}
