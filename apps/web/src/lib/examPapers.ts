/**
 * Exam question papers — draft / sets / print codes.
 * Separate blob from marksheets so image-heavy papers stay isolated.
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import { DEFAULT_AY } from "@/lib/masters";
import { TENANT } from "@/lib/types";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";

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

export type ExamPaperImage = {
  id: string;
  /** data: URL or https */
  dataUrl: string;
  caption: string;
};

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
};

export type ExamPaperSection = {
  id: string;
  title: string;
  instructions: string;
  questions: ExamPaperQuestion[];
};

export type ExamPaperSet = {
  id: string;
  /** A / B / C / D — school picks one on exam day */
  setCode: string;
  label: string;
  sections: ExamPaperSection[];
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
  return { version: 1, papers: [], bank: [], blueprints: [] };
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
  };
}

function normalizeImage(img: Partial<ExamPaperImage>): ExamPaperImage | null {
  if (!img.dataUrl) return null;
  return {
    id: img.id || nid("img"),
    dataUrl: img.dataUrl,
    caption: img.caption || "",
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
  void import("@/lib/examPapersPersistence").then(
    ({ scheduleExamPapersSync }) => {
      scheduleExamPapersSync(next);
    },
  );
}

export function writeExamPapersLocalRaw(state: ExamPapersState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(
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
  return {
    schoolName: TENANT.nameDisplay,
    shortName: TENANT.shortName,
    logoUrl: TENANT.logoUrl,
    crestUrl: TENANT.logoCrestUrl,
    city: TENANT.city,
    state: TENANT.state,
    affiliationNo: TENANT.affiliationNo,
    schoolCode: TENANT.schoolCode,
    address: TENANT.schoolAddress,
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
