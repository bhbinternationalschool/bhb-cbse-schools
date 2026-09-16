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
import { buildTutorSystemPrompt, tutorMaxTokens, type TutorLanguage, type TutorMode } from "@/lib/tutorPlans";
import { tutorTextbooksBlock } from "@/lib/tutorSyllabus.server";

export type { HomeworkTutorContext } from "@/lib/homeworkTutor.types";

export async function replyHomeworkTutor(opts: {
  message: string;
  history?: OpenAiChatTurn[];
  context?: HomeworkTutorContext;
  mode?: TutorMode;
  language?: TutorLanguage;
  onDelta?: (text: string) => void;
  precheck?: Promise<LlmPrecheck>;
}) {
  const message = opts.message.trim();
  if (!message) {
    return { ok: false as const, error: "message required", engine: "none" as const };
  }
  const mode: TutorMode = opts.mode ?? "hint";
  const context = opts.context || {};
  // The class's NCERT chapters, when the index has them. For a parent the
  // class is the school's record of the child (tutorApi.server.ts sets it),
  // so the list is the child's own; the subject is the homework's, if any.
  const textbooks = await tutorTextbooksBlock(context);

  return generateTutorText({
    system: buildTutorSystemPrompt(mode, context, TENANT.nameDisplay, opts.language ?? "auto", textbooks),
    history: opts.history,
    userMessage: message,
    onDelta: opts.onDelta,
    precheck: opts.precheck,
    maxTokens: tutorMaxTokens(mode),
    // "-ncert1" marks replies written with the chapter list, so their
    // outcomes can be told apart from those written without it.
    promptVersion: `${mode === "hint" ? "v1" : `v2-${mode}`}${textbooks ? "-ncert1" : ""}`,
  });
}
