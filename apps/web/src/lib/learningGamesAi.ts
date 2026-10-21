/**
 * Game questions drafted by the AI router from ONE chapter of the school's
 * own book — its name and its topic names (school_textbook_chapters.topics),
 * never the book's text (we do not hold it, and must not quote it).
 *
 * The model writes drafts; it decides nothing. Every draft is checked by
 * checkQuestionDraft (2–4 different options, one right answer that is one of
 * them, no "all of the above"), and every one that passes is saved as
 * review = 'pending': no child sees it until a teacher approves it in
 * Games → Question pool. A chapter's name is the only thing the draft is
 * filed under — the model cannot move a question to another chapter.
 *
 * Pure (no I/O) so the self-test can pin the parser.
 */

import { checkQuestionDraft, type QuestionDraft } from "./learningGames";

export const GAME_QUESTIONS_PROMPT_VERSION = "v1";
export const GAME_QUESTIONS_PER_DRAFT = 10;

export type GameQuestionFacts = {
  /** "Class 3", "UKG". */
  className: string;
  grade: number;
  subjectLabel: string;
  bookName: string;
  chapterName: string;
  topics: string[];
  lang: "en" | "hi";
  count: number;
  /**
   * Questions already filed under this chapter (approved, waiting or
   * rejected). The model is told not to repeat them, and the request — so
   * its cache key — changes with them: asking again after rejecting a draft
   * brings new questions, never the cached same ten.
   */
  avoid?: string[];
};

/** At most this many earlier questions go into the prompt. */
export const GAME_QUESTIONS_AVOID_MAX = 40;

export const GAME_QUESTIONS_SYSTEM = [
  "You write short multiple-choice practice questions for an Indian school's learning game, for one chapter of the class's own textbook.",
  "Rules:",
  "- Every question is answerable by a child of that class who has studied the chapter. Simple words. One clear right answer.",
  "- Stay inside the chapter and its topics as listed. Never invent facts, page numbers, story names or characters that are not in the topics.",
  "- 3 or 4 options, all different, short (under 12 words). No 'all of the above', 'none of the above' or 'both'.",
  "- For Nursery, LKG and UKG: picture-style questions using emoji (e.g. 'Which one is a fruit? 🍎 🚗 🏠' with options as words), one idea each, very short.",
  "- Write in the language asked: Hindi questions in Devanagari, English in English.",
  'Answer ONLY with JSON: {"questions":[{"prompt":"...","options":["...","...","..."],"answer":0}]} where answer is the 0-based index of the right option.',
].join("\n");

export function buildGameQuestionsPrompt(f: GameQuestionFacts): string {
  const topics = f.topics
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 15);
  return [
    `Class: ${f.className}`,
    `Subject: ${f.subjectLabel}`,
    `Book: ${f.bookName}`,
    `Chapter: ${f.chapterName}`,
    topics.length ? `Topics in this chapter: ${topics.join("; ")}` : "Topics: (not listed — keep to what the chapter title clearly covers)",
    `Language: ${f.lang === "hi" ? "Hindi (Devanagari)" : "English"}`,
    ...avoidLines(f.avoid),
    `Write ${f.count} questions.`,
  ].join("\n");
}

function avoidLines(avoid: string[] | undefined): string[] {
  const list = [...new Set((avoid ?? []).map((t) => t.replace(/\s+/g, " ").trim().slice(0, 140)).filter(Boolean))].slice(0, GAME_QUESTIONS_AVOID_MAX);
  if (!list.length) return [];
  return ["Already in the pool — do NOT repeat or reword any of these; write different questions:", ...list.map((t) => `- ${t}`)];
}

/** Drafts that are not already in the pool (same question text, ignoring case and spaces). */
export function freshDrafts(drafts: QuestionDraft[], existing: string[]): QuestionDraft[] {
  const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
  const have = new Set(existing.map(norm));
  return drafts.filter((d) => !have.has(norm(d.prompt)));
}

/**
 * The model's reply → the drafts that pass the checks. Returns null (a
 * failed call, retried or reported) when there is no usable JSON or not one
 * question survives.
 */
export function parseGameQuestions(text: string, count: number): QuestionDraft[] | null {
  const m = String(text ?? "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  let body: unknown;
  try {
    body = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const list = Array.isArray((body as { questions?: unknown })?.questions) ? ((body as { questions: unknown[] }).questions as unknown[]) : [];
  const out: QuestionDraft[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const o = (raw ?? {}) as Record<string, unknown>;
    const checked = checkQuestionDraft({
      prompt: typeof o.prompt === "string" ? o.prompt : "",
      options: Array.isArray(o.options) ? o.options.map((x) => String(x ?? "")) : [],
      answerIndex: Number(o.answer),
    });
    if (!checked.ok) continue;
    const key = checked.q.prompt.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(checked.q);
    if (out.length >= count) break;
  }
  return out.length ? out : null;
}
