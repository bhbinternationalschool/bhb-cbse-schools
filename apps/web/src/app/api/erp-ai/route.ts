import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { replyErpAiChatServer } from "@/lib/erpAiChat.server";
import { llmStatus } from "@/lib/aiLlm.server";
import { openAiModel } from "@/lib/openAi.server";
import { geminiModel } from "@/lib/erpAiGemini.server";
import { aiStreamResponse, wantsAiStream } from "@/lib/aiStream.server";
import type { ErpAiMessage } from "@/lib/erpAiChat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = llmStatus();
  const anyLlm = status.primaryEngine !== "none";

  return NextResponse.json({
    service: "erp-ai",
    geminiConfigured: status.geminiConfigured,
    llmConfigured: anyLlm,
    preferredEngine: status.preferredEngine,
    primaryEngine: status.primaryEngine,
    fallbackEngine: status.fallbackEngine,
    openAiModel: status.openaiConfigured ? openAiModel() : null,
    geminiModel: status.geminiConfigured ? geminiModel() : null,
    model:
      status.primaryEngine === "openai"
        ? openAiModel()
        : status.primaryEngine === "gemini"
          ? geminiModel()
          : null,
    note: anyLlm
      ? `POST { message, history?, pathname?, tab? } — local guides first, ${status.primaryEngine}${status.fallbackEngine ? ` (fallback: ${status.fallbackEngine})` : ""} for open questions`
      : "Set OPENAI_API_KEY or GEMINI_API_KEY in server env for live AI answers",
  });
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.persona !== "staff") {
    return NextResponse.json(
      { error: "ERP AI assistant is for staff sign-in only" },
      { status: 403 },
    );
  }

  let body: {
    message?: string;
    history?: { role: "user" | "assistant"; text: string }[];
    pathname?: string;
    tab?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const message = (body.message || "").trim();
  if (!message) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }
  if (message.length > 2000) {
    return NextResponse.json({ error: "message too long" }, { status: 400 });
  }

  // The engine hydrates the school mirror and loads masters itself;
  // doing it here as well parsed the 6.7 MB mirror file twice per message.
  if (wantsAiStream(req)) {
    type Done = {
      engine: string;
      geminiConfigured: boolean;
      llmConfigured: boolean;
      message: ErpAiMessage;
    };
    return aiStreamResponse<Done>(async (send) => {
      const r = await replyErpAiChatServer({
        session,
        message,
        history: body.history,
        pathname: body.pathname,
        tab: body.tab,
        onDelta: (text) => send({ type: "delta", text }),
      });
      return {
        type: "done",
        engine: r.engine,
        geminiConfigured: r.geminiConfigured,
        llmConfigured: r.llmConfigured,
        message: r.message,
      };
    });
  }

  const result = await replyErpAiChatServer({
    session,
    message,
    history: body.history,
    pathname: body.pathname,
    tab: body.tab,
  });

  return NextResponse.json({
    ok: true,
    engine: result.engine,
    geminiConfigured: result.geminiConfigured,
    llmConfigured: result.llmConfigured,
    message: result.message,
  });
}
