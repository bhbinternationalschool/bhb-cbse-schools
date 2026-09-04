/**
 * Homework tutor (server): one entry point for the web portal, the parent
 * app and staff. The mode decides the contract — "hint" keeps the Socratic
 * rules (never the final answer); the paid modes teach, solve and score in
 * full. Prompts live in tutorPlans.ts so they are testable without a model.
 */

import { TENANT } from "@/lib/types";
import { generateTutorText, type LlmPrecheck } from "@/lib/aiLlm.server";
import type { HomeworkTutorContext } from "@/lib/homeworkTutor.types";
import type { OpenAiChatTurn } from "@/lib/openAi.server";
import { buildTutorSystemPrompt, tutorMaxTokens, type TutorMode } from "@/lib/tutorPlans";

export type { HomeworkTutorContext } from "@/lib/homeworkTutor.types";

export async function replyHomeworkTutor(opts: {
  message: string;
  history?: OpenAiChatTurn[];
  context?: HomeworkTutorContext;
  mode?: TutorMode;
  onDelta?: (text: string) => void;
  precheck?: Promise<LlmPrecheck>;
}) {
  const message = opts.message.trim();
  if (!message) {
    return { ok: false as const, error: "message required", engine: "none" as const };
  }
  const mode: TutorMode = opts.mode ?? "hint";

  return generateTutorText({
    system: buildTutorSystemPrompt(mode, opts.context || {}, TENANT.nameDisplay),
    history: opts.history,
    userMessage: message,
    onDelta: opts.onDelta,
    precheck: opts.precheck,
    maxTokens: tutorMaxTokens(mode),
    promptVersion: mode === "hint" ? "v1" : `v2-${mode}`,
  });
}
