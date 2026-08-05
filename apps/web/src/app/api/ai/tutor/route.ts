import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { llmStatus } from "@/lib/aiLlm.server";
import {
  replyHomeworkTutor,
} from "@/lib/homeworkTutor.server";
import type { HomeworkTutorContext } from "@/lib/homeworkTutor.types";
import type { OpenAiChatTurn } from "@/lib/openAi.server";

export const runtime = "nodejs";

export async function GET() {
  const status = llmStatus();
  return NextResponse.json({
    service: "homework-tutor",
    configured: status.tutorEngine !== "none",
    engine: status.tutorEngine,
    note: "POST { message, history?, context? } — parent or staff",
  });
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session) {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  if (session.persona !== "parent" && session.persona !== "staff") {
    return NextResponse.json(
      { error: "Homework tutor is for parents and staff" },
      { status: 403 },
    );
  }

  let body: {
    message?: string;
    history?: OpenAiChatTurn[];
    context?: HomeworkTutorContext;
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
  if (message.length > 1500) {
    return NextResponse.json({ error: "message too long" }, { status: 400 });
  }

  const history = (body.history || []).filter(
    (h) =>
      h &&
      (h.role === "user" || h.role === "assistant") &&
      typeof h.content === "string",
  );

  const result = await replyHomeworkTutor({
    message,
    history,
    context: body.context,
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
    reply: result.text,
  });
}
