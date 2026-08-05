import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { llmStatus } from "@/lib/aiLlm.server";
import { openAiModel } from "@/lib/openAi.server";
import { geminiModel } from "@/lib/erpAiGemini.server";

export const runtime = "nodejs";

export async function GET() {
  const status = llmStatus();
  return NextResponse.json({
    ok: true,
    ...status,
    openAiModel: status.openaiConfigured ? openAiModel() : null,
    geminiModel: status.geminiConfigured ? geminiModel() : null,
  });
}
