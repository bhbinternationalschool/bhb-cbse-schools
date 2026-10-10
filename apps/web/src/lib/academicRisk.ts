/**
 * Academic at-risk detection — deterministic rules over facts the school
 * already records. No model decides who is at risk; the model (elsewhere)
 * only writes the "what to do" note for a student these rules flagged.
 *
 * "Unknown must not become fact": every input is nullable and a missing
 * input never fires a rule and never clears one — a student with no
 * attendance register is neither "attendance ok" nor "low attendance".
 */

export type RiskFlagId =
  | "grade_drop"
  | "subject_drops"
  | "below_pass"
  | "low_attendance"
  | "conduct"
  | "homework";

export type RiskLevel = "high" | "watch" | "none";

export type RiskFlag = {
  id: RiskFlagId;
  label: string;
  /** One-line, number-bearing reason shown in the UI and given to the LLM */
  detail: string;
  severity: 1 | 2;
};

export type RiskThresholds = {
  /** Attendance % below which the flag fires */
  attendancePct: number;
  /** Incidents in the AY at or above which the flag fires */
  incidents: number;
  /** Homework submitted / due below which the flag fires … */
  homeworkRatio: number;
  /** … provided at least this many were due */
  homeworkMinDue: number;
  /** Subjects that each dropped ≥ 1 band vs previous term */
  subjectDrops: number;
};

export const DEFAULT_RISK_THRESHOLDS: RiskThresholds = {
  attendancePct: 75,
  incidents: 3,
  homeworkRatio: 0.6,
  homeworkMinDue: 5,
  subjectDrops: 2,
};

/** CBSE 8-point scale, best first. "—" (no grade) is not on the scale. */
export const GRADE_BANDS = ["A1", "A2", "B1", "B2", "C1", "C2", "D", "E"] as const;

export function gradeBandIndex(grade: string): number | null {
  const i = GRADE_BANDS.indexOf(grade.trim().toUpperCase() as (typeof GRADE_BANDS)[number]);
  return i < 0 ? null : i;
}

/** Bands *fallen* from `prev` to `cur`; null when either is not a grade. */
export function bandsDropped(prev: string, cur: string): number | null {
  const p = gradeBandIndex(prev);
  const c = gradeBandIndex(cur);
  if (p == null || c == null) return null;
  return c - p;
}

export type StudentRiskFacts = {
  studentId: string;
  fullName: string;
  /** Current term */
  examLabel: string;
  percent: number | null;
  overallGrade: string;
  /** Previous term with marks, if any */
  previousExamLabel: string;
  previousPercent: number | null;
  previousGrade: string;
  subjects: { subjectName: string; grade: string; previousGrade: string }[];
  attendancePercent: number | null;
  /** Incidents this AY; null = discipline module never used */
  incidents: number | null;
  /** Escalations at parent_meeting or above this AY */
  escalations: number;
  homework: { assigned: number; submitted: number } | null;
};

export type StudentRiskResult = {
  studentId: string;
  level: RiskLevel;
  score: number;
  flags: RiskFlag[];
};

const PASS_INDEX = GRADE_BANDS.indexOf("D");

export function assessStudentRisk(
  f: StudentRiskFacts,
  t: RiskThresholds = DEFAULT_RISK_THRESHOLDS,
): StudentRiskResult {
  const flags: RiskFlag[] = [];

  // Overall band drop vs previous term.
  const overallDrop = bandsDropped(f.previousGrade, f.overallGrade);
  if (overallDrop != null && overallDrop >= 1) {
    flags.push({
      id: "grade_drop",
      label: "Grade dropped",
      detail: `${f.previousGrade} in ${f.previousExamLabel || "previous exam"} → ${f.overallGrade} in ${f.examLabel}${
        f.previousPercent != null && f.percent != null
          ? ` (${Math.round(f.previousPercent)}% → ${Math.round(f.percent)}%)`
          : ""
      }`,
      severity: overallDrop >= 2 ? 2 : 1,
    });
  }

  // Several subjects each slipping a band.
  const dropped = f.subjects.filter((s) => {
    const d = bandsDropped(s.previousGrade, s.grade);
    return d != null && d >= 1;
  });
  if (dropped.length >= t.subjectDrops) {
    flags.push({
      id: "subject_drops",
      label: `${dropped.length} subjects slipped`,
      detail: dropped.map((s) => `${s.subjectName} ${s.previousGrade}→${s.grade}`).join(", "),
      severity: 1,
    });
  }

  // Below pass in any subject this term.
  const failing = f.subjects.filter((s) => {
    const i = gradeBandIndex(s.grade);
    return i != null && i > PASS_INDEX;
  });
  if (failing.length > 0) {
    flags.push({
      id: "below_pass",
      label: failing.length === 1 ? "Below pass in 1 subject" : `Below pass in ${failing.length} subjects`,
      detail: failing.map((s) => `${s.subjectName} (${s.grade})`).join(", "),
      severity: failing.length >= 2 ? 2 : 1,
    });
  }

  // Attendance.
  if (f.attendancePercent != null && f.attendancePercent < t.attendancePct) {
    flags.push({
      id: "low_attendance",
      label: "Low attendance",
      detail: `${Math.round(f.attendancePercent)}% this year (threshold ${t.attendancePct}%)`,
      severity: f.attendancePercent < t.attendancePct - 15 ? 2 : 1,
    });
  }

  // Conduct — count threshold, or any escalation regardless of count.
  if (f.incidents != null && (f.incidents >= t.incidents || f.escalations > 0)) {
    flags.push({
      id: "conduct",
      label: "Conduct",
      detail: `${f.incidents} incident${f.incidents === 1 ? "" : "s"} this year${
        f.escalations > 0 ? ` · ${f.escalations} escalated` : ""
      }`,
      severity: f.escalations > 0 ? 2 : 1,
    });
  }

  // Homework habit — only with enough due to judge.
  if (
    f.homework &&
    f.homework.assigned >= t.homeworkMinDue &&
    f.homework.submitted / f.homework.assigned < t.homeworkRatio
  ) {
    flags.push({
      id: "homework",
      label: "Homework not submitted",
      detail: `${f.homework.submitted} of ${f.homework.assigned} due submitted`,
      severity: 1,
    });
  }

  const score = flags.reduce((s, x) => s + x.severity, 0);
  const level: RiskLevel =
    score >= 3 || flags.some((x) => x.id === "below_pass" && x.severity === 2)
      ? "high"
      : score >= 1
        ? "watch"
        : "none";
  return { studentId: f.studentId, level, score, flags };
}

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  high: "High",
  watch: "Watch",
  none: "OK",
};

/* ─── AI note (draft only) — shapes + prompt shared by route and client ── */

export type RiskNoteLanguage = "en" | "hi";

export type RiskNoteDraft = {
  studentId: string;
  /** 2–4 sentences: what to do at school and at home over the next few weeks */
  note: string;
};

export const RISK_NOTES_MAX_STUDENTS = 60;
export const RISK_NOTES_PER_LLM_CALL = 12;

export function chunkRiskStudents<T>(items: T[], size = RISK_NOTES_PER_LLM_CALL): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function buildRiskNoteSystemPrompt(opts: {
  language: RiskNoteLanguage;
  schoolName: string;
}): string {
  const lang =
    opts.language === "hi"
      ? "Write in Hindi (Devanagari), formal register (आप)."
      : "Write in plain English.";
  return `You help class teachers at ${opts.schoolName} (a CBSE school in India) act on an early-warning list. Each student below has ALREADY been flagged by the school's own rules — you are not deciding who is at risk. For each student write ONE short note (2–4 sentences) that a class teacher can act on: the single most important thing to do at school, one thing to ask the family to do at home, and when to check again. Tie every suggestion to the flag reasons given (subject, number). No diagnosis, no labels ("weak student"), no comparisons with others, no invented facts. ${lang}

Respond with JSON only: {"notes":[{"studentId":"…","note":"…"}]} — one entry per student given, same ids.`;
}

export function buildRiskNoteUserPrompt(
  students: (StudentRiskFacts & { flags: RiskFlag[] })[],
): string {
  return students
    .map((s) => {
      const L = [`studentId: ${s.studentId}`, `name: ${s.fullName.split(/\s+/)[0]}`];
      L.push(`flags: ${s.flags.map((f) => `${f.label} — ${f.detail}`).join(" | ")}`);
      if (s.percent != null) L.push(`current: ${s.examLabel} ${Math.round(s.percent)}% (${s.overallGrade})`);
      if (s.previousPercent != null)
        L.push(`previous: ${s.previousExamLabel} ${Math.round(s.previousPercent)}% (${s.previousGrade})`);
      return L.join("\n");
    })
    .join("\n\n");
}

export function parseRiskNotesJson(text: string, ids: string[]): RiskNoteDraft[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const r = raw as { notes?: unknown };
  if (!r || !Array.isArray(r.notes)) return null;
  const want = new Set(ids);
  const out: RiskNoteDraft[] = [];
  for (const n of r.notes) {
    const x = (n ?? {}) as Record<string, unknown>;
    const studentId = String(x.studentId ?? "").trim();
    const note = String(x.note ?? "").replace(/\r\n/g, "\n").trim().slice(0, 700);
    if (!studentId || !note || !want.has(studentId)) continue;
    out.push({ studentId, note });
  }
  return out.length ? out : null;
}

/** Sanitise one client-supplied facts row; null when unusable. */
export function cleanRiskFacts(raw: unknown): StudentRiskFacts | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const studentId = str(r.studentId, 60);
  const fullName = str(r.fullName, 80);
  if (!studentId || !fullName) return null;
  const hw = (r.homework ?? null) as Record<string, unknown> | null;
  return {
    studentId,
    fullName,
    examLabel: str(r.examLabel, 60),
    percent: num(r.percent),
    overallGrade: str(r.overallGrade, 4),
    previousExamLabel: str(r.previousExamLabel, 60),
    previousPercent: num(r.previousPercent),
    previousGrade: str(r.previousGrade, 4),
    subjects: Array.isArray(r.subjects)
      ? r.subjects
          .map((s) => {
            const y = (s ?? {}) as Record<string, unknown>;
            const subjectName = str(y.subjectName, 60);
            return subjectName
              ? { subjectName, grade: str(y.grade, 4), previousGrade: str(y.previousGrade, 4) }
              : null;
          })
          .filter((s): s is NonNullable<typeof s> => !!s)
          .slice(0, 20)
      : [],
    attendancePercent: num(r.attendancePercent),
    incidents: num(r.incidents) == null ? null : Math.max(0, Math.floor(num(r.incidents)!)),
    escalations: Math.max(0, Math.floor(num(r.escalations) ?? 0)),
    homework:
      hw && num(hw.assigned) != null && num(hw.submitted) != null
        ? {
            assigned: Math.max(0, Math.floor(num(hw.assigned)!)),
            submitted: Math.max(0, Math.floor(num(hw.submitted)!)),
          }
        : null,
  };
}
