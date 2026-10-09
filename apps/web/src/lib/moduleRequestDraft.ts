/**
 * The module guide turning a conversation into a change request — or asking
 * the one question it still needs first (director, 9 Oct 2026: "either AI
 * recognises it or asks the user what they actually want, and notes it").
 *
 * The model only WRITES the card; nothing it says is acted on. A request is
 * built only after the director approves it (lib/moduleRequests.ts). Prompt
 * and parser are pure so they can be tested without a model.
 */

import type { ModuleRequestKind } from "@/lib/moduleRequests";

export type ModuleRequestDraft =
  | { ready: false; question: string }
  | {
      ready: true;
      kind: ModuleRequestKind;
      title: string;
      problem: string;
      wanted: string;
      suggestion: string;
    };

export function buildModuleRequestSystemPrompt(): string {
  return [
    "You help staff of an Indian school tell the ERP's developer what they need changed on one screen.",
    "Read the conversation. Decide whether you know (a) what is wrong or missing and (b) what the user wants instead.",
    "If either is unclear, ask ONE short, concrete question (in the user's language — Hindi if they wrote Hindi) and stop.",
    "If both are clear, write the request. Describe the change in plain words a developer can build from: which screen, what to add/change, how it should behave. Do not invent requirements the user did not state; do not promise anything.",
    "kind: 'bug' if something that exists is broken, 'change' for a new or different behaviour, 'stuck' if the user could not finish a task and the screen is confusing.",
    "Never include passwords, Aadhaar or bank numbers in the request — refer to them generically.",
    'Reply with JSON only: {"ready":false,"question":"..."} or {"ready":true,"kind":"change|bug|stuck","title":"<= 12 words","problem":"...","wanted":"...","suggestion":"..."}',
  ].join("\n");
}

export function buildModuleRequestUserPrompt(input: {
  pageLabel: string;
  module: string;
  pathname: string;
  tab: string;
  transcript: { role: "user" | "assistant"; text: string }[];
}): string {
  const lines = input.transcript.slice(-12).map((t) => `${t.role === "user" ? "USER" : "GUIDE"}: ${t.text.slice(0, 600)}`);
  return [
    `Screen: ${input.pageLabel || input.pathname} (module ${input.module || "?"}, path ${input.pathname}${input.tab ? `?tab=${input.tab}` : ""})`,
    "Conversation:",
    ...lines,
  ].join("\n");
}

const clip = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

export function parseModuleRequestDraft(text: string): ModuleRequestDraft | null {
  let o: Record<string, unknown>;
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    o = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (o.ready === false) {
    const question = clip(o.question, 400);
    return question ? { ready: false, question } : null;
  }
  if (o.ready !== true) return null;
  const kind = (["change", "bug", "stuck"] as const).find((k) => k === o.kind) ?? "change";
  const title = clip(o.title, 160);
  const problem = clip(o.problem, 2000);
  const wanted = clip(o.wanted, 2000);
  const suggestion = clip(o.suggestion, 4000);
  if (!title || !(problem || wanted) || !suggestion) return null;
  return { ready: true, kind, title, problem, wanted, suggestion };
}
