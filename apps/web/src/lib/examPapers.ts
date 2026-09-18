/**
 * Exam question papers — draft / sets / print codes.
 * Separate blob from marksheets so image-heavy papers stay isolated.
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import { normalizePrintSettings, type ExamPaperPrintSettings } from "@/lib/examPaperPrint";
import { DEFAULT_AY } from "@/lib/masters";
import {
  schoolAddressLine,
  schoolCrestUrl,
  schoolIdentity,
  schoolLogoUrl,
  schoolPrintName,
  schoolShortName,
} from "@/lib/schoolIdentity";
import { TENANT } from "@/lib/types";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";
import { trackServerWork } from "@/lib/serverWork";

export type ExamPaperQuestionType =
  | "mcq"
  | "short"
  | "long"
  | "fill"
  | "true_false"
  | "match"
  | "numerical"
  | "diagram"
  | "primary_picture"
  /** CBSE competency-based formats (weighted since 2023-24 board pattern) */
  | "case_study"
  | "assertion_reason"
  | "competency";

/** Bloom's level a question targets; "" = not tagged. */
export type BloomLevel =
  | "remember"
  | "understand"
  | "apply"
  | "analyse"
  | "evaluate"
  | "create";

export const BLOOM_LEVELS: { code: BloomLevel; label: string }[] = [
  { code: "remember", label: "Remember" },
  { code: "understand", label: "Understand" },
  { code: "apply", label: "Apply" },
  { code: "analyse", label: "Analyse" },
  { code: "evaluate", label: "Evaluate" },
  { code: "create", label: "Create" },
];

export function normalizeBloomLevel(v: unknown): BloomLevel | "" {
  const s = String(v ?? "").trim().toLowerCase().replace("analyze", "analyse");
  return BLOOM_LEVELS.some((b) => b.code === s) ? (s as BloomLevel) : "";
}

export type ExamPaperHardness = "easy" | "medium" | "hard" | "mixed";

export type ExamPaperStatus = "draft" | "ready" | "archived";

/** A numbered pointer on a picture: the dot sits on the part (x, y), the
 * number sits at (lx, ly); all four are fractions of the picture's size so
 * the overlay scales with it on screen and on paper. */
export type ExamPaperImageLabel = {
  n: number;
  x: number;
  y: number;
  lx: number;
  ly: number;
};

export type ExamPaperImage = {
  id: string;
  /** data: URL or https */
  dataUrl: string;
  caption: string;
  /** Pointer lines for "name the parts" questions; [] = plain picture. */
  labels: ExamPaperImageLabel[];
};

export function normalizeImageLabels(list: unknown): ExamPaperImageLabel[] {
  if (!Array.isArray(list)) return [];
  const clamp = (v: unknown) => Math.max(0, Math.min(1, Number(v) || 0));
  return list
    .map((l, i) => {
      const o = (l ?? {}) as Partial<ExamPaperImageLabel>;
      return { n: Math.max(1, Math.floor(Number(o.n) || i + 1)), x: clamp(o.x), y: clamp(o.y), lx: clamp(o.lx), ly: clamp(o.ly) };
    })
    .slice(0, 30);
}

/**
 * How many columns MCQ options print in when the teacher leaves it on
 * "auto": long options one per line, short ones side by side, up to five
 * for one-word answers — so "(a) 4 (b) 8 (c) 16 (d) 32" sits on one line
 * and a sentence-length option never squeezes.
 */
export function autoOptionColumns(options: string[]): 1 | 2 | 3 | 4 | 5 {
  const longest = options.reduce((m, o) => Math.max(m, o.trim().length), 0);
  if (longest > 40) return 1;
  if (longest > 22) return 2;
  if (longest > 12) return 3;
  if (longest > 6) return 4;
  return 5;
}

export type ExamPaperQuestion = {
  id: string;
  type: ExamPaperQuestionType;
  text: string;
  marks: number;
  /** Optional MCQ / match options */
  options: string[];
  /** Teacher key (not printed on student copy) */
  answerKey: string;
  /** LaTeX or unicode formula lines */
  formulas: string[];
  images: ExamPaperImage[];
  /** Primary-friendly icon/emoji hints */
  icons: string[];
  hardness: Exclude<ExamPaperHardness, "mixed">;
  /** Source: teacher typed / AI suggested / imported */
  source: "manual" | "ai" | "bank";
  /** CBSE learning-outcome / competency code this item assesses; "" = untagged */
  competencyCode: string;
  /** SyllabusUnit (chapter/topic) this item is drawn from; "" = not linked */
  unitId: string;
  bloomLevel: BloomLevel | "";
  /** Step-wise marking scheme for the teacher copy, one step per line; [] = answer key only */
  markingScheme: string[];
  /** match: Column A → Column B pairs (printed with Column B shuffled). */
  pairs: { left: string; right: string }[];
  /** Numbered parts (i), (ii)… under the question, each with its own type,
   * marks, options and key — "Q1. Choose the right answer (any five)". */
  subQuestions: ExamSubQuestion[];
  /** "Attempt any N of the following"; 0 = all parts compulsory. */
  attemptAny: number;
  /** Ruled answer lines printed under the question on the student copy; 0 = none. */
  answerLines: number;
  /** Columns the options print in; 0 = auto by option length. */
  optionColumns: 0 | 1 | 2 | 3 | 4 | 5;
  /** Columns the pictures print in (rows wrap). */
  imageColumns: 1 | 2 | 3;
};

/** The four CBSE Assertion–Reason choices, in the board's order. */
export const ASSERTION_REASON_OPTIONS: string[] = [
  "Both A and R are true and R is the correct explanation of A",
  "Both A and R are true but R is not the correct explanation of A",
  "A is true but R is false",
  "A is false but R is true",
];

/** Ruled lines a type normally needs on the student copy. */
export function defaultAnswerLines(type: ExamPaperQuestionType): number {
  switch (type) {
    case "short":
      return 3;
    case "long":
      return 8;
    case "numerical":
      return 5;
    case "competency":
      return 5;
    case "diagram":
      return 2;
    default:
      return 0;
  }
}

/**
 * What a question should carry once its type is chosen — the shape each
 * type needs, so the editor opens with the right fields instead of a bare
 * text box. Existing content is kept; only missing structure is added.
 */
export function defaultsForType(
  type: ExamPaperQuestionType,
  q: Pick<ExamPaperQuestion, "options" | "pairs" | "subQuestions" | "answerLines" | "answerKey" | "text">,
): Partial<ExamPaperQuestion> {
  const patch: Partial<ExamPaperQuestion> = { type };
  // Structure the new type does not use is dropped, so a former Match
  // question does not print stray pairs. Parts (i), (ii)… belong to any
  // type, so a type change never throws them away.
  if (type !== "match" && q.pairs.length) patch.pairs = [];
  if (!["mcq", "assertion_reason", "fill", "diagram"].includes(type) && q.options.length) patch.options = [];
  switch (type) {
    case "mcq":
      if (q.options.length < 2) patch.options = ["", "", "", ""];
      break;
    case "assertion_reason":
      patch.options = ASSERTION_REASON_OPTIONS;
      if (!/Assertion \(A\)/.test(q.text)) patch.text = q.text ? `Assertion (A): ${q.text}\nReason (R): ` : "Assertion (A): \nReason (R): ";
      break;
    case "true_false":
      if (q.answerKey !== "True" && q.answerKey !== "False") patch.answerKey = "True";
      patch.options = [];
      break;
    case "match":
      if (q.pairs.length < 2) patch.pairs = [{ left: "", right: "" }, { left: "", right: "" }, { left: "", right: "" }, { left: "", right: "" }];
      break;
    case "case_study":
      if (q.subQuestions.length === 0) patch.subQuestions = [emptySubQuestion("short", 1), emptySubQuestion("short", 1), emptySubQuestion("short", 2)];
      break;
    case "fill":
      if (!q.text.includes("___")) patch.text = q.text ? `${q.text} ___` : "";
      break;
    default:
      break;
  }
  if (q.answerLines === 0 && defaultAnswerLines(type) > 0) patch.answerLines = defaultAnswerLines(type);
  return patch;
}

/**
 * Total marks of a question with parts: their sum, or — with "attempt any
 * N" — the N largest, since a child answering the best-paying parts can
 * score at most that.
 */
/* ─── Hinglish → Hindi / Sanskrit, for one question ──────────── */

/**
 * Every piece of a question that a teacher types and a student reads.
 *
 * Built as ONE ordered list so the model gets one call and the answers come
 * back in a known order; `applyTransliteratedQuestion` puts them back in the
 * same order. The pairing is what makes the round trip safe, and it is the
 * reason both live here rather than inside the panel.
 *
 * Until 2026-09-16 this list was the question's own text, options, pairs,
 * sub-question TEXT and answer key — so a question built from parts (PR
 * #226: parts carry their own options, pairs and key) came back with the
 * heading in Hindi and every option under it still in Hinglish, and the
 * pictures kept their English captions. Half-converted reads as broken.
 */
export function questionTransliterationTexts(
  q: Pick<
    ExamPaperQuestion,
    "text" | "options" | "pairs" | "subQuestions" | "answerKey" | "images" | "formulas" | "markingScheme"
  >,
): string[] {
  return [
    q.text,
    ...q.options,
    ...q.pairs.flatMap((pr) => [pr.left, pr.right]),
    ...q.subQuestions.flatMap((sq) => [
      sq.text,
      ...sq.options,
      ...sq.pairs.flatMap((pr) => [pr.left, pr.right]),
      sq.answerKey,
    ]),
    q.answerKey,
    ...q.images.map((img) => img.caption),
    ...q.markingScheme,
  ];
}

/** Put the converted lines back, in the order `questionTransliterationTexts` sent them. */
export function applyTransliteratedQuestion(
  q: Pick<
    ExamPaperQuestion,
    "text" | "options" | "pairs" | "subQuestions" | "answerKey" | "images" | "formulas" | "markingScheme"
  >,
  out: string[],
): Pick<
  ExamPaperQuestion,
  "text" | "options" | "pairs" | "subQuestions" | "answerKey" | "images" | "markingScheme"
> {
  const expected = questionTransliterationTexts(q).length;
  if (out.length !== expected) {
    throw new Error(
      `Converted ${out.length} lines for a question that sent ${expected} — refusing to shuffle the paper`,
    );
  }
  let i = 0;
  const text = out[i++]!;
  const options = q.options.map(() => out[i++]!);
  const pairs = q.pairs.map(() => ({ left: out[i++]!, right: out[i++]! }));
  const subQuestions = q.subQuestions.map((sq) => ({
    ...sq,
    text: out[i++]!,
    options: sq.options.map(() => out[i++]!),
    pairs: sq.pairs.map(() => ({ left: out[i++]!, right: out[i++]! })),
    answerKey: out[i++]!,
  }));
  const answerKey = out[i++]!;
  const images = q.images.map((img) => ({ ...img, caption: out[i++]! }));
  const markingScheme = q.markingScheme.map(() => out[i++]!);
  return { text, options, pairs, subQuestions, answerKey, images, markingScheme };
}

/**
 * Is there anything on this question worth converting?
 *
 * The buttons used to be disabled on `!q.text.trim()` alone, so a question
 * that is only a heading for its parts — an empty own text, which is how
 * "Answer any five of the following" is built — had both buttons dead. The
 * teacher pressed them and nothing happened at all.
 */
export function questionHasConvertibleText(
  q: Parameters<typeof questionTransliterationTexts>[0],
): boolean {
  return questionTransliterationTexts(q).some((t) => t.trim().length > 0);
}

export function questionTotalMarks(q: Pick<ExamPaperQuestion, "marks" | "subQuestions"> & { attemptAny?: number }): number {
  if (q.subQuestions.length === 0) return q.marks;
  const marks = q.subQuestions.map((sq) => sq.marks || 0);
  const n = q.attemptAny ?? 0;
  if (n > 0 && n < marks.length) {
    return [...marks].sort((a, b) => b - a).slice(0, n).reduce((sum, m) => sum + m, 0);
  }
  return marks.reduce((sum, m) => sum + m, 0);
}

/** Deterministic shuffle of Column B for a match question — the same
 * order on every print of the same paper, never the answer order. */
export function shuffledMatchRights(pairs: { left: string; right: string }[], seed: string): string[] {
  const rights = pairs.map((p) => p.right);
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const out = [...rights];
  for (let i = out.length - 1; i > 0; i--) {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  // A shuffle that leaves everything in place is no shuffle; rotate once.
  if (out.length > 1 && out.every((r, i) => r === rights[i])) out.push(out.shift()!);
  return out;
}

/** "1-c, 2-a, 3-d, 4-b" for the teacher copy, against the printed order. */
export function matchAnswerKey(pairs: { left: string; right: string }[], printedRights: string[]): string {
  return pairs
    .map((p, i) => {
      const j = printedRights.indexOf(p.right);
      return `${i + 1}-${j >= 0 ? String.fromCharCode(97 + j) : "?"}`;
    })
    .join(", ");
}

/** Every type a main question can take, a part can take too. Pictures
 * stay on the main question (a part with a picture is the question's
 * picture with the part's labels). */
export const SUB_QUESTION_TYPES: ExamPaperQuestionType[] = [
  "short",
  "mcq",
  "true_false",
  "fill",
  "match",
  "long",
  "numerical",
  "assertion_reason",
  "diagram",
  "primary_picture",
  "case_study",
  "competency",
];

export type ExamSubQuestion = {
  text: string;
  marks: number;
  type: ExamPaperQuestionType;
  /** mcq / assertion_reason options, (a) (b) (c)…; word bank for fill; labels for diagram. */
  options: string[];
  /** match: Column A → Column B pairs, printed with Column B shuffled. */
  pairs: { left: string; right: string }[];
  /** Teacher key: the correct option text, True/False, the blanks, the answer. */
  answerKey: string;
};

export function normalizeSubQuestion(x: unknown): ExamSubQuestion {
  const o = (x ?? {}) as Partial<ExamSubQuestion>;
  const type = SUB_QUESTION_TYPES.includes(o.type as ExamPaperQuestionType) ? (o.type as ExamPaperQuestionType) : "short";
  return {
    text: String(o.text ?? "").trim(),
    marks: Math.max(0, Number(o.marks) || 0),
    type,
    options: Array.isArray(o.options) ? o.options.map((v) => String(v ?? "")).slice(0, 8) : [],
    pairs: Array.isArray(o.pairs)
      ? o.pairs
          .map((x) => ({ left: String(x?.left ?? "").trim(), right: String(x?.right ?? "").trim() }))
          .filter((x) => x.left || x.right)
          .slice(0, 8)
      : [],
    answerKey: String(o.answerKey ?? "").trim(),
  };
}

/** A fresh part of the given type, with the structure that type needs. */
export function emptySubQuestion(type: ExamPaperQuestionType = "short", marks = 1): ExamSubQuestion {
  const t = SUB_QUESTION_TYPES.includes(type) ? type : "short";
  return {
    text: "",
    marks,
    type: t,
    options: t === "mcq" ? ["", "", "", ""] : t === "assertion_reason" ? ASSERTION_REASON_OPTIONS : [],
    pairs: t === "match" ? [{ left: "", right: "" }, { left: "", right: "" }, { left: "", right: "" }, { left: "", right: "" }] : [],
    answerKey: t === "true_false" ? "True" : "",
  };
}

export type ExamPaperSection = {
  id: string;
  title: string;
  instructions: string;
  questions: ExamPaperQuestion[];
};

/**
 * Where an imported set came from.
 *
 * A set built here by a teacher has none of this. A set that arrived as a
 * Word file from the school's content publisher keeps its original beside
 * the parsed questions, for two reasons: a teacher can print the publisher's
 * own layout when the parse has lost a table or a picture, and `fileHash` is
 * what makes re-importing the same folder a no-op instead of a second copy.
 */
export type ExamPaperSetSource = {
  /** The file as the publisher named it. */
  fileName: string;
  /** Path inside `school-files`; served through `/api/file`. */
  filePath: string;
  /** What to open to read the original — an `/api/file/...` path. */
  fileUrl: string;
  /** sha-256 of the original file, hex. */
  fileHash: string;
  /** The publisher's own name for this set, e.g. "Summative Assessment 1 - Set 3". */
  publisherLabel: string;
  importedAt: string;
  importedBy: string;
};

export type ExamPaperSet = {
  id: string;
  /** A / B / C / D — school picks one on exam day */
  setCode: string;
  label: string;
  sections: ExamPaperSection[];
  /** null for a set written on this desk; see ExamPaperSetSource. */
  source: ExamPaperSetSource | null;
};

export type ExamPaperPrintEvent = {
  id: string;
  at: string;
  by: string;
  /** Copies requested this print */
  count: number;
  setCode: string;
};

export type ExamPaper = {
  id: string;
  /** Unique reference e.g. EP-2025-26-UT1-VI-MATH-A7K2 */
  paperCode: string;
  academicYearCode: string;
  examTermId: string;
  classId: string;
  subjectId: string;
  title: string;
  /** Shown under school name */
  examName: string;
  durationMinutes: number;
  maxMarks: number;
  hardness: ExamPaperHardness;
  /** SyllabusUnit ids (chapters/topics) this paper covers; [] = whole subject */
  unitIds: string[];
  generalInstructions: string;
  status: ExamPaperStatus;
  sets: ExamPaperSet[];
  /** Which set to print / use on exam day */
  activeSetCode: string;
  printLog: ExamPaperPrintEvent[];
  /** Page size, fold layout, type size and language of the printed paper. */
  print: ExamPaperPrintSettings;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
};

/**
 * A reusable question with the metadata that makes it findable: which
 * masters class/subject it suits, its unit / LO code / Bloom / type /
 * marks (all on the question itself) and free tags. Bank items are copied
 * *into* papers (new question id, source "bank"), never referenced — a
 * later edit to the bank must not silently change a printed paper.
 */
export type BankQuestion = {
  id: string;
  classId: string;
  subjectId: string;
  question: ExamPaperQuestion;
  tags: string[];
  addedBy: string;
  addedAt: string;
  /** Times pulled into a paper — helps rotate items across years */
  usedCount: number;
  lastUsedAt: string;
};

export type BlueprintHardness = ExamPaperHardness;

/** One cell of the blueprint matrix: "3 × 2-mark competency items from Ch 3 (M802), medium". */
export type ExamBlueprintRow = {
  id: string;
  /** SyllabusUnit id; "" = anywhere in the subject */
  unitId: string;
  questionType: ExamPaperQuestionType;
  /** Marks per question */
  marks: number;
  count: number;
  hardness: BlueprintHardness;
  /** LO code the items should assess; "" = untagged */
  competencyCode: string;
};

export type ExamBlueprint = {
  id: string;
  academicYearCode: string;
  classId: string;
  subjectId: string;
  /** "" = generic for the subject; else the exam term it was designed for */
  examTermId: string;
  title: string;
  rows: ExamBlueprintRow[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type ExamPapersState = {
  version: 1;
  papers: ExamPaper[];
  /** Question bank — desk slice "bank" */
  bank: BankQuestion[];
  /** Blueprints — desk slice "blueprints" */
  blueprints: ExamBlueprint[];
  /**
   * What the school has taught the paper importer about its publisher's
   * words — `{"subjects":{"understanding our world":"WAU"}}`. Kept with the
   * papers rather than in one browser, so next term's download is understood
   * on whichever machine opens it. Shape is `ImportMappings` from
   * `examPaperImport`; typed loosely here to keep that module free of this one.
   */
  importMappings: {
    classes?: Record<string, string>;
    subjects?: Record<string, string>;
    exams?: Record<string, string>;
  };
};

const STORAGE_KEY = "bhb_exam_papers_v1";

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso() {
  return new Date().toISOString();
}

export const QUESTION_TYPES: {
  code: ExamPaperQuestionType;
  label: string;
  short: string;
}[] = [
  { code: "mcq", label: "Multiple choice", short: "MCQ" },
  { code: "short", label: "Short answer", short: "SA" },
  { code: "long", label: "Long / essay", short: "LA" },
  { code: "fill", label: "Fill in the blanks", short: "Fill" },
  { code: "true_false", label: "True / False", short: "T/F" },
  { code: "match", label: "Match the following", short: "Match" },
  { code: "numerical", label: "Numerical / sum", short: "Num" },
  { code: "diagram", label: "Diagram / label", short: "Diag" },
  { code: "primary_picture", label: "Picture (primary)", short: "Pic" },
  { code: "case_study", label: "Case study / source-based", short: "Case" },
  { code: "assertion_reason", label: "Assertion–Reason", short: "A–R" },
  { code: "competency", label: "Competency (application / HOTS)", short: "Comp" },
];

export const HARDNESS_LEVELS: {
  code: ExamPaperHardness;
  label: string;
}[] = [
  { code: "easy", label: "Easy" },
  { code: "medium", label: "Medium" },
  { code: "hard", label: "Hard" },
  { code: "mixed", label: "Mixed" },
];

/** Icon suggestions for primary / early grades */
export const PRIMARY_ICON_BANK: { icon: string; label: string }[] = [
  { icon: "🍎", label: "Apple" },
  { icon: "🍌", label: "Banana" },
  { icon: "🐶", label: "Dog" },
  { icon: "🐱", label: "Cat" },
  { icon: "🌳", label: "Tree" },
  { icon: "🌸", label: "Flower" },
  { icon: "☀️", label: "Sun" },
  { icon: "🌙", label: "Moon" },
  { icon: "⭐", label: "Star" },
  { icon: "🏠", label: "House" },
  { icon: "🚌", label: "Bus" },
  { icon: "📚", label: "Books" },
  { icon: "✏️", label: "Pencil" },
  { icon: "🔢", label: "Numbers" },
  { icon: "➕", label: "Plus" },
  { icon: "➖", label: "Minus" },
  { icon: "🔺", label: "Triangle" },
  { icon: "⬜", label: "Square" },
  { icon: "🔵", label: "Circle" },
  { icon: "💧", label: "Water" },
  { icon: "🔥", label: "Fire" },
  { icon: "🌱", label: "Plant" },
  { icon: "🦋", label: "Butterfly" },
  { icon: "🐦", label: "Bird" },
  { icon: "🐟", label: "Fish" },
  { icon: "👨‍👩‍👧", label: "Family" },
  { icon: "🏫", label: "School" },
  { icon: "🇮🇳", label: "India" },
];

/** Quick formula / symbol inserts for Maths / Science / Physics */
export const FORMULA_PALETTE: { insert: string; label: string; group: string }[] =
  [
    { insert: "√", label: "√", group: "Maths" },
    { insert: "π", label: "π", group: "Maths" },
    { insert: "∞", label: "∞", group: "Maths" },
    { insert: "±", label: "±", group: "Maths" },
    { insert: "≤", label: "≤", group: "Maths" },
    { insert: "≥", label: "≥", group: "Maths" },
    { insert: "≠", label: "≠", group: "Maths" },
    { insert: "×", label: "×", group: "Maths" },
    { insert: "÷", label: "÷", group: "Maths" },
    { insert: "°", label: "°", group: "Maths" },
    { insert: "θ", label: "θ", group: "Maths" },
    { insert: "Δ", label: "Δ", group: "Maths" },
    { insert: "a² + b² = c²", label: "Pythagoras", group: "Maths" },
    { insert: "(a+b)² = a²+2ab+b²", label: "(a+b)²", group: "Maths" },
    { insert: "x = (-b ± √(b²-4ac)) / 2a", label: "Quadratic", group: "Maths" },
    { insert: "v = u + at", label: "v=u+at", group: "Physics" },
    { insert: "s = ut + ½at²", label: "s=ut+½at²", group: "Physics" },
    { insert: "v² = u² + 2as", label: "v²=u²+2as", group: "Physics" },
    { insert: "F = ma", label: "F=ma", group: "Physics" },
    { insert: "W = Fd", label: "W=Fd", group: "Physics" },
    { insert: "P = W/t", label: "P=W/t", group: "Physics" },
    { insert: "E = mc²", label: "E=mc²", group: "Physics" },
    { insert: "V = IR", label: "Ohm", group: "Physics" },
    { insert: "H₂O", label: "Water", group: "Chemistry" },
    { insert: "CO₂", label: "CO₂", group: "Chemistry" },
    { insert: "NaCl", label: "Salt", group: "Chemistry" },
    { insert: "O₂", label: "Oxygen", group: "Chemistry" },
    { insert: "pH", label: "pH", group: "Chemistry" },
    { insert: "Photosynthesis: 6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂", label: "Photosynthesis", group: "Biology" },
    { insert: "Respiration: C₆H₁₂O₆ + 6O₂ → 6CO₂ + 6H₂O + energy", label: "Respiration", group: "Biology" },
  ];

export function emptyExamPapersState(): ExamPapersState {
  return { version: 1, papers: [], bank: [], blueprints: [], importMappings: {} };
}

export function emptyQuestion(
  partial?: Partial<ExamPaperQuestion>,
): ExamPaperQuestion {
  return {
    id: partial?.id || nid("q"),
    type: partial?.type || "short",
    text: partial?.text || "",
    marks: typeof partial?.marks === "number" ? partial.marks : 1,
    options: Array.isArray(partial?.options) ? partial!.options : [],
    answerKey: partial?.answerKey || "",
    formulas: Array.isArray(partial?.formulas) ? partial!.formulas : [],
    images: Array.isArray(partial?.images) ? partial!.images : [],
    icons: Array.isArray(partial?.icons) ? partial!.icons : [],
    hardness: partial?.hardness || "medium",
    source: partial?.source || "manual",
    competencyCode: partial?.competencyCode || "",
    unitId: partial?.unitId || "",
    bloomLevel: normalizeBloomLevel(partial?.bloomLevel),
    markingScheme: Array.isArray(partial?.markingScheme)
      ? partial!.markingScheme.map(String).filter(Boolean)
      : [],
    pairs: Array.isArray(partial?.pairs)
      ? partial!.pairs.map((x) => ({ left: String(x?.left ?? ""), right: String(x?.right ?? "") }))
      : [],
    subQuestions: Array.isArray(partial?.subQuestions)
      ? partial!.subQuestions.map((x) => normalizeSubQuestion(x))
      : [],
    attemptAny: Math.max(0, Math.min(20, Math.floor(Number(partial?.attemptAny) || 0))),
    answerLines: Math.max(0, Math.min(40, Math.floor(Number(partial?.answerLines) || 0))),
    optionColumns: ([0, 1, 2, 3, 4, 5] as const).includes(partial?.optionColumns as 0) ? (partial!.optionColumns as 0) : 0,
    imageColumns: ([1, 2, 3] as const).includes(partial?.imageColumns as 1) ? (partial!.imageColumns as 1) : 1,
  };
}

export function emptySection(
  partial?: Partial<ExamPaperSection>,
): ExamPaperSection {
  return {
    id: partial?.id || nid("sec"),
    title: partial?.title || "Section A",
    instructions: partial?.instructions || "",
    questions: Array.isArray(partial?.questions)
      ? partial!.questions.map((q) => emptyQuestion(q))
      : [],
  };
}

export function emptySet(partial?: Partial<ExamPaperSet>): ExamPaperSet {
  return {
    id: partial?.id || nid("set"),
    setCode: (partial?.setCode || "A").toUpperCase().slice(0, 1),
    label: partial?.label || `Set ${partial?.setCode || "A"}`,
    sections: Array.isArray(partial?.sections)
      ? partial!.sections.map((s) => emptySection(s))
      : [emptySection({ title: "Section A" })],
    source: normalizeSetSource(partial?.source),
  };
}

/**
 * A source is only worth keeping if it can still be opened and still
 * identifies the file — a half-filled one would claim provenance the desk
 * cannot honour, so it becomes "written here" instead.
 */
export function normalizeSetSource(
  raw: Partial<ExamPaperSetSource> | null | undefined,
): ExamPaperSetSource | null {
  if (!raw || !raw.filePath || !raw.fileHash) return null;
  return {
    fileName: String(raw.fileName || "").slice(0, 200),
    filePath: String(raw.filePath),
    fileUrl: String(raw.fileUrl || ""),
    fileHash: String(raw.fileHash),
    publisherLabel: String(raw.publisherLabel || "").slice(0, 200),
    importedAt: String(raw.importedAt || nowIso()),
    importedBy: String(raw.importedBy || ""),
  };
}

function normalizeImage(img: Partial<ExamPaperImage>): ExamPaperImage | null {
  if (!img.dataUrl) return null;
  return {
    id: img.id || nid("img"),
    dataUrl: img.dataUrl,
    caption: img.caption || "",
    labels: normalizeImageLabels(img.labels),
  };
}

function normalizeQuestion(
  q: Partial<ExamPaperQuestion>,
): ExamPaperQuestion | null {
  if (!q) return null;
  const type = QUESTION_TYPES.some((t) => t.code === q.type)
    ? (q.type as ExamPaperQuestionType)
    : "short";
  const hardness =
    q.hardness === "easy" || q.hardness === "hard" || q.hardness === "medium"
      ? q.hardness
      : "medium";
  return {
    id: q.id || nid("q"),
    type,
    text: q.text || "",
    marks: Math.max(0, Number(q.marks) || 0),
    options: Array.isArray(q.options)
      ? q.options.map((o) => String(o || ""))
      : [],
    answerKey: q.answerKey || "",
    formulas: Array.isArray(q.formulas)
      ? q.formulas.map((f) => String(f || "")).filter(Boolean)
      : [],
    images: Array.isArray(q.images)
      ? q.images
          .map(normalizeImage)
          .filter((x): x is ExamPaperImage => !!x)
      : [],
    icons: Array.isArray(q.icons)
      ? q.icons.map((i) => String(i || "")).filter(Boolean)
      : [],
    hardness,
    source: q.source === "ai" || q.source === "bank" ? q.source : "manual",
    competencyCode: String(q.competencyCode || "").trim().slice(0, 40),
    unitId: String(q.unitId || ""),
    bloomLevel: normalizeBloomLevel(q.bloomLevel),
    markingScheme: Array.isArray(q.markingScheme)
      ? q.markingScheme.map((m) => String(m || "").trim()).filter(Boolean)
      : [],
    pairs: Array.isArray(q.pairs)
      ? q.pairs
          .map((x) => ({ left: String(x?.left ?? "").trim(), right: String(x?.right ?? "").trim() }))
          .filter((x) => x.left || x.right)
      : [],
    subQuestions: Array.isArray(q.subQuestions)
      ? q.subQuestions.map((x) => normalizeSubQuestion(x)).filter((x) => x.text)
      : [],
    attemptAny: Math.max(0, Math.min(20, Math.floor(Number(q.attemptAny) || 0))),
    answerLines: Math.max(0, Math.min(40, Math.floor(Number(q.answerLines) || 0))),
    optionColumns: ([0, 1, 2, 3, 4, 5] as const).includes(q.optionColumns as 0) ? (q.optionColumns as 0) : 0,
    imageColumns: ([1, 2, 3] as const).includes(q.imageColumns as 1) ? (q.imageColumns as 1) : 1,
  };
}

function normalizeSection(
  s: Partial<ExamPaperSection>,
): ExamPaperSection | null {
  if (!s) return null;
  return {
    id: s.id || nid("sec"),
    title: s.title || "Section",
    instructions: s.instructions || "",
    questions: Array.isArray(s.questions)
      ? s.questions
          .map(normalizeQuestion)
          .filter((x): x is ExamPaperQuestion => !!x)
      : [],
  };
}

function normalizeSet(s: Partial<ExamPaperSet>): ExamPaperSet | null {
  if (!s) return null;
  const setCode = (s.setCode || "A").toUpperCase().slice(0, 1) || "A";
  return {
    id: s.id || nid("set"),
    setCode,
    label: s.label || `Set ${setCode}`,
    sections: Array.isArray(s.sections)
      ? s.sections
          .map(normalizeSection)
          .filter((x): x is ExamPaperSection => !!x)
      : [emptySection()],
    source: normalizeSetSource(s.source),
  };
}

function normalizePrint(e: Partial<ExamPaperPrintEvent>): ExamPaperPrintEvent | null {
  if (!e?.at) return null;
  return {
    id: e.id || nid("prt"),
    at: e.at,
    by: e.by || "",
    count: Math.max(1, Math.floor(Number(e.count) || 1)),
    setCode: (e.setCode || "A").toUpperCase().slice(0, 1),
  };
}

export function normalizePaper(p: Partial<ExamPaper>): ExamPaper | null {
  if (!p) return null;
  const sets = Array.isArray(p.sets)
    ? p.sets.map(normalizeSet).filter((x): x is ExamPaperSet => !!x)
    : [];
  if (!sets.length) sets.push(emptySet({ setCode: "A" }));
  const status: ExamPaperStatus =
    p.status === "ready" || p.status === "archived" ? p.status : "draft";
  const hardness: ExamPaperHardness = HARDNESS_LEVELS.some(
    (h) => h.code === p.hardness,
  )
    ? (p.hardness as ExamPaperHardness)
    : "mixed";
  return {
    id: p.id || nid("ep"),
    paperCode: p.paperCode || provisionalPaperCode(),
    academicYearCode: p.academicYearCode || DEFAULT_AY,
    examTermId: p.examTermId || "",
    classId: p.classId || "",
    subjectId: p.subjectId || "",
    title: p.title || "Question Paper",
    examName: p.examName || "",
    durationMinutes: Math.max(0, Math.floor(Number(p.durationMinutes) || 0)),
    maxMarks: Math.max(0, Math.floor(Number(p.maxMarks) || 0)),
    hardness,
    unitIds: Array.isArray(p.unitIds) ? p.unitIds.map(String).filter(Boolean) : [],
    generalInstructions:
      p.generalInstructions ||
      "1. All questions are compulsory.\n2. Read each question carefully.\n3. Write neatly.",
    status,
    sets,
    activeSetCode: (p.activeSetCode || sets[0]!.setCode).toUpperCase().slice(0, 1),
    printLog: Array.isArray(p.printLog)
      ? p.printLog
          .map(normalizePrint)
          .filter((x): x is ExamPaperPrintEvent => !!x)
      : [],
    print: normalizePrintSettings(p.print),
    createdBy: p.createdBy || "",
    createdAt: p.createdAt || nowIso(),
    updatedAt: p.updatedAt || nowIso(),
    updatedBy: p.updatedBy || "",
  };
}

export function normalizeExamPapersState(raw: unknown): ExamPapersState {
  if (!raw || typeof raw !== "object") return emptyExamPapersState();
  const p = raw as Partial<ExamPapersState>;
  return {
    version: 1,
    papers: Array.isArray(p.papers)
      ? p.papers.map(normalizePaper).filter((x): x is ExamPaper => !!x)
      : [],
    bank: Array.isArray(p.bank)
      ? p.bank.map(normalizeBankQuestion).filter((x): x is BankQuestion => !!x)
      : [],
    blueprints: Array.isArray(p.blueprints)
      ? p.blueprints.map(normalizeBlueprint).filter((x): x is ExamBlueprint => !!x)
      : [],
    importMappings: normalizeImportMappingsBlob(p.importMappings),
  };
}

function normalizeMappingTable(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(k ?? "").trim().toLowerCase();
    const value = String(v ?? "").trim();
    if (key && value) out[key] = value.slice(0, 60);
  }
  return out;
}

function normalizeImportMappingsBlob(
  raw: ExamPapersState["importMappings"] | undefined,
): ExamPapersState["importMappings"] {
  if (!raw || typeof raw !== "object") return {};
  return {
    classes: normalizeMappingTable(raw.classes),
    subjects: normalizeMappingTable(raw.subjects),
    exams: normalizeMappingTable(raw.exams),
  };
}

function normalizeBankQuestion(b: Partial<BankQuestion>): BankQuestion | null {
  if (!b || !b.question) return null;
  const question = normalizeQuestion(b.question);
  if (!question || !question.text.trim()) return null;
  return {
    id: b.id || nid("bq"),
    classId: String(b.classId || ""),
    subjectId: String(b.subjectId || ""),
    question,
    tags: Array.isArray(b.tags) ? b.tags.map((t) => String(t || "").trim()).filter(Boolean).slice(0, 12) : [],
    addedBy: String(b.addedBy || ""),
    addedAt: b.addedAt || nowIso(),
    usedCount: Math.max(0, Math.floor(Number(b.usedCount) || 0)),
    lastUsedAt: String(b.lastUsedAt || ""),
  };
}

function normalizeBlueprintRow(r: Partial<ExamBlueprintRow>): ExamBlueprintRow | null {
  if (!r) return null;
  const questionType = QUESTION_TYPES.some((t) => t.code === r.questionType)
    ? (r.questionType as ExamPaperQuestionType)
    : "short";
  const marks = Math.max(0, Number(r.marks) || 0);
  const count = Math.max(0, Math.floor(Number(r.count) || 0));
  if (marks <= 0 || count <= 0) return null;
  const hardness: BlueprintHardness = HARDNESS_LEVELS.some((h) => h.code === r.hardness)
    ? (r.hardness as BlueprintHardness)
    : "mixed";
  return {
    id: r.id || nid("bpr"),
    unitId: String(r.unitId || ""),
    questionType,
    marks,
    count,
    hardness,
    competencyCode: String(r.competencyCode || "").trim().toUpperCase().slice(0, 40),
  };
}

function normalizeBlueprint(b: Partial<ExamBlueprint>): ExamBlueprint | null {
  // A blueprint without its session is not a blueprint — never invent the year.
  if (!b || !b.classId || !b.subjectId || !b.academicYearCode) return null;
  return {
    id: b.id || nid("bp"),
    academicYearCode: b.academicYearCode,
    classId: String(b.classId),
    subjectId: String(b.subjectId),
    examTermId: String(b.examTermId || ""),
    title: String(b.title || "Blueprint"),
    rows: Array.isArray(b.rows)
      ? b.rows.map(normalizeBlueprintRow).filter((x): x is ExamBlueprintRow => !!x)
      : [],
    createdBy: String(b.createdBy || ""),
    createdAt: b.createdAt || nowIso(),
    updatedAt: b.updatedAt || nowIso(),
  };
}

export function blueprintTotalMarks(bp: Pick<ExamBlueprint, "rows">): number {
  return bp.rows.reduce((a, r) => a + r.marks * r.count, 0);
}

function provisionalPaperCode() {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `EP-DRAFT-${rand}`;
}

/** Stable unique code for archival / future reference */
export function buildPaperCode(input: {
  academicYearCode: string;
  examCode: string;
  className: string;
  subjectCode: string;
  setCode?: string;
}): string {
  const ay = (input.academicYearCode || "AY").replace(/[^0-9A-Za-z-]/g, "");
  const exam = (input.examCode || "EX").replace(/[^0-9A-Za-z]/g, "").slice(0, 8).toUpperCase();
  const cls = (input.className || "CL")
    .replace(/[^0-9A-Za-z]/g, "")
    .slice(0, 6)
    .toUpperCase();
  const sub = (input.subjectCode || "SUB")
    .replace(/[^0-9A-Za-z]/g, "")
    .slice(0, 8)
    .toUpperCase();
  const set = (input.setCode || "A").toUpperCase().slice(0, 1);
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `EP-${ay}-${exam}-${cls}-${sub}-${set}${rand}`;
}

export function loadExamPapers(): ExamPapersState {
  if (typeof window === "undefined") return emptyExamPapersState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyExamPapersState();
    return normalizeExamPapersState(JSON.parse(raw));
  } catch {
    return emptyExamPapersState();
  }
}

export function saveExamPapers(state: ExamPapersState) {
  if (!assertModulePermission("exams", "edit", "saveExamPapers")) return;
  if (typeof window === "undefined") return;
  const next = normalizeExamPapersState(state);
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(next));
  void trackServerWork(import("@/lib/examPapersPersistence").then(
    ({ scheduleExamPapersSync }) => {
      scheduleExamPapersSync(next);
    },
  ));
}

export function writeExamPapersLocalRaw(state: ExamPapersState) {
  if (typeof window === "undefined") return;
  writeCacheOrInvalidate(
    STORAGE_KEY,
    JSON.stringify(normalizeExamPapersState(state)),
  );
}

export function examPapersStateIsEmpty(state: ExamPapersState): boolean {
  return (state.papers?.length ?? 0) === 0;
}

export function listExamPapers(
  academicYearCode: string,
  filters?: {
    examTermId?: string;
    classId?: string;
    subjectId?: string;
    status?: ExamPaperStatus;
  },
  state?: ExamPapersState,
): ExamPaper[] {
  const s = state ?? loadExamPapers();
  return s.papers
    .filter((p) => p.academicYearCode === academicYearCode)
    .filter((p) => !filters?.examTermId || p.examTermId === filters.examTermId)
    .filter((p) => !filters?.classId || p.classId === filters.classId)
    .filter((p) => !filters?.subjectId || p.subjectId === filters.subjectId)
    .filter((p) => !filters?.status || p.status === filters.status)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getExamPaper(
  paperId: string,
  state?: ExamPapersState,
): ExamPaper | undefined {
  return (state ?? loadExamPapers()).papers.find((p) => p.id === paperId);
}

export function sectionMarks(section: ExamPaperSection): number {
  return section.questions.reduce((sum, q) => sum + (q.marks || 0), 0);
}

export function setMarks(set: ExamPaperSet): number {
  return set.sections.reduce((sum, sec) => sum + sectionMarks(sec), 0);
}

export function activeSet(paper: ExamPaper): ExamPaperSet {
  return (
    paper.sets.find((s) => s.setCode === paper.activeSetCode) || paper.sets[0]!
  );
}

export function createExamPaper(input: {
  academicYearCode: string;
  examTermId: string;
  classId: string;
  subjectId: string;
  title?: string;
  examName?: string;
  durationMinutes?: number;
  maxMarks?: number;
  hardness?: ExamPaperHardness;
  createdBy: string;
  examCode?: string;
  className?: string;
  subjectCode?: string;
}): { ok: true; paper: ExamPaper } | { ok: false; error: string } {
  if (!input.classId || !input.subjectId) {
    return { ok: false, error: "Select class and subject" };
  }
  if (!input.examTermId) {
    return { ok: false, error: "Select exam" };
  }
  const paperCode = buildPaperCode({
    academicYearCode: input.academicYearCode,
    examCode: input.examCode || "EX",
    className: input.className || "CL",
    subjectCode: input.subjectCode || "SUB",
    setCode: "A",
  });
  const paper = normalizePaper({
    id: nid("ep"),
    paperCode,
    academicYearCode: input.academicYearCode,
    examTermId: input.examTermId,
    classId: input.classId,
    subjectId: input.subjectId,
    title: input.title || "Question Paper",
    examName: input.examName || "",
    durationMinutes: input.durationMinutes ?? 90,
    maxMarks: input.maxMarks ?? 80,
    hardness: input.hardness || "mixed",
    status: "draft",
    sets: [
      emptySet({
        setCode: "A",
        label: "Set A",
        sections: [
          emptySection({
            title: "Section A",
            instructions: "Answer all questions.",
          }),
        ],
      }),
    ],
    activeSetCode: "A",
    createdBy: input.createdBy,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    updatedBy: input.createdBy,
  })!;
  const state = loadExamPapers();
  saveExamPapers({ ...state, papers: [paper, ...state.papers] });
  return { ok: true, paper };
}

export function saveExamPaper(
  paper: ExamPaper,
  updatedBy: string,
): { ok: true; paper: ExamPaper } | { ok: false; error: string } {
  const normalized = normalizePaper({
    ...paper,
    updatedAt: nowIso(),
    updatedBy,
  });
  if (!normalized) return { ok: false, error: "Invalid paper" };
  if (!normalized.sets.length) {
    return { ok: false, error: "Add at least one set (A/B/C…)" };
  }
  const state = loadExamPapers();
  if (!state.papers.some((p) => p.id === normalized.id)) {
    return { ok: false, error: "Paper not found" };
  }
  saveExamPapers({
    ...state,
    papers: state.papers.map((p) =>
      p.id === normalized.id ? normalized : p,
    ),
  });
  return { ok: true, paper: normalized };
}

export function deleteExamPaper(
  paperId: string,
): { ok: true } | { ok: false; error: string } {
  const state = loadExamPapers();
  if (!state.papers.some((p) => p.id === paperId)) {
    return { ok: false, error: "Paper not found" };
  }
  saveExamPapers({
    ...state,
    papers: state.papers.filter((p) => p.id !== paperId),
  });
  return { ok: true };
}

export function duplicateSetAs(
  paper: ExamPaper,
  fromSetCode: string,
  toSetCode: string,
): ExamPaper {
  const source =
    paper.sets.find((s) => s.setCode === fromSetCode) || paper.sets[0]!;
  const code = toSetCode.toUpperCase().slice(0, 1);
  const clone = emptySet({
    setCode: code,
    label: `Set ${code}`,
    sections: source.sections.map((sec) =>
      emptySection({
        title: sec.title,
        instructions: sec.instructions,
        questions: sec.questions.map((q) =>
          emptyQuestion({
            ...q,
            id: nid("q"),
            images: q.images.map((img) => ({ ...img, id: nid("img") })),
          }),
        ),
      }),
    ),
  });
  const without = paper.sets.filter((s) => s.setCode !== code);
  return { ...paper, sets: [...without, clone] };
}

export function recordPaperPrint(input: {
  paperId: string;
  count: number;
  setCode: string;
  by: string;
}): { ok: true; paper: ExamPaper } | { ok: false; error: string } {
  const state = loadExamPapers();
  const paper = state.papers.find((p) => p.id === input.paperId);
  if (!paper) return { ok: false, error: "Paper not found" };
  const event: ExamPaperPrintEvent = {
    id: nid("prt"),
    at: nowIso(),
    by: input.by,
    count: Math.max(1, Math.floor(input.count || 1)),
    setCode: (input.setCode || paper.activeSetCode).toUpperCase().slice(0, 1),
  };
  const next: ExamPaper = {
    ...paper,
    printLog: [event, ...paper.printLog],
    updatedAt: nowIso(),
    updatedBy: input.by,
  };
  saveExamPapers({
    ...state,
    papers: state.papers.map((p) => (p.id === paper.id ? next : p)),
  });
  return { ok: true, paper: next };
}

export function totalPrintCount(paper: ExamPaper): number {
  return paper.printLog.reduce((sum, e) => sum + e.count, 0);
}

export function schoolHeaderDefaults() {
  const p = schoolIdentity();
  return {
    schoolName: schoolPrintName(),
    shortName: schoolShortName(),
    logoUrl: schoolLogoUrl(),
    crestUrl: schoolCrestUrl(),
    city: p.city || TENANT.city,
    state: p.state || TENANT.state,
    affiliationNo: p.affiliationNo || TENANT.affiliationNo,
    schoolCode: p.schoolCode || TENANT.schoolCode,
    address: schoolAddressLine(),
  };
}

export function questionTypeLabel(type: ExamPaperQuestionType): string {
  return QUESTION_TYPES.find((t) => t.code === type)?.label || type;
}

/* ─── Question bank ──────────────────────────────────────────────── */

function normText(t: string): string {
  return t.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Add questions to the bank for a class + subject. Duplicates (same text
 * for the same class+subject) are skipped, not doubled. Pure: returns the
 * next state and how many were actually added.
 */
export function addQuestionsToBank(
  state: ExamPapersState,
  input: {
    classId: string;
    subjectId: string;
    questions: ExamPaperQuestion[];
    tags?: string[];
    by: string;
  },
): { state: ExamPapersState; added: number } {
  const existing = new Set(
    state.bank
      .filter((b) => b.classId === input.classId && b.subjectId === input.subjectId)
      .map((b) => normText(b.question.text)),
  );
  const now = nowIso();
  const fresh: BankQuestion[] = [];
  for (const q of input.questions) {
    const key = normText(q.text);
    if (!key || existing.has(key)) continue;
    existing.add(key);
    fresh.push({
      id: nid("bq"),
      classId: input.classId,
      subjectId: input.subjectId,
      // Bank copy gets its own question id so a paper never shares ids with the bank.
      question: emptyQuestion({ ...q, id: nid("q"), source: "bank" }),
      tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean),
      addedBy: input.by,
      addedAt: now,
      usedCount: 0,
      lastUsedAt: "",
    });
  }
  return { state: { ...state, bank: [...state.bank, ...fresh] }, added: fresh.length };
}

export function removeFromBank(state: ExamPapersState, bankId: string): ExamPapersState {
  return { ...state, bank: state.bank.filter((b) => b.id !== bankId) };
}

export function listBank(
  state: ExamPapersState,
  filters: { classId?: string; subjectId?: string; unitId?: string; type?: ExamPaperQuestionType; search?: string },
): BankQuestion[] {
  const q = normText(filters.search || "");
  return state.bank.filter((b) => {
    if (filters.classId && b.classId !== filters.classId) return false;
    if (filters.subjectId && b.subjectId !== filters.subjectId) return false;
    if (filters.unitId && b.question.unitId !== filters.unitId) return false;
    if (filters.type && b.question.type !== filters.type) return false;
    if (q && !normText(`${b.question.text} ${b.question.competencyCode} ${b.tags.join(" ")}`).includes(q)) return false;
    return true;
  });
}

/**
 * Bank items that satisfy one blueprint row: same class+subject, same
 * type and marks, unit and LO code when the row names them, hardness when
 * the row is not "mixed". Least-used first so the same item is not pulled
 * every year; `exclude` = ids already used in this paper.
 */
export function matchBankForRow(
  state: ExamPapersState,
  ctx: { classId: string; subjectId: string },
  row: ExamBlueprintRow,
  exclude: Set<string> = new Set(),
): BankQuestion[] {
  return state.bank
    .filter((b) => {
      if (exclude.has(b.id)) return false;
      if (b.classId !== ctx.classId || b.subjectId !== ctx.subjectId) return false;
      const q = b.question;
      if (q.type !== row.questionType) return false;
      if (q.marks !== row.marks) return false;
      if (row.unitId && q.unitId !== row.unitId) return false;
      if (row.competencyCode && q.competencyCode !== row.competencyCode) return false;
      if (row.hardness !== "mixed" && q.hardness !== row.hardness) return false;
      return true;
    })
    .sort((a, b) => a.usedCount - b.usedCount || a.addedAt.localeCompare(b.addedAt));
}

/** Copy a bank item into a paper (fresh id, source "bank") and count the use. */
export function takeFromBank(
  state: ExamPapersState,
  bankId: string,
): { state: ExamPapersState; question: ExamPaperQuestion } | null {
  const item = state.bank.find((b) => b.id === bankId);
  if (!item) return null;
  const now = nowIso();
  return {
    state: {
      ...state,
      bank: state.bank.map((b) =>
        b.id === bankId ? { ...b, usedCount: b.usedCount + 1, lastUsedAt: now } : b,
      ),
    },
    question: emptyQuestion({ ...item.question, id: nid("q"), source: "bank" }),
  };
}

/* ─── Blueprints ─────────────────────────────────────────────────── */

export function upsertBlueprint(
  state: ExamPapersState,
  input: Partial<ExamBlueprint> & { classId: string; subjectId: string; by: string },
): { ok: true; state: ExamPapersState; blueprint: ExamBlueprint } | { ok: false; error: string } {
  const existing = input.id ? state.blueprints.find((b) => b.id === input.id) : undefined;
  const bp = normalizeBlueprint({
    ...(existing ?? {}),
    ...input,
    createdBy: existing?.createdBy || input.by,
    createdAt: existing?.createdAt || nowIso(),
    updatedAt: nowIso(),
  });
  if (!bp) return { ok: false, error: "Blueprint needs a class and subject" };
  if (bp.rows.length === 0) return { ok: false, error: "Add at least one row (type · marks · count)" };
  const blueprints = existing
    ? state.blueprints.map((b) => (b.id === bp.id ? bp : b))
    : [...state.blueprints, bp];
  return { ok: true, state: { ...state, blueprints }, blueprint: bp };
}

export function removeBlueprint(state: ExamPapersState, id: string): ExamPapersState {
  return { ...state, blueprints: state.blueprints.filter((b) => b.id !== id) };
}

export function listBlueprints(
  state: ExamPapersState,
  filters: { academicYearCode?: string; classId?: string; subjectId?: string },
): ExamBlueprint[] {
  return state.blueprints.filter(
    (b) =>
      (!filters.academicYearCode || b.academicYearCode === filters.academicYearCode) &&
      (!filters.classId || b.classId === filters.classId) &&
      (!filters.subjectId || b.subjectId === filters.subjectId),
  );
}

/** CBSE-ish section order for assembling a paper from rows. */
export const BLUEPRINT_TYPE_ORDER: ExamPaperQuestionType[] = [
  "mcq",
  "assertion_reason",
  "fill",
  "true_false",
  "match",
  "primary_picture",
  "short",
  "numerical",
  "diagram",
  "long",
  "case_study",
  "competency",
];

/**
 * Fill a blueprint from the bank. Returns, per row, the questions taken and
 * how many are still missing (for the LLM), plus the bank state with use
 * counts bumped. Pure.
 */
export function fillBlueprintFromBank(
  state: ExamPapersState,
  ctx: { classId: string; subjectId: string },
  rows: ExamBlueprintRow[],
): {
  state: ExamPapersState;
  cells: { row: ExamBlueprintRow; taken: ExamPaperQuestion[]; missing: number }[];
} {
  let next = state;
  const used = new Set<string>();
  const cells = rows.map((row) => {
    const matches = matchBankForRow(next, ctx, row, used).slice(0, row.count);
    const taken: ExamPaperQuestion[] = [];
    for (const m of matches) {
      const t = takeFromBank(next, m.id);
      if (!t) continue;
      next = t.state;
      used.add(m.id);
      taken.push(t.question);
    }
    return { row, taken, missing: Math.max(0, row.count - taken.length) };
  });
  return { state: next, cells };
}

/**
 * Group filled cells into sections in CBSE order. Rows of the same type
 * share a section; each section's title says what it holds.
 */
export function assembleSectionsFromCells(
  cells: { row: ExamBlueprintRow; questions: ExamPaperQuestion[] }[],
): ExamPaperSection[] {
  const byType = new Map<ExamPaperQuestionType, ExamPaperQuestion[]>();
  for (const c of cells) {
    const list = byType.get(c.row.questionType) ?? [];
    list.push(...c.questions);
    byType.set(c.row.questionType, list);
  }
  const sections: ExamPaperSection[] = [];
  let letter = 0;
  for (const type of BLUEPRINT_TYPE_ORDER) {
    const qs = byType.get(type);
    if (!qs || qs.length === 0) continue;
    const marks = qs[0]?.marks ?? 1;
    const uniform = qs.every((q) => q.marks === marks);
    sections.push(
      emptySection({
        title: `Section ${String.fromCharCode(65 + letter++)} — ${questionTypeLabel(type)}`,
        instructions: uniform
          ? `${qs.length} question${qs.length === 1 ? "" : "s"} × ${marks} mark${marks === 1 ? "" : "s"}.`
          : `${qs.length} questions.`,
        questions: qs,
      }),
    );
  }
  return sections;
}

/* -------------------------------------------------------------------------- */
/* Imported papers                                                            */
/* -------------------------------------------------------------------------- */

/** One class + subject + exam's worth of imported sets, ready to be filed. */
export type ImportedPaperInput = {
  /** Existing paper to add these sets to; "" creates a new one. */
  targetPaperId: string;
  academicYearCode: string;
  examTermId: string;
  classId: string;
  subjectId: string;
  /** For the paper code and the printed header. */
  examCode: string;
  examName: string;
  className: string;
  subjectCode: string;
  title: string;
  maxMarks: number;
  durationMinutes: number;
  sets: ExamPaperSet[];
};

export type ImportedPaperOutcome = {
  state: ExamPapersState;
  created: number;
  updated: number;
  addedSets: number;
  /** Sets skipped because that exact file is already on the paper. */
  skippedSets: number;
};

/**
 * Fold imported sets into the papers on the desk.
 *
 * Two rules, both about not destroying work:
 *
 *  * a set is **added**, never swapped for one already there. A teacher may
 *    have edited Set A after it was imported; re-importing the folder must not
 *    quietly replace their questions with the publisher's again.
 *  * a file already on the paper — same sha-256 — is skipped, so running the
 *    import twice leaves the desk exactly as the first run did.
 *
 * Papers arrive as drafts. Nothing imported is marked ready: somebody has to
 * look at a parsed paper before it is printed for children.
 */
export function applyImportedSets(
  state: ExamPapersState,
  inputs: ImportedPaperInput[],
  actor: string,
): ImportedPaperOutcome {
  const papers = [...state.papers];
  let created = 0;
  let updated = 0;
  let addedSets = 0;
  let skippedSets = 0;

  for (const input of inputs) {
    if (!input.sets.length) continue;

    const at = input.targetPaperId
      ? papers.findIndex((p) => p.id === input.targetPaperId)
      : -1;

    if (at >= 0) {
      const paper = papers[at]!;
      const seen = new Set(
        paper.sets.map((s) => s.source?.fileHash).filter(Boolean) as string[],
      );
      const takenCodes = new Set(paper.sets.map((s) => s.setCode));
      const fresh: ExamPaperSet[] = [];
      for (const set of input.sets) {
        if (set.source?.fileHash && seen.has(set.source.fileHash)) {
          skippedSets += 1;
          continue;
        }
        let code = set.setCode;
        if (takenCodes.has(code)) {
          let i = 0;
          while (i < 26 && takenCodes.has(String.fromCharCode(65 + i))) i += 1;
          code = String.fromCharCode(65 + i);
        }
        takenCodes.add(code);
        fresh.push({ ...set, setCode: code });
      }
      if (!fresh.length) continue;
      const next = normalizePaper({
        ...paper,
        sets: [...paper.sets, ...fresh],
        updatedAt: nowIso(),
        updatedBy: actor,
      });
      if (!next) continue;
      papers[at] = next;
      updated += 1;
      addedSets += fresh.length;
      continue;
    }

    const paper = normalizePaper({
      id: nid("ep"),
      paperCode: buildPaperCode({
        academicYearCode: input.academicYearCode,
        examCode: input.examCode,
        className: input.className,
        subjectCode: input.subjectCode,
        setCode: input.sets[0]!.setCode,
      }),
      academicYearCode: input.academicYearCode,
      examTermId: input.examTermId,
      classId: input.classId,
      subjectId: input.subjectId,
      title: input.title,
      examName: input.examName,
      durationMinutes: input.durationMinutes,
      maxMarks: input.maxMarks,
      hardness: "mixed",
      status: "draft",
      sets: input.sets,
      activeSetCode: input.sets[0]!.setCode,
      createdBy: actor,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      updatedBy: actor,
    });
    if (!paper) continue;
    papers.push(paper);
    created += 1;
    addedSets += paper.sets.length;
  }

  return { state: { ...state, papers }, created, updated, addedSets, skippedSets };
}

/** What the planner needs to know about the papers already on the desk. */
export function existingPaperFacts(state: ExamPapersState) {
  return state.papers.map((p) => ({
    paperId: p.id,
    academicYearCode: p.academicYearCode,
    examTermId: p.examTermId,
    classId: p.classId,
    subjectId: p.subjectId,
    sets: p.sets.map((s) => ({
      setCode: s.setCode,
      fileHash: s.source?.fileHash ?? "",
    })),
  }));
}

/**
 * Put every imported question into the bank for its class and subject.
 *
 * Without this the import is a one-term affair: 2,400 questions land inside
 * papers, and a teacher building next term's paper can only find them by
 * opening last term's and copying by hand. The bank is the part that makes
 * them reusable — `BankPicker` searches it by class × subject, type, text,
 * LO code and tag, and copies an item into whatever section is open.
 *
 * Banking is a copy, not a reference: editing a bank item never changes a
 * paper that was printed from it, and deleting one never empties a paper.
 * Pictures come along, because a bank question carries the same stored URLs
 * the paper does — the file itself is not duplicated.
 *
 * `addQuestionsToBank` already refuses a question whose text is in the bank
 * for that class and subject, so three sets of one paper contribute what they
 * share only once, and re-importing the folder adds nothing.
 */
export function bankImportedQuestions(
  state: ExamPapersState,
  inputs: ImportedPaperInput[],
  by: string,
): { state: ExamPapersState; added: number } {
  let next = state;
  let added = 0;
  for (const input of inputs) {
    if (!input.classId || !input.subjectId) continue;
    for (const set of input.sets) {
      const questions = set.sections
        .flatMap((s) => s.questions)
        .filter((q) => q.text.trim());
      if (!questions.length) continue;
      const r = addQuestionsToBank(next, {
        classId: input.classId,
        subjectId: input.subjectId,
        questions,
        // Provenance the teacher can search on: which exam, and which of the
        // publisher's papers it came out of.
        tags: [input.examCode, set.source?.publisherLabel || set.label].filter(Boolean),
        by,
      });
      next = r.state;
      added += r.added;
    }
  }
  return { state: next, added };
}
