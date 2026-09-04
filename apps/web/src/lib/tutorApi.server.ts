/**
 * The parent tutor's request handling, shared by the app route
 * (/api/v1/tutor/ask) and the web portal route (/api/ai/tutor) so the
 * allowance is enforced identically wherever a parent asks from.
 */
import "server-only";
import { aiStreamResponse } from "@/lib/aiStream.server";
import { startLlmPrecheck } from "@/lib/aiLlm.server";
import { replyHomeworkTutor } from "@/lib/homeworkTutor.server";
import type { OpenAiChatTurn } from "@/lib/openAi.server";
import {
  recordTutorUse,
  tutorAllowance,
  tutorRequesterKey,
} from "@/lib/tutorPasses.server";
import {
  tutorMode,
  tutorVerdict,
  type TutorAllowance,
  type TutorContext,
  type TutorMode,
} from "@/lib/tutorPlans";

export type TutorAskBody = {
  message?: string;
  history?: OpenAiChatTurn[];
  context?: TutorContext;
  mode?: string;
  studentId?: string;
};

export type TutorAskDone = {
  engine: string;
  reply: string;
  mode: TutorMode;
  charge: "free" | "pass";
  allowance: TutorAllowance;
};

/** Validate the body the way both routes need it; an empty message = 400 upstream. */
export function parseTutorAsk(body: TutorAskBody): {
  message: string;
  history: OpenAiChatTurn[];
  context: TutorContext;
  mode: TutorMode;
  studentId: string;
} {
  const message = (body.message || "").trim();
  const history = (body.history || [])
    .filter(
      (h) =>
        h &&
        (h.role === "user" || h.role === "assistant") &&
        typeof h.content === "string",
    )
    .slice(-12);
  return {
    message,
    history,
    context: body.context || {},
    mode: tutorMode(body.mode).code,
    studentId: (body.studentId || "").trim(),
  };
}

export const TUTOR_MESSAGE_MAX = 3000;

/**
 * Answer a parent's message under the household's allowance. Returns a
 * Response: a stream when asked for, JSON otherwise, and a 402 with
 * `needsPass` when the allowance is spent so the client can offer passes.
 */
export async function answerParentTutor(opts: {
  householdId: string;
  ask: ReturnType<typeof parseTutorAsk>;
  stream: boolean;
}): Promise<Response> {
  const { householdId, ask, stream } = opts;
  const requester = tutorRequesterKey(householdId);
  // Both lookups overlap: the budget scan and the household's pass + usage.
  const precheck = startLlmPrecheck({ requester });
  const allowance = await tutorAllowance(householdId);
  const verdict = tutorVerdict(ask.mode, allowance);
  if (!verdict.allowed) {
    return Response.json(
      {
        ok: false,
        error: verdict.reason,
        needsPass: verdict.needsPass,
        allowance,
        mode: ask.mode,
      },
      { status: 402 },
    );
  }

  const run = async (onDelta?: (t: string) => void) => {
    const r = await replyHomeworkTutor({
      message: ask.message,
      history: ask.history,
      context: ask.context,
      mode: ask.mode,
      onDelta,
      precheck,
    });
    if (r.ok) {
      await recordTutorUse({
        householdId,
        studentId: ask.studentId,
        mode: ask.mode,
        charge: verdict.charge,
        generationId: r.generationId,
      });
    }
    return r;
  };

  const after: TutorAllowance =
    verdict.charge === "free"
      ? { ...allowance, freeUsedToday: allowance.freeUsedToday + 1 }
      : { ...allowance, passUsedToday: allowance.passUsedToday + 1 };

  if (stream) {
    return aiStreamResponse<TutorAskDone>(async (send) => {
      const r = await run((text) => send({ type: "delta", text }));
      return r.ok
        ? { type: "done", engine: r.engine, reply: r.text, mode: ask.mode, charge: verdict.charge, allowance: after }
        : { type: "error", error: r.error };
    });
  }

  const r = await run();
  if (!r.ok) {
    return Response.json({ ok: false, error: r.error, engine: r.engine }, { status: 503 });
  }
  return Response.json({
    ok: true,
    data: { engine: r.engine, reply: r.text, mode: ask.mode, charge: verdict.charge, allowance: after },
  });
}
