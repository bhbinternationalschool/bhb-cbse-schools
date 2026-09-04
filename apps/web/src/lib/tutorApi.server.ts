/**
 * The parent tutor's request handling, shared by the app route
 * (/api/v1/tutor/ask) and the web portal route (/api/ai/tutor) so the
 * allowance is enforced identically wherever a parent asks from.
 */
import "server-only";
import { aiStreamResponse } from "@/lib/aiStream.server";
import { startLlmPrecheck } from "@/lib/aiLlm.server";
import { ApiError } from "@/lib/api/v1/errors";
import { childOfHousehold } from "@/lib/api/v1/household";
import { loadMasters } from "@/lib/masters";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadSis } from "@/lib/sis";
import { replyHomeworkTutor } from "@/lib/homeworkTutor.server";
import type { OpenAiChatTurn } from "@/lib/openAi.server";
import {
  recordTutorUse,
  tutorAllowance,
  tutorRequesterKey,
} from "@/lib/tutorPasses.server";
import {
  parseTutorLanguage,
  tutorMode,
  tutorVerdict,
  type TutorAllowance,
  type TutorContext,
  type TutorLanguage,
  type TutorMode,
} from "@/lib/tutorPlans";

export type TutorAskBody = {
  message?: string;
  history?: OpenAiChatTurn[];
  context?: TutorContext;
  mode?: string;
  studentId?: string;
  language?: string;
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
  language: TutorLanguage;
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
    language: parseTutorLanguage(body.language),
  };
}

export const TUTOR_MESSAGE_MAX = 3000;

/**
 * Answer a parent's message under the household's allowance. Returns a
 * Response: a stream when asked for, JSON otherwise, and a 402 with
 * `needsPass` when the allowance is spent so the client can offer passes.
 */
export type TutorStudent = { id: string; name: string; classLabel: string };

export async function answerParentTutor(opts: {
  householdId: string;
  /** The child, from the school's record — never from the client. */
  student: TutorStudent;
  ask: ReturnType<typeof parseTutorAsk>;
  stream: boolean;
}): Promise<Response> {
  const { householdId, student, stream } = opts;
  // The prompt is pinned to this child's class; the client keeps only the
  // assignment context it was opened from.
  const ask = {
    ...opts.ask,
    studentId: student.id,
    context: { ...opts.ask.context, childName: student.name, className: student.classLabel },
  };
  const requester = tutorRequesterKey(householdId);
  // Both lookups overlap: the budget scan and the child's pass + usage.
  const precheck = startLlmPrecheck({ requester });
  const allowance = await tutorAllowance(householdId, student);
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
      language: ask.language,
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

/**
 * The child a parent is asking for, checked against the household and
 * labelled from Masters. Throws the API errors the v1 routes expect.
 */
export async function resolveTutorStudent(householdId: string, studentId: string): Promise<TutorStudent> {
  if (!studentId) throw new ApiError("bad_request", "Choose which child this is for", 400);
  await ensureSchoolMirrorHydrated();
  const student = childOfHousehold(loadSis(), studentId, householdId);
  const masters = loadMasters();
  const className = masters.classes.find((c) => c.id === student.classId)?.name ?? "";
  const sectionName = masters.sections.find((x) => x.id === student.sectionId)?.name ?? "";
  return {
    id: student.id,
    name: student.fullName,
    classLabel: [className, sectionName].filter(Boolean).join(" ") || "their class",
  };
}
