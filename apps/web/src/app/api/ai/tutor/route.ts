import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { llmStatus, startLlmPrecheck } from "@/lib/aiLlm.server";
import {
  replyHomeworkTutor,
} from "@/lib/homeworkTutor.server";
import type { HomeworkTutorContext } from "@/lib/homeworkTutor.types";
import type { OpenAiChatTurn } from "@/lib/openAi.server";
import { aiStreamResponse, wantsAiStream } from "@/lib/aiStream.server";
import { answerParentTutor, parseTutorAsk, resolveTutorStudent, TUTOR_MESSAGE_MAX } from "@/lib/tutorApi.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  // Budget + requester resolve while the body is read and validated.
  const precheck = startLlmPrecheck();

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

  // A parent on the web portal is under the same household allowance as
  // the app — hints free up to the daily cap, the full tutor on a pass.
  if (session.persona === "parent" && session.householdId) {
    const ask = parseTutorAsk({ ...body, mode: (body as { mode?: string }).mode });
    if (ask.message.length > TUTOR_MESSAGE_MAX) {
      return NextResponse.json({ error: "message too long" }, { status: 400 });
    }
    try {
      const student = await resolveTutorStudent(session.householdId, ask.studentId);
      return await answerParentTutor({
        householdId: session.householdId,
        student,
        ask,
        stream: wantsAiStream(req),
      });
    } catch (e) {
      const status = e instanceof Error && "status" in e ? Number((e as { status: number }).status) : 400;
      return NextResponse.json({ error: e instanceof Error ? e.message : "bad request" }, { status });
    }
  }

  // Streaming callers (the portal's tutor panel) get the reply as it is
  // written; everyone else — the mobile app, scripts — keeps the JSON shape.
  if (wantsAiStream(req)) {
    return aiStreamResponse<{ engine: string; reply: string }>(async (send) => {
      const r = await replyHomeworkTutor({
        message,
        history,
        context: body.context,
        onDelta: (text) => send({ type: "delta", text }),
        precheck,
      });
      return r.ok
        ? { type: "done", engine: r.engine, reply: r.text }
        : { type: "error", error: r.error };
    });
  }

  const result = await replyHomeworkTutor({
    message,
    history,
    context: body.context,
    precheck,
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
