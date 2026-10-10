/**
 * Online class questions, answers and the after-class note — shapes,
 * validation and prompts. No I/O; onlineClassQa.server.ts persists.
 */

export type AnswerVerdict = "" | "right" | "wrong" | "partial";
export const ANSWER_VERDICTS: AnswerVerdict[] = ["right", "wrong", "partial"];

export type OnlineClassQuestion = {
  id: string;
  sessionId: string;
  orderNo: number;
  text: string;
  askedBy: string;
  askedAt: string;
  closedAt: string;
};

export type OnlineClassAnswer = {
  id: string;
  questionId: string;
  sessionId: string;
  studentId: string;
  householdId: string;
  photoPath: string;
  photoMime: string;
  text: string;
  submittedAt: string;
  verdict: AnswerVerdict;
  verdictBy: string;
  verdictAt: string;
};

export type ClassSummary = {
  sessionId: string;
  taughtNote: string;
  topic: string;
  summaryEn: string;
  homeworkTitle: string;
  homeworkBody: string;
  homeworkDue: string;
  generationId: string;
  generatedAt: string;
  homeworkPostId: string;
  homeworkPostedAt: string;
  updatedAt: string;
};

export function readQuestionText(raw: unknown): string | null {
  const t = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (t.length < 2 || t.length > 600) return null;
  return t;
}

export function readVerdict(raw: unknown): AnswerVerdict | null {
  const v = String(raw ?? "").trim();
  return v === "" || ANSWER_VERDICTS.includes(v as AnswerVerdict) ? (v as AnswerVerdict) : null;
}

/** Photo path inside school-files for one child's answer. */
export function answerPhotoPath(
  sessionId: string,
  questionId: string,
  studentId: string,
  ext: "jpg" | "png" | "webp",
): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  return `online-classes/${clean(sessionId)}/${clean(questionId)}/${clean(studentId)}.${ext}`;
}

// ─── Summary prompt ──────────────────────────────────────────────────

export type ClassSummaryFacts = {
  classLabel: string;
  subjectName: string;
  date: string;
  startTime: string;
  endTime: string;
  teacherName: string;
  title: string;
  /** The teacher's own words about what was taught. Required. */
  taughtNote: string;
  rosterCount: number;
  joinedCount: number;
  questions: {
    text: string;
    answered: number;
    right: number;
    wrong: number;
    partial: number;
    unchecked: number;
  }[];
};

export type ClassSummaryDraft = {
  topic: string;
  summary: string;
  homeworkTitle: string;
  homeworkBody: string;
};

export function cleanClassSummaryFacts(raw: Partial<ClassSummaryFacts>): ClassSummaryFacts | null {
  const taughtNote = String(raw.taughtNote ?? "").replace(/\s+/g, " ").trim().slice(0, 1200);
  if (taughtNote.length < 3) return null;
  return {
    classLabel: String(raw.classLabel ?? "").trim(),
    subjectName: String(raw.subjectName ?? "").trim(),
    date: String(raw.date ?? "").trim(),
    startTime: String(raw.startTime ?? "").trim(),
    endTime: String(raw.endTime ?? "").trim(),
    teacherName: String(raw.teacherName ?? "").trim(),
    title: String(raw.title ?? "").trim(),
    taughtNote,
    rosterCount: Math.max(0, Number(raw.rosterCount) || 0),
    joinedCount: Math.max(0, Number(raw.joinedCount) || 0),
    questions: (raw.questions ?? []).slice(0, 20).map((q) => ({
      text: String(q.text ?? "").trim().slice(0, 300),
      answered: Number(q.answered) || 0,
      right: Number(q.right) || 0,
      wrong: Number(q.wrong) || 0,
      partial: Number(q.partial) || 0,
      unchecked: Number(q.unchecked) || 0,
    })),
  };
}

export function buildClassSummarySystemPrompt(schoolName: string): string {
  return `You write the after-class note for a teacher at ${schoolName}, a CBSE school in rural Uttar Pradesh, India, after an online class held over video. The note goes into the school's records and is read by the principal and by the teacher next week. You also suggest one homework task for the same children.

Write in clear, plain English.

Rules:
- Use only the facts given. The teacher's own line about what was taught is the truth of the lesson; expand it, do not add topics the teacher did not mention.
- If the in-class questions are given with results, say how the class did on them in plain numbers ("14 of 18 answered the first question, 11 right"). If no questions were asked, do not mention questions.
- Never invent names, marks, page numbers, chapter numbers or textbook titles. Do not name individual children.
- The homework must follow directly from what was taught and take a child 20–30 minutes in a notebook. It must be doable without internet. Phrase it as instructions to the child, 2–5 short lines. Where the class did badly on a question, the homework may revisit that idea.
- No greeting, no sign-off, no markdown, no bullet symbols in the summary; the homework body may use numbered lines.

Respond with JSON only, exactly:
{"topic":"3–8 word topic label","summary":"one paragraph, 3–6 sentences","homeworkTitle":"short title, max 60 chars","homeworkBody":"the task, 2–5 lines separated by \\n"}`;
}

export function buildClassSummaryUserPrompt(f: ClassSummaryFacts): string {
  const L: string[] = [];
  L.push(`Class: ${f.classLabel || "not available"}`);
  L.push(`Subject: ${f.subjectName || "not available"}`);
  if (f.title) L.push(`Class title: ${f.title}`);
  L.push(`Date and time: ${f.date} ${f.startTime}–${f.endTime}`);
  L.push(`Teacher: ${f.teacherName || "not available"}`);
  L.push(`Children in the section: ${f.rosterCount}; joined the online class: ${f.joinedCount}`);
  L.push("");
  L.push(`What the teacher says was taught: ${f.taughtNote}`);
  L.push("");
  if (f.questions.length === 0) {
    L.push("In-class questions: none asked");
  } else {
    L.push("In-class questions and results:");
    f.questions.forEach((q, i) => {
      L.push(
        `${i + 1}. "${q.text}" — ${q.answered} answered; ${q.right} right, ${q.wrong} wrong, ${q.partial} partly right, ${q.unchecked} not yet checked`,
      );
    });
  }
  return L.join("\n");
}

export function parseClassSummaryJson(text: string): ClassSummaryDraft | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const j = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const s = (k: string, max: number) => String(j[k] ?? "").trim().slice(0, max);
    const out = {
      topic: s("topic", 80),
      summary: s("summary", 1500),
      homeworkTitle: s("homeworkTitle", 60),
      homeworkBody: s("homeworkBody", 1200),
    };
    if (!out.summary || !out.homeworkTitle || !out.homeworkBody) return null;
    return out;
  } catch {
    return null;
  }
}

/** Tally answers per question for the summary facts and the teacher's wall. */
export function tallyAnswers(
  question: OnlineClassQuestion,
  answers: OnlineClassAnswer[],
): ClassSummaryFacts["questions"][number] {
  const mine = answers.filter((a) => a.questionId === question.id);
  return {
    text: question.text,
    answered: mine.length,
    right: mine.filter((a) => a.verdict === "right").length,
    wrong: mine.filter((a) => a.verdict === "wrong").length,
    partial: mine.filter((a) => a.verdict === "partial").length,
    unchecked: mine.filter((a) => a.verdict === "").length,
  };
}
