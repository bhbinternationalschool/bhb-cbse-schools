/**
 * Exam question papers — draft / sets / print codes.
 * Separate blob from marksheets so image-heavy papers stay isolated.
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import { DEFAULT_AY } from "@/lib/masters";
import { TENANT } from "@/lib/types";

export type ExamPaperQuestionType =
  | "mcq"
  | "short"
  | "long"
  | "fill"
  | "true_false"
  | "match"
  | "numerical"
  | "diagram"
  | "primary_picture";

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

export type ExamPapersState = {
  version: 1;
  papers: ExamPaper[];
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
  return { version: 1, papers: [] };
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
  };
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
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
