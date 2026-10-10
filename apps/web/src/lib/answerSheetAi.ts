/**
 * Answer-sheet marking — a teacher photographs a child's written answer
 * sheet and gets a SUGGESTED mark per question, to confirm before anything
 * reaches the mark sheet. Pure helpers shared by the scan dialog (types,
 * totals) and the server route (facts, prompt, parse). Built 2026-09-30.
 *
 * The rules, in the order they bite:
 *  - The model sees the paper as the SERVER holds it: question text, max
 *    marks, the publisher's key and the marking scheme. A key sent by the
 *    browser is never used — the route loads the paper itself.
 *  - Question ids are allow-listed to the paper. A reply naming a question
 *    the paper does not have is dropped, not guessed onto a neighbour.
 *  - Every mark is clamped to 0..max and rounded to the half mark the mark
 *    sheet stores (see /api/v1/staff/exams/marks).
 *  - Unknown stays unknown: a question with no key and no marking scheme,
 *    an answer the model could not read, or a question it could not find
 *    on the photographed pages comes back as `null`, never 0. A 0 on the
 *    mark sheet is a claim about the child; null is a claim about us.
 *  - Nothing is saved by the route. The teacher's own numbers go through
 *    the marks grid's normal Save.
 */

import type { ExamPaper, ExamPaperQuestion, ExamPaperQuestionType } from "@/lib/examPapers";

export const ANSWER_SHEET_PROMPT_VERSION = "v1";

/** Pages per scan. A 40-mark paper is 4–6 sides; 8 leaves room for extra sheets. */
export const ANSWER_SHEET_MAX_PAGES = 8;
/** Per page, as base64 characters. A 1600-px JPEG is ~300 KB; 3 MB is a raw phone photo. */
export const ANSWER_SHEET_MAX_PAGE_B64 = 4_000_000;
/** All pages together, as base64 characters — well under Gemini's 20 MB inline limit. */
export const ANSWER_SHEET_MAX_TOTAL_B64 = 14_000_000;
/** More than this and the paper was mis-parsed; the route refuses rather than mark part of it. */
export const ANSWER_SHEET_MAX_QUESTIONS = 80;

export type AnswerSheetConfidence = "high" | "medium" | "low";

export type AnswerSheetQuestionFact = {
  id: string;
  /** The printed number: position in the set, 1-based. */
  number: number;
  type: ExamPaperQuestionType;
  text: string;
  maxMarks: number;
  /** MCQ / assertion-reason choices, as printed. */
  options: string[];
  /** The publisher's (or teacher's) key; null when the paper has none. */
  answerKey: string | null;
  /** Step-wise marking scheme / worked solution; null when there is none. */
  modelAnswer: string | null;
};

export type AnswerSheetFacts = {
  paperTitle: string;
  subjectLabel: string;
  classLabel: string;
  setCode: string;
  /** Sum of the questions' max marks — what the scanned total is out of. */
  maxTotal: number;
  questions: AnswerSheetQuestionFact[];
};

export type AnswerSheetSuggestion = {
  questionId: string;
  number: number;
  maxMarks: number;
  /** What the model read in the child's hand, near-verbatim; "" = nothing read. */
  readAnswer: string;
  /** null = no basis or unreadable — the teacher decides. Never a stand-in 0. */
  suggestedMarks: number | null;
  confidence: AnswerSheetConfidence;
  /** Short, teacher-facing. */
  reason: string;
  /** Shown highlighted and left blank in the review table. */
  needsTeacher: boolean;
};

export type AnswerSheetResult = {
  questions: AnswerSheetSuggestion[];
  /** Sum of the non-null suggestions. */
  totalSuggested: number;
  /** Questions with no suggestion at all. */
  unknownCount: number;
  maxTotal: number;
};

/**
 * Types whose answer is a choice or a word — right or wrong against a key,
 * with no partial credit to argue over. The only ones the model may mark
 * with high confidence.
 */
const OBJECTIVE_TYPES = new Set<ExamPaperQuestionType>([
  "mcq",
  "true_false",
  "fill",
  "match",
  "assertion_reason",
]);

export function isObjectiveType(type: ExamPaperQuestionType): boolean {
  return OBJECTIVE_TYPES.has(type);
}

/** Has the paper given the model anything to mark this question against? */
export function questionHasBasis(q: Pick<AnswerSheetQuestionFact, "answerKey" | "modelAnswer">): boolean {
  return !!(q.answerKey && q.answerKey.trim()) || !!(q.modelAnswer && q.modelAnswer.trim());
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Half marks, like the mark sheet. */
function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

/**
 * The key a question carries, folding in its parts' keys: "Q1. Choose the
 * right answer (any five)" keeps the answers on its sub-questions, and the
 * model needs all of them to mark the question as one.
 */
function keyOf(q: ExamPaperQuestion): string | null {
  const own = q.answerKey.trim();
  const parts = q.subQuestions
    .map((s, i) => (s.answerKey.trim() ? `(${romanLower(i + 1)}) ${s.answerKey.trim()}` : ""))
    .filter(Boolean);
  const all = [own, ...parts].filter(Boolean).join("; ");
  return all ? clip(all, 700) : null;
}

function romanLower(n: number): string {
  const r = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii"];
  return r[n - 1] ?? String(n);
}

function questionText(q: ExamPaperQuestion): string {
  const parts = q.subQuestions.map((s, i) => `(${romanLower(i + 1)}) ${s.text}`);
  const any = q.attemptAny > 0 ? ` [attempt any ${q.attemptAny}]` : "";
  return clip([q.text, ...parts].filter(Boolean).join(" ") + any, 600);
}

/**
 * Facts for one set of one paper, numbered the way the paper prints.
 *
 * Zero-mark questions are left out. They are the importer's mis-splits (a
 * passage filed as a question, one item's statements filed as three — 181
 * of them across the school's papers on 2026-09-18); the paper's total
 * reconciles without them, and a question worth nothing cannot move a mark.
 */
export function answerSheetFactsFromPaper(
  paper: ExamPaper,
  setCode: string,
  labels: { subjectLabel: string; classLabel: string },
): AnswerSheetFacts | null {
  const set = paper.sets.find((s) => s.setCode === setCode) ?? null;
  if (!set) return null;
  const questions: AnswerSheetQuestionFact[] = [];
  let number = 0;
  for (const section of set.sections) {
    for (const q of section.questions) {
      number += 1;
      const maxMarks = Math.max(0, Number(q.marks) || 0);
      if (maxMarks <= 0) continue;
      const scheme = q.markingScheme.map((l) => l.trim()).filter(Boolean).join("\n");
      questions.push({
        id: q.id,
        number,
        type: q.type,
        text: questionText(q),
        maxMarks,
        options: q.options.map((o) => clip(o, 120)).filter(Boolean).slice(0, 8),
        answerKey: keyOf(q),
        modelAnswer: scheme ? clip(scheme, 900) : null,
      });
    }
  }
  if (!questions.length) return null;
  return {
    paperTitle: clip(paper.title || paper.examName || paper.paperCode, 160),
    subjectLabel: clip(labels.subjectLabel, 80),
    classLabel: clip(labels.classLabel, 40),
    setCode: set.setCode,
    maxTotal: roundHalf(questions.reduce((a, q) => a + q.maxMarks, 0)),
    questions,
  };
}

export function buildAnswerSheetSystemPrompt(): string {
  return [
    "You help a school teacher in India mark a child's handwritten exam answer sheet.",
    "You are given photographs of the sheet (one or more pages, in order) and the question paper with its answer key.",
    "For every question listed, find the child's answer on the pages, read it, and suggest marks.",
    "",
    "Rules — these matter more than being helpful:",
    "- Read what the child actually wrote. Copy it near-verbatim into readAnswer, in the script it was written in (Hindi stays Devanagari). Do not correct spelling or fill gaps.",
    '- status "answered": you found and could read an answer. "blank": the answer space for that question is visibly empty or crossed out. "unreadable": something is written but you cannot read it with confidence. "not_found": you cannot find that question on these pages (a page may be missing).',
    '- For "unreadable" and "not_found", marks MUST be null. Never guess a mark you cannot justify from the page.',
    '- For "blank", marks is 0.',
    "- Mark against the answer key and marking scheme given. When the question says it has NO key and NO marking scheme, set marks to null and say so — the teacher will mark it.",
    "- Marks never exceed the question's max and are in steps of 0.5. Give partial credit only where the marking scheme or the key's content supports it.",
    '- confidence: "high" only for an objective answer (choice, true/false, one word) you read clearly and that plainly matches or contradicts the key. "medium" for a clearly-read descriptive answer. "low" whenever the handwriting, the page, or the judgement is uncertain.',
    "- reason: one short sentence for the teacher, in English, e.g. \"Matches key: photosynthesis\" or \"Only 1 of 3 steps shown\". No praise, no advice to the child.",
    "- Use each questionId exactly as given. Do not invent questions. Do not add a total.",
    "",
    'Reply as JSON: {"questions":[{"questionId":"...","status":"answered|blank|unreadable|not_found","readAnswer":"...","marks":number|null,"confidence":"high|medium|low","reason":"..."}]}',
  ].join("\n");
}

export function buildAnswerSheetUserPrompt(facts: AnswerSheetFacts): string {
  const lines: string[] = [
    `Paper: ${facts.paperTitle} — ${facts.subjectLabel}, Class ${facts.classLabel}, Set ${facts.setCode}. Out of ${facts.maxTotal}.`,
    "The photographs above are the child's answer sheet, pages in order.",
    "",
    "Questions:",
  ];
  for (const q of facts.questions) {
    lines.push(`---`);
    lines.push(`questionId: ${q.id}`);
    lines.push(`Q${q.number} (${q.type}, max ${q.maxMarks}): ${q.text}`);
    if (q.options.length) lines.push(`Options: ${q.options.map((o, i) => `(${String.fromCharCode(97 + i)}) ${o}`).join("  ")}`);
    lines.push(q.answerKey ? `Answer key: ${q.answerKey}` : "Answer key: NONE");
    lines.push(q.modelAnswer ? `Marking scheme:\n${q.modelAnswer}` : "Marking scheme: NONE");
    if (!questionHasBasis(q)) lines.push("(No key and no marking scheme — read the answer, but marks must be null.)");
  }
  return lines.join("\n");
}

type RawItem = {
  questionId?: unknown;
  status?: unknown;
  readAnswer?: unknown;
  marks?: unknown;
  confidence?: unknown;
  reason?: unknown;
};

function toMark(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
  return Number.isFinite(n) ? n : null;
}

function toConfidence(v: unknown): AnswerSheetConfidence {
  return v === "high" || v === "medium" ? v : "low";
}

/**
 * Turn whatever the model said into one suggestion per question of the
 * paper, in paper order. Every question gets a row — one the model skipped
 * comes back unknown, so the teacher sees the gap rather than a short list.
 */
export function cleanAnswerSheetSuggestions(raw: unknown, facts: AnswerSheetFacts): AnswerSheetResult {
  const list: RawItem[] = Array.isArray((raw as { questions?: unknown })?.questions)
    ? ((raw as { questions: unknown[] }).questions.filter((x) => x && typeof x === "object") as RawItem[])
    : [];

  // Allow-list: only ids the paper has. First reading of an id wins; a
  // second one for the same question is the model repeating itself.
  const byId = new Map<string, RawItem>();
  const known = new Set(facts.questions.map((q) => q.id));
  for (const item of list) {
    const id = typeof item.questionId === "string" ? item.questionId.trim() : "";
    if (!id || !known.has(id) || byId.has(id)) continue;
    byId.set(id, item);
  }

  const questions = facts.questions.map((q): AnswerSheetSuggestion => {
    const base = { questionId: q.id, number: q.number, maxMarks: q.maxMarks };
    const item = byId.get(q.id);
    if (!item) {
      return {
        ...base,
        readAnswer: "",
        suggestedMarks: null,
        confidence: "low",
        reason: "The AI gave no reading for this question",
        needsTeacher: true,
      };
    }
    const status = typeof item.status === "string" ? item.status.trim().toLowerCase() : "";
    const readAnswer = typeof item.readAnswer === "string" ? clip(item.readAnswer, 400) : "";
    const modelReason = typeof item.reason === "string" ? clip(item.reason, 200) : "";
    let confidence = toConfidence(item.confidence);

    if (status === "not_found") {
      return { ...base, readAnswer: "", suggestedMarks: null, confidence: "low", reason: "Not found on these pages — check for a missing page", needsTeacher: true };
    }
    if (status === "unreadable" || (status !== "blank" && !readAnswer)) {
      return { ...base, readAnswer, suggestedMarks: null, confidence: "low", reason: "Could not read the answer", needsTeacher: true };
    }
    if (status === "blank") {
      // Seeing an empty answer space is a reading, not a judgement against
      // a key, so it holds even without one. Still the teacher's to confirm
      // unless the model was sure: a faint pencil answer photographs blank.
      return { ...base, readAnswer: "", suggestedMarks: 0, confidence, reason: modelReason || "Left blank", needsTeacher: confidence !== "high" };
    }
    if (!questionHasBasis(q)) {
      return { ...base, readAnswer, suggestedMarks: null, confidence: "low", reason: "No answer key for this question — mark it yourself", needsTeacher: true };
    }
    const mark = toMark(item.marks);
    if (mark === null) {
      return { ...base, readAnswer, suggestedMarks: null, confidence: "low", reason: modelReason || "No mark suggested", needsTeacher: true };
    }
    // Only an objective answer can be marked with certainty; a descriptive
    // one is always a judgement the teacher owns.
    if (confidence === "high" && !isObjectiveType(q.type)) confidence = "medium";
    const clamped = roundHalf(Math.min(q.maxMarks, Math.max(0, mark)));
    return {
      ...base,
      readAnswer,
      suggestedMarks: clamped,
      confidence,
      reason: modelReason || (clamped === q.maxMarks ? "Full marks" : "Partial marks"),
      needsTeacher: confidence === "low",
    };
  });

  return {
    questions,
    totalSuggested: sumSuggested(questions),
    unknownCount: questions.filter((q) => q.suggestedMarks === null).length,
    maxTotal: facts.maxTotal,
  };
}

export function sumSuggested(rows: Pick<AnswerSheetSuggestion, "suggestedMarks">[]): number {
  return roundHalf(rows.reduce((a, r) => a + (r.suggestedMarks ?? 0), 0));
}

/** null when the reply is not JSON at all — the caller treats that as a failed call. */
export function parseAnswerSheetReply(text: string, facts: AnswerSheetFacts): AnswerSheetResult | null {
  const t = text.trim().replace(/^```(?:json)?\s*([\s\S]*?)```$/i, "$1").trim();
  let raw: unknown;
  try {
    raw = JSON.parse(t);
  } catch {
    return null;
  }
  if (Array.isArray(raw)) raw = { questions: raw };
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { questions?: unknown }).questions)) return null;
  return cleanAnswerSheetSuggestions(raw, facts);
}

/**
 * The review table's outcome for ai_generations: the teacher's final numbers
 * against what was suggested. A blank the teacher filled is an edit — the
 * suggestion was incomplete — as is any changed number.
 */
export function answerSheetOutcome(
  suggested: Pick<AnswerSheetSuggestion, "questionId" | "suggestedMarks" | "needsTeacher">[],
  final: Map<string, number | null>,
): "accepted" | "edited" {
  for (const s of suggested) {
    const shown = s.needsTeacher ? null : s.suggestedMarks;
    const got = final.get(s.questionId) ?? null;
    if (shown !== got) return "edited";
  }
  return "accepted";
}
