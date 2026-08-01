import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { parseParentVoiceCommand } from "@/lib/parentVoiceIntents";
import { generateGeminiText, geminiConfigured } from "@/lib/erpAiGemini.server";
import { TENANT } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "parent") {
    return NextResponse.json({ error: "Parent login required" }, { status: 403 });
  }

  let body: { message?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const message = (body.message || "").trim();
  if (!message) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }

  const intent = parseParentVoiceCommand(message);

  if (intent.tab) {
    return NextResponse.json({
      ok: true,
      engine: "intent",
      tab: intent.tab,
      reply: intent.reply,
      speakLang: intent.speakLang,
    });
  }

  if (geminiConfigured()) {
    const gemini = await generateGeminiText({
      system: [
        `You are the parent voice assistant for ${TENANT.nameDisplay}.`,
        "Answer in the same language as the parent (Hindi or English).",
        "Keep answers under 3 sentences. Only help with: fees, homework, notices, PTM, leave, transport.",
        "Do not invent amounts or student data — tell them to open the relevant tab in the parent portal.",
        `Parent name: ${session.fullName || "Parent"}.`,
      ].join("\n"),
      userMessage: message,
    });
    if (gemini.ok) {
      const hi = /[\u0900-\u097F]/.test(gemini.text);
      return NextResponse.json({
        ok: true,
        engine: "gemini",
        reply: gemini.text,
        speakLang: hi ? "hi-IN" : "en-IN",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    engine: "intent",
    reply: intent.reply,
    speakLang: intent.speakLang,
  });
}
