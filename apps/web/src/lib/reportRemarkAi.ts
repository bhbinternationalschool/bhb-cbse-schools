/**
 * Report-card remark generator — pure helpers shared by the client (which
 * assembles per-student facts from data it already holds) and the server
 * route (which turns those facts into a prompt and parses the reply).
 *
 * Design rules:
 *  - The model only ever sees what is in `StudentRemarkFacts`. No ids, no
 *    contact details, no free-text notes from other modules. First name +
 *    numbers + labels is enough to write a remark and is all a parent
 *    would expect a teacher to be looking at.
 *  - Nothing the model writes is saved by itself. The route returns drafts;
 *    the teacher reviews/edits/accepts in the Remarks tab and only then does
 *    `saveSheetRemarks` run. Provenance (`ai` / `ai_edited` / `manual`) is
 *    recorded on the saved record.
 *  - "Unknown must not become fact": a missing previous term, missing
 *    attendance, or unrated co-scholastic domain is passed as absent and the
 *    prompt tells the model not to comment on it — never as zero.
 */

export type RemarkTone = "encouraging" | "balanced" | "firm";
export type RemarkLanguage = "en" | "hi" | "both";

export const REMARK_TONES: { id: RemarkTone; label: string; hint: string }[] = [
  {
    id: "encouraging",
    label: "Encouraging",
    hint: "Leads with strengths; frames gaps as next steps",
  },
  {
    id: "balanced",
    label: "Balanced",
    hint: "Strengths and concerns given equal weight",
  },
  {
    id: "firm",
    label: "Firm",
    hint: "Direct about concerns; still respectful and specific",
  },
];

export type SubjectRemarkFact = {
  subjectId: string;
  subjectName: string;
  marksObtained: number | null;
  maxMarks: number;
  grade: string;
  /** Previous term's grade in the same subject, "" if that term had no mark */
  previousGrade: string;
  /** Percentage-point change vs previous term, null when not comparable */
  deltaPercent: number | null;
};

export type StudentRemarkFacts = {
  studentId: string;
  /** First name only — enough for a natural remark, no more */
  firstName: string;
  classLabel: string;
  examLabel: string;
  percent: number;
  overallGrade: string;
  /** Previous term overall percent, null when there is no previous term */
  previousPercent: number | null;
  previousExamLabel: string;
  attendancePercent: number | null;
  subjects: SubjectRemarkFact[];
  /** NEP HPC co-scholastic domain ratings, only rated ones */
  coScholastic: { domainLabel: string; ratingLabel: string }[];
  /** Existing teacher-written overall remark, "" if none — the model may refine but must not contradict it */
  existingOverallRemark: string;
};

export type StudentRemarkDraft = {
  studentId: string;
  overall: string;
  overallHi: string;
  subjects: { subjectId: string; remark: string }[];
};

/** Hard caps so one click can never fan out into an unbounded LLM bill. */
export const REMARK_MAX_STUDENTS_PER_REQUEST = 60;
export const REMARK_STUDENTS_PER_LLM_CALL = 8;

export function buildRemarkSystemPrompt(opts: {
  tone: RemarkTone;
  includeSubjectRemarks: boolean;
  schoolName: string;
}): string {
  const toneLine =
    opts.tone === "encouraging"
      ? "Tone: warm and encouraging. Lead with what the student does well; frame every weakness as a concrete next step. Never gush, never invent a strength that the numbers do not support."
      : opts.tone === "firm"
        ? "Tone: firm and direct. Name the concern plainly in the first sentence, say what must change, and still end with one specific, achievable expectation. Respectful — this is read by the child's parents."
        : "Tone: balanced. Give strengths and concerns equal weight, in that order, and close with one specific suggestion.";

  return `You write report-card remarks for a class teacher at ${opts.schoolName}, an Indian CBSE school. Parents read these; the child reads them too.

${toneLine}

Rules — all of them, every time:
- Write ONLY from the facts given. Do not invent behaviour, effort, participation, homework habits, or anything not evidenced by the marks, grades, attendance and ratings supplied.
- If a fact is marked unavailable (no previous term, no attendance figure, no rating), do not mention it at all. Absence is not zero.
- Refer to the student by first name. Use "he/she" only if the name makes it obvious; otherwise use the name again or "the student".
- Overall remark: 2–3 sentences, 35–60 words, plain English at a parent's reading level. Mention the strongest subject and the weakest subject by name when the spread is meaningful. Note improvement or decline versus the previous exam only when a previous figure is given and the change is at least 5 percentage points. Mention attendance only if it is below 75% or above 95%.
- Do not restate the percentage or grade verbatim — the card already prints them. Interpret them.
- Do not use exclamation marks, emojis, or the words "keep it up".
- Vary sentence openings across students in the same batch so remarks do not read as copies of each other.
${
  opts.includeSubjectRemarks
    ? "- Subject remarks: one short phrase per subject (4–12 words), e.g. \"Strong in algebra; word problems need practice\". Only for subjects that have a mark."
    : "- Do not produce subject remarks; return an empty subjects array."
}
- Never mention AI, or that this text was generated.

Respond with JSON only, exactly this shape:
{"students":[{"studentId":"...","overall":"...","subjects":[{"subjectId":"...","remark":"..."}]}]}
Include every studentId you were given, in the same order.`;
}

function fmtDelta(d: number | null): string {
  if (d == null) return "";
  const sign = d > 0 ? "+" : "";
  return ` (${sign}${d.toFixed(0)} pts vs previous)`;
}

export function buildRemarkUserPrompt(students: StudentRemarkFacts[]): string {
  const blocks = students.map((s) => {
    const lines: string[] = [];
    lines.push(`studentId: ${s.studentId}`);
    lines.push(`Name: ${s.firstName} · Class ${s.classLabel} · Exam: ${s.examLabel}`);
    lines.push(
      `Overall: ${s.percent}% (grade ${s.overallGrade})` +
        (s.previousPercent != null
          ? ` · Previous (${s.previousExamLabel}): ${s.previousPercent}%`
          : " · Previous exam: unavailable"),
    );
    lines.push(
      s.attendancePercent != null
        ? `Attendance: ${s.attendancePercent}%`
        : "Attendance: unavailable",
    );
    lines.push("Subjects:");
    for (const sub of s.subjects) {
      if (sub.marksObtained == null) {
        lines.push(`  - ${sub.subjectName} [${sub.subjectId}]: no mark`);
        continue;
      }
      lines.push(
        `  - ${sub.subjectName} [${sub.subjectId}]: ${sub.marksObtained}/${sub.maxMarks}, grade ${sub.grade}` +
          (sub.previousGrade ? `, previous grade ${sub.previousGrade}` : "") +
          fmtDelta(sub.deltaPercent),
      );
    }
    if (s.coScholastic.length) {
      lines.push(
        "Co-scholastic: " +
          s.coScholastic.map((c) => `${c.domainLabel} — ${c.ratingLabel}`).join("; "),
      );
    } else {
      lines.push("Co-scholastic: unavailable");
    }
    if (s.existingOverallRemark.trim()) {
      lines.push(`Teacher's existing note (keep consistent with it): ${s.existingOverallRemark.trim()}`);
    }
    return lines.join("\n");
  });
  return `Write remarks for these ${students.length} students:\n\n${blocks.join("\n\n")}`;
}

/** Parse the model's JSON. Returns null when the shape is unusable; drops
 * students the model invented and tolerates ones it forgot (the caller
 * reports those as not generated rather than filling in blanks). */
export function parseRemarkDraftsJson(
  text: string,
  expectedIds: string[],
): StudentRemarkDraft[] | null {
  try {
    const raw = JSON.parse(text) as {
      students?: {
        studentId?: unknown;
        overall?: unknown;
        subjects?: { subjectId?: unknown; remark?: unknown }[];
      }[];
    };
    if (!Array.isArray(raw.students)) return null;
    const allowed = new Set(expectedIds);
    const out: StudentRemarkDraft[] = [];
    for (const s of raw.students) {
      const id = String(s.studentId ?? "").trim();
      const overall = String(s.overall ?? "").trim();
      if (!id || !allowed.has(id) || !overall) continue;
      const subjects = Array.isArray(s.subjects)
        ? s.subjects
            .map((x) => ({
              subjectId: String(x?.subjectId ?? "").trim(),
              remark: String(x?.remark ?? "").trim(),
            }))
            .filter((x) => x.subjectId && x.remark)
        : [];
      out.push({ studentId: id, overall, overallHi: "", subjects });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

/** Split a roster into LLM-call-sized batches. */
export function chunkStudents<T>(items: T[], size = REMARK_STUDENTS_PER_LLM_CALL): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
