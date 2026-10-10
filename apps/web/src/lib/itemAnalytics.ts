/**
 * Item-score analytics — roll question-wise marks up to the things a
 * teacher can act on: syllabus unit, CBSE LO code, Bloom level, question
 * type. Pure functions over an ExamPaper's questions and the section's
 * StudentItemScore rows; no I/O, no model.
 *
 * "Weak" is a class-level judgement (average % of available marks below a
 * threshold with enough students marked), never a label on a child.
 */

import type { ExamPaperQuestion } from "@/lib/examPapers";
import type { StudentItemScore } from "@/lib/exams";

export type RollupDimension = "unit" | "competency" | "bloom" | "type" | "question";

export type RollupRow = {
  dimension: RollupDimension;
  /** Stable key within the dimension (unitId, LO code, bloom level, type, questionId) */
  key: string;
  label: string;
  /** Marks available per student across the questions in this bucket */
  maxMarks: number;
  /** Students with at least one item marked in this bucket */
  students: number;
  /** Class average as % of maxMarks (over marked students only) */
  avgPct: number;
  /** Share of marked students who scored under 50 % in this bucket */
  belowHalfShare: number;
  questionIds: string[];
  weak: boolean;
};

export type StudentBucketScore = {
  studentId: string;
  key: string;
  obtained: number;
  max: number;
  pct: number;
};

export const WEAK_AVG_PCT = 50;
export const WEAK_MIN_STUDENTS = 5;

type Bucket = { key: string; label: string; questions: ExamPaperQuestion[] };

function bucketsFor(
  dimension: RollupDimension,
  questions: ExamPaperQuestion[],
  labels: { unit: (id: string) => string },
): Bucket[] {
  const map = new Map<string, Bucket>();
  questions.forEach((q, i) => {
    let key = "";
    let label = "";
    switch (dimension) {
      case "unit":
        key = q.unitId || "";
        label = q.unitId ? labels.unit(q.unitId) || q.unitId : "";
        break;
      case "competency":
        key = q.competencyCode || "";
        label = q.competencyCode;
        break;
      case "bloom":
        key = q.bloomLevel || "";
        label = q.bloomLevel;
        break;
      case "type":
        key = q.type;
        label = q.type;
        break;
      case "question":
        key = q.id;
        label = `Q${i + 1}`;
        break;
    }
    if (!key) return; // untagged questions don't form a bucket
    const b = map.get(key) ?? { key, label, questions: [] };
    b.questions.push(q);
    map.set(key, b);
  });
  return [...map.values()];
}

/**
 * Per-student score inside one bucket. A student counts as "marked" in a
 * bucket only if at least one of its questions has a non-null mark; the
 * unmarked questions of a marked student count as 0 obtained but full max
 * — that is a teacher's decision when they leave a cell blank after marking
 * the row (absent for that item), and the UI says so.
 */
function studentScores(
  bucket: Bucket,
  scoresByStudent: Map<string, Map<string, number | null>>,
): StudentBucketScore[] {
  const max = bucket.questions.reduce((a, q) => a + q.marks, 0);
  const out: StudentBucketScore[] = [];
  if (max === 0) return out;
  for (const [studentId, byQ] of scoresByStudent) {
    let any = false;
    let obtained = 0;
    for (const q of bucket.questions) {
      const m = byQ.get(q.id);
      if (m != null) {
        any = true;
        obtained += m;
      }
    }
    if (!any) continue;
    out.push({ studentId, key: bucket.key, obtained, max, pct: (obtained / max) * 100 });
  }
  return out;
}

export function indexItemScores(
  scores: StudentItemScore[],
  paperId: string,
  setCode: string,
): Map<string, Map<string, number | null>> {
  const byStudent = new Map<string, Map<string, number | null>>();
  for (const s of scores) {
    if (s.paperId !== paperId || s.setCode !== setCode) continue;
    const m = byStudent.get(s.studentId) ?? new Map<string, number | null>();
    m.set(s.questionId, s.marks);
    byStudent.set(s.studentId, m);
  }
  return byStudent;
}

export function rollupItemScores(input: {
  questions: ExamPaperQuestion[];
  scoresByStudent: Map<string, Map<string, number | null>>;
  dimension: RollupDimension;
  unitLabel: (unitId: string) => string;
  weakAvgPct?: number;
  weakMinStudents?: number;
}): RollupRow[] {
  const weakAvg = input.weakAvgPct ?? WEAK_AVG_PCT;
  const weakMin = input.weakMinStudents ?? WEAK_MIN_STUDENTS;
  const rows: RollupRow[] = [];
  for (const b of bucketsFor(input.dimension, input.questions, { unit: input.unitLabel })) {
    const ss = studentScores(b, input.scoresByStudent);
    const maxMarks = b.questions.reduce((a, q) => a + q.marks, 0);
    if (ss.length === 0) {
      rows.push({
        dimension: input.dimension,
        key: b.key,
        label: b.label,
        maxMarks,
        students: 0,
        avgPct: 0,
        belowHalfShare: 0,
        questionIds: b.questions.map((q) => q.id),
        weak: false,
      });
      continue;
    }
    const avgPct = ss.reduce((a, s) => a + s.pct, 0) / ss.length;
    const belowHalfShare = ss.filter((s) => s.pct < 50).length / ss.length;
    rows.push({
      dimension: input.dimension,
      key: b.key,
      label: b.label,
      maxMarks,
      students: ss.length,
      avgPct: Math.round(avgPct * 10) / 10,
      belowHalfShare: Math.round(belowHalfShare * 100) / 100,
      questionIds: b.questions.map((q) => q.id),
      weak: ss.length >= weakMin && avgPct < weakAvg,
    });
  }
  // Weakest first, then by marks at stake.
  return rows.sort((a, b) => a.avgPct - b.avgPct || b.maxMarks - a.maxMarks);
}

/** Students under 50 % in a bucket — who needs the remedial group. */
export function studentsBelowHalf(input: {
  questions: ExamPaperQuestion[];
  scoresByStudent: Map<string, Map<string, number | null>>;
  questionIds: string[];
}): StudentBucketScore[] {
  const qs = input.questions.filter((q) => input.questionIds.includes(q.id));
  const b: Bucket = { key: "sel", label: "", questions: qs };
  return studentScores(b, input.scoresByStudent)
    .filter((s) => s.pct < 50)
    .sort((a, b) => a.pct - b.pct);
}

/* ─── AI: teaching suggestions (draft) ─────────────────────────────── */

export type PedagogyFacts = {
  classLabel: string;
  subjectName: string;
  examLabel: string;
  studentsMarked: number;
  weak: { dimension: RollupDimension; label: string; avgPct: number; belowHalfShare: number; sampleQuestions: string[] }[];
  strong: { dimension: RollupDimension; label: string; avgPct: number }[];
  teacherNote: string;
};

export type PedagogyDraft = {
  /** 3–6 concrete moves for the next 1–2 weeks of lessons */
  suggestions: string[];
  /** 1–3 lines: what to prioritise in a remedial group and why */
  remedialFocus: string;
};

export function buildPedagogySystemPrompt(opts: { language: "en" | "hi"; schoolName: string }): string {
  const lang =
    opts.language === "hi"
      ? "Write in Hindi (Devanagari) for the subject teacher."
      : "Write in plain English for the subject teacher.";
  return `You advise a subject teacher at ${opts.schoolName} (CBSE, India) after an exam. The school has already computed where the class was weak and strong from question-wise marks; you turn that into teaching moves. ${lang}

Rules:
- Only use the weak / strong areas given. Each suggestion must name the area it targets and be something one teacher can do in a normal classroom in the next 1–2 weeks (a re-teach with a specific representation, a worked-example sequence, a 10-minute retrieval routine, a peer-explanation task, a targeted homework set…). No generic advice ("revise more", "give attention").
- Do not name students, do not diagnose, do not blame.
- suggestions: 3–6 items, each one sentence, ordered by impact. remedialFocus: 1–3 sentences on what a small remedial group should practise first and why.

Respond with JSON only: {"suggestions":["…"],"remedialFocus":"…"}.`;
}

export function buildPedagogyUserPrompt(f: PedagogyFacts): string {
  const L = [
    `Class: ${f.classLabel} · Subject: ${f.subjectName} · Exam: ${f.examLabel} · students marked: ${f.studentsMarked}`,
    "",
    f.weak.length ? "Weak areas (class average % of marks; share of students under 50 %):" : "Weak areas: none below threshold",
  ];
  for (const w of f.weak) {
    L.push(`- [${w.dimension}] ${w.label}: avg ${Math.round(w.avgPct)}%, ${Math.round(w.belowHalfShare * 100)}% of students under half`);
    for (const q of w.sampleQuestions.slice(0, 2)) L.push(`    e.g. ${q.slice(0, 160)}`);
  }
  if (f.strong.length) {
    L.push("", "Strong areas:");
    for (const s of f.strong) L.push(`- [${s.dimension}] ${s.label}: avg ${Math.round(s.avgPct)}%`);
  }
  if (f.teacherNote.trim()) L.push("", `Teacher's note: ${f.teacherNote.trim()}`);
  return L.join("\n");
}

export function parsePedagogyJson(text: string): PedagogyDraft | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const r = raw as { suggestions?: unknown; remedialFocus?: unknown };
  if (!r || !Array.isArray(r.suggestions)) return null;
  const suggestions = r.suggestions
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .slice(0, 6);
  if (suggestions.length === 0) return null;
  return { suggestions, remedialFocus: String(r.remedialFocus ?? "").trim().slice(0, 600) };
}

export function cleanPedagogyFacts(raw: unknown): PedagogyFacts | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const dim = (v: unknown): RollupDimension =>
    v === "unit" || v === "competency" || v === "bloom" || v === "type" || v === "question" ? v : "question";
  const list = (v: unknown, withQ: boolean) =>
    Array.isArray(v)
      ? v
          .map((x) => {
            const y = (x ?? {}) as Record<string, unknown>;
            const label = str(y.label, 80);
            if (!label) return null;
            return {
              dimension: dim(y.dimension),
              label,
              avgPct: num(y.avgPct),
              belowHalfShare: num(y.belowHalfShare),
              sampleQuestions: withQ && Array.isArray(y.sampleQuestions) ? y.sampleQuestions.map((q) => str(q, 200)).filter(Boolean).slice(0, 3) : [],
            };
          })
          .filter((x): x is NonNullable<typeof x> => !!x)
          .slice(0, 8)
      : [];
  const subjectName = str(r.subjectName, 60);
  const weak = list(r.weak, true);
  const strong = list(r.strong, false).map(({ dimension, label, avgPct }) => ({ dimension, label, avgPct }));
  if (!subjectName || (weak.length === 0 && strong.length === 0)) return null;
  return {
    classLabel: str(r.classLabel, 30),
    subjectName,
    examLabel: str(r.examLabel, 60),
    studentsMarked: Math.max(0, Math.floor(num(r.studentsMarked))),
    weak,
    strong,
    teacherNote: str(r.teacherNote, 400),
  };
}
