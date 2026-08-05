/**
 * Homework tutor — Socratic hints (server).
 */

import { TENANT } from "@/lib/types";
import { generateTutorText } from "@/lib/aiLlm.server";
import type { HomeworkTutorContext } from "@/lib/homeworkTutor.types";
import type { OpenAiChatTurn } from "@/lib/openAi.server";

export type { HomeworkTutorContext } from "@/lib/homeworkTutor.types";

function buildTutorSystem(ctx: HomeworkTutorContext): string {
  return [
    `You are a patient homework tutor for ${TENANT.nameDisplay}.`,
    "You help parents guide their child — you do NOT do the homework for them.",
    "Rules:",
    "- Give hints, steps, and questions that lead the child to think.",
    "- Never output the full final answer to an exercise unless the parent explicitly asks for a worked example on a different practice problem.",
    "- Match the parent's language (Hindi or English).",
    "- Keep replies under 120 words unless asked for more.",
    "- If the question is unrelated to schoolwork, politely redirect.",
    ctx.childName ? `Child: ${ctx.childName}.` : "",
    ctx.className ? `Class: ${ctx.className}.` : "",
    ctx.subjectLabel ? `Subject: ${ctx.subjectLabel}.` : "",
    ctx.homeworkTitle ? `Assignment title: ${ctx.homeworkTitle}.` : "",
    ctx.homeworkBody
      ? `Assignment text:\n${ctx.homeworkBody.slice(0, 2000)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function replyHomeworkTutor(opts: {
  message: string;
  history?: OpenAiChatTurn[];
  context?: HomeworkTutorContext;
}) {
  const message = opts.message.trim();
  if (!message) {
    return { ok: false as const, error: "message required", engine: "none" as const };
  }

  return generateTutorText({
    system: buildTutorSystem(opts.context || {}),
    history: opts.history,
    userMessage: message,
  });
}
