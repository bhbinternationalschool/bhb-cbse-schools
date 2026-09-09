import "server-only";

/**
 * In-class questions, photographed answers, and the after-class note —
 * persistence, photo storage and the pushes. Authorization is the
 * caller's; everything here trusts its arguments.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchAllPages } from "@/lib/supabase/pageAll";
import { sendPushToSubject } from "@/lib/webPush.server";
import { loadMasters } from "@/lib/masters";
import { TENANT } from "@/lib/types";
import { generateOnlineClassSummaryJson } from "@/lib/aiLlm.server";
import { postHomeworkServer } from "@/lib/homeworkPost.server";
import type { DemoSession } from "@/lib/auth";
import type { MastersState } from "@/lib/masters";
import { sectionRoster, listJoins, type RosterChild } from "@/lib/onlineClasses.server";
import type { OnlineClassSession } from "@/lib/onlineClasses";
import {
  answerPhotoPath,
  cleanClassSummaryFacts,
  tallyAnswers,
  type AnswerVerdict,
  type ClassSummary,
  type OnlineClassAnswer,
  type OnlineClassQuestion,
} from "@/lib/onlineClassQa";

const QUESTIONS = "online_class_questions";
const ANSWERS = "online_class_answers";
const SUMMARIES = "online_class_summaries";
const BUCKET = "school-files";

type QRow = {
  id: string; session_id: string; order_no: number; text: string;
  asked_by: string; asked_at: string; closed_at: string | null;
};
type ARow = {
  id: string; question_id: string; session_id: string; student_id: string; household_id: string;
  photo_path: string; photo_mime: string; text: string; submitted_at: string;
  verdict: string; verdict_by: string; verdict_at: string | null;
};
type SRow = {
  session_id: string; taught_note: string; topic: string; summary_en: string;
  homework_title: string; homework_body: string; homework_due: string;
  generation_id: string; generated_at: string | null; homework_post_id: string;
  homework_posted_at: string | null; updated_at: string;
};

const fromQ = (r: QRow): OnlineClassQuestion => ({
  id: r.id, sessionId: r.session_id, orderNo: r.order_no || 0, text: r.text || "",
  askedBy: r.asked_by || "", askedAt: r.asked_at, closedAt: r.closed_at || "",
});
const fromA = (r: ARow): OnlineClassAnswer => ({
  id: r.id, questionId: r.question_id, sessionId: r.session_id, studentId: r.student_id,
  householdId: r.household_id || "", photoPath: r.photo_path || "", photoMime: r.photo_mime || "",
  text: r.text || "", submittedAt: r.submitted_at, verdict: (r.verdict as AnswerVerdict) || "",
  verdictBy: r.verdict_by || "", verdictAt: r.verdict_at || "",
});
const fromS = (r: SRow): ClassSummary => ({
  sessionId: r.session_id, taughtNote: r.taught_note || "", topic: r.topic || "",
  summaryEn: r.summary_en || "", homeworkTitle: r.homework_title || "",
  homeworkBody: r.homework_body || "", homeworkDue: r.homework_due || "",
  generationId: r.generation_id || "", generatedAt: r.generated_at || "",
  homeworkPostId: r.homework_post_id || "", homeworkPostedAt: r.homework_posted_at || "",
  updatedAt: r.updated_at,
});

function nid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

type Ok<T> = { ok: true; value: T };
type Fail = { ok: false; error: string };

// ─── Questions ───────────────────────────────────────────────────────

export async function listQuestions(sessionId: string): Promise<OnlineClassQuestion[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const res = await fetchAllPages<QRow>((from, to) =>
    ctx.sb.from(QUESTIONS).select("*").eq("tenant_id", ctx.tenantId)
      .eq("session_id", sessionId).order("id").range(from, to),
  );
  return res.rows.map(fromQ).sort((a, b) => a.orderNo - b.orderNo);
}

export async function listAnswers(sessionId: string): Promise<OnlineClassAnswer[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const res = await fetchAllPages<ARow>((from, to) =>
    ctx.sb.from(ANSWERS).select("*").eq("tenant_id", ctx.tenantId)
      .eq("session_id", sessionId).order("id").range(from, to),
  );
  return res.rows.map(fromA);
}

export async function getAnswer(answerId: string): Promise<OnlineClassAnswer | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data } = await ctx.sb.from(ANSWERS).select("*")
    .eq("tenant_id", ctx.tenantId).eq("id", answerId).maybeSingle();
  return data ? fromA(data as ARow) : null;
}

/**
 * Ask. The question reaches every household in the section as a push with
 * a deep link straight to the answer screen.
 */
export async function askQuestion(
  s: OnlineClassSession,
  text: string,
  askedBy: string,
): Promise<Ok<{ question: OnlineClassQuestion; pushed: number }> | Fail> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Database not reachable" };
  const existing = await listQuestions(s.id);
  const row = {
    id: nid("ocq"), tenant_id: ctx.tenantId, session_id: s.id,
    order_no: existing.length + 1, text, asked_by: askedBy, asked_at: new Date().toISOString(),
  };
  const { data, error } = await ctx.sb.from(QUESTIONS).insert(row).select("*").single();
  if (error || !data) return { ok: false, error: error?.message || "Insert failed" };
  const question = fromQ(data as QRow);

  const roster = await sectionRoster(s.classId, s.sectionId, s.academicYearCode);
  const byHousehold = new Map<string, string>();
  for (const c of roster) if (c.householdId && !byHousehold.has(c.householdId)) byHousehold.set(c.householdId, c.studentId);
  let pushed = 0;
  for (const [householdId, studentId] of byHousehold) {
    const r = await sendPushToSubject("parent", householdId, {
      title: `Question ${question.orderNo} from the teacher`,
      body: text.length > 140 ? `${text.slice(0, 137)}…` : text,
      url: `/online-classes?studentId=${encodeURIComponent(studentId)}&sessionId=${encodeURIComponent(s.id)}&qa=1`,
      data: { kind: "online_class_question", sessionId: s.id, questionId: question.id, studentId },
    }).catch(() => ({ sent: 0, expired: 0, failed: 0 }));
    pushed += r.sent;
  }
  return { ok: true, value: { question, pushed } };
}

export async function closeQuestion(questionId: string, closed: boolean): Promise<boolean> {
  const ctx = await getServerTenantContext();
  if (!ctx) return false;
  const { error } = await ctx.sb.from(QUESTIONS)
    .update({ closed_at: closed ? new Date().toISOString() : null })
    .eq("tenant_id", ctx.tenantId).eq("id", questionId);
  return !error;
}

// ─── Answers ─────────────────────────────────────────────────────────

/**
 * Store one child's photographed answer. A second send replaces the
 * first — a child who photographed the wrong page can try again, and the
 * teacher sees the latest. The verdict is cleared on replace: it was a
 * verdict on a different picture.
 */
export async function submitAnswer(input: {
  session: OnlineClassSession;
  question: OnlineClassQuestion;
  studentId: string;
  householdId: string;
  bytes: Uint8Array;
  mime: "image/jpeg" | "image/png" | "image/webp";
  text?: string;
}): Promise<Ok<OnlineClassAnswer> | Fail> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Database not reachable" };
  const ext = input.mime === "image/png" ? "png" : input.mime === "image/webp" ? "webp" : "jpg";
  const path = answerPhotoPath(input.session.id, input.question.id, input.studentId, ext);
  const { error: upErr } = await ctx.sb.storage.from(BUCKET).upload(path, Buffer.from(input.bytes), {
    contentType: input.mime, upsert: true, cacheControl: "3600",
  });
  if (upErr) return { ok: false, error: `Photo not stored: ${upErr.message}` };

  const now = new Date().toISOString();
  const { data: prev } = await ctx.sb.from(ANSWERS).select("id")
    .eq("tenant_id", ctx.tenantId).eq("question_id", input.question.id)
    .eq("student_id", input.studentId).maybeSingle();
  const fields = {
    photo_path: path, photo_mime: input.mime, text: (input.text || "").slice(0, 500),
    submitted_at: now, verdict: "", verdict_by: "", verdict_at: null,
  };
  const q = prev
    ? ctx.sb.from(ANSWERS).update(fields).eq("id", (prev as { id: string }).id).select("*").single()
    : ctx.sb.from(ANSWERS).insert({
        id: nid("oca"), tenant_id: ctx.tenantId, question_id: input.question.id,
        session_id: input.session.id, student_id: input.studentId,
        household_id: input.householdId, ...fields,
      }).select("*").single();
  const { data, error } = await q;
  if (error || !data) return { ok: false, error: error?.message || "Save failed" };
  return { ok: true, value: fromA(data as ARow) };
}

export async function downloadAnswerPhoto(
  a: OnlineClassAnswer,
): Promise<{ bytes: ArrayBuffer; mime: string } | null> {
  const ctx = await getServerTenantContext();
  if (!ctx || !a.photoPath) return null;
  const { data, error } = await ctx.sb.storage.from(BUCKET).download(a.photoPath);
  if (error || !data) return null;
  return { bytes: await data.arrayBuffer(), mime: a.photoMime || "image/jpeg" };
}

/** The teacher's mark. Tells the family at once. */
export async function setVerdict(
  a: OnlineClassAnswer,
  verdict: AnswerVerdict,
  by: string,
  questionText: string,
): Promise<boolean> {
  const ctx = await getServerTenantContext();
  if (!ctx) return false;
  const { error } = await ctx.sb.from(ANSWERS).update({
    verdict, verdict_by: verdict ? by : "", verdict_at: verdict ? new Date().toISOString() : null,
  }).eq("tenant_id", ctx.tenantId).eq("id", a.id);
  if (error) return false;
  if (verdict && a.householdId) {
    const word = verdict === "right" ? "Correct ✓" : verdict === "partial" ? "Partly right" : "Not correct — try again";
    await sendPushToSubject("parent", a.householdId, {
      title: word,
      body: questionText.length > 120 ? `${questionText.slice(0, 117)}…` : questionText,
      url: `/online-classes?studentId=${encodeURIComponent(a.studentId)}&sessionId=${encodeURIComponent(a.sessionId)}&qa=1`,
      data: { kind: "online_class_verdict", sessionId: a.sessionId, questionId: a.questionId, studentId: a.studentId },
    }).catch(() => undefined);
  }
  return true;
}

// ─── The teacher's wall ──────────────────────────────────────────────

export type AnswerWall = {
  questions: (OnlineClassQuestion & {
    tally: ReturnType<typeof tallyAnswers>;
    answers: (OnlineClassAnswer & { fullName: string; rollNo: string })[];
    notAnswered: { studentId: string; fullName: string; rollNo: string }[];
  })[];
  rosterCount: number;
};

export async function answerWall(s: OnlineClassSession): Promise<AnswerWall> {
  const [questions, answers, roster] = await Promise.all([
    listQuestions(s.id), listAnswers(s.id), sectionRoster(s.classId, s.sectionId, s.academicYearCode),
  ]);
  const byStudent = new Map<string, RosterChild>(roster.map((c) => [c.studentId, c]));
  return {
    rosterCount: roster.length,
    questions: questions.map((q) => {
      const mine = answers.filter((a) => a.questionId === q.id)
        .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
      const answered = new Set(mine.map((a) => a.studentId));
      return {
        ...q,
        tally: tallyAnswers(q, answers),
        answers: mine.map((a) => ({
          ...a,
          fullName: byStudent.get(a.studentId)?.fullName || a.studentId,
          rollNo: byStudent.get(a.studentId)?.rollNo || "",
        })),
        notAnswered: roster.filter((c) => !answered.has(c.studentId))
          .map((c) => ({ studentId: c.studentId, fullName: c.fullName, rollNo: c.rollNo })),
      };
    }),
  };
}

// ─── Summary ─────────────────────────────────────────────────────────

export async function getSummary(sessionId: string): Promise<ClassSummary | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data } = await ctx.sb.from(SUMMARIES).select("*")
    .eq("tenant_id", ctx.tenantId).eq("session_id", sessionId).maybeSingle();
  return data ? fromS(data as SRow) : null;
}

export async function saveSummary(
  sessionId: string,
  patch: Partial<Pick<ClassSummary, "taughtNote" | "topic" | "summaryEn" | "homeworkTitle" | "homeworkBody" | "homeworkDue" | "generationId" | "generatedAt" | "homeworkPostId" | "homeworkPostedAt">>,
): Promise<ClassSummary | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const row: Record<string, unknown> = { session_id: sessionId, tenant_id: ctx.tenantId, updated_at: new Date().toISOString() };
  if (patch.taughtNote !== undefined) row.taught_note = patch.taughtNote;
  if (patch.topic !== undefined) row.topic = patch.topic;
  if (patch.summaryEn !== undefined) row.summary_en = patch.summaryEn;
  if (patch.homeworkTitle !== undefined) row.homework_title = patch.homeworkTitle;
  if (patch.homeworkBody !== undefined) row.homework_body = patch.homeworkBody;
  if (patch.homeworkDue !== undefined) row.homework_due = patch.homeworkDue;
  if (patch.generationId !== undefined) row.generation_id = patch.generationId;
  if (patch.generatedAt !== undefined) row.generated_at = patch.generatedAt || null;
  if (patch.homeworkPostId !== undefined) row.homework_post_id = patch.homeworkPostId;
  if (patch.homeworkPostedAt !== undefined) row.homework_posted_at = patch.homeworkPostedAt || null;
  const { data, error } = await ctx.sb.from(SUMMARIES).upsert(row, { onConflict: "session_id" }).select("*").single();
  if (error || !data) return null;
  return fromS(data as SRow);
}

/**
 * Draft the note and the homework from the teacher's line plus the
 * class's own numbers. Saves the draft so the teacher can edit it later
 * from either device; nothing is posted anywhere until they say so.
 */
export async function generateSummary(
  s: OnlineClassSession,
  taughtNote: string,
): Promise<Ok<ClassSummary> | Fail> {
  const masters = loadMasters();
  const cls = masters.classes.find((c) => c.id === s.classId)?.name || "";
  const sec = masters.sections.find((x) => x.id === s.sectionId)?.name || "";
  const [questions, answers, roster, joins] = await Promise.all([
    listQuestions(s.id), listAnswers(s.id),
    sectionRoster(s.classId, s.sectionId, s.academicYearCode), listJoins(s.id),
  ]);
  const facts = cleanClassSummaryFacts({
    classLabel: `${cls} ${sec}`.trim(),
    subjectName: masters.subjects.find((x) => x.id === s.subjectId)?.nameEn || "",
    date: s.date, startTime: s.startTime, endTime: s.endTime,
    teacherName: masters.staff.find((x) => x.id === s.teacherId)?.fullName || "",
    title: s.title, taughtNote,
    rosterCount: roster.length, joinedCount: joins.length,
    questions: questions.map((q) => tallyAnswers(q, answers)),
  });
  if (!facts) return { ok: false, error: "Say in a line what was taught first" };
  const r = await generateOnlineClassSummaryJson({ facts, schoolName: TENANT.nameDisplay });
  if (!r.ok) return { ok: false, error: r.error };
  // Due date: two days on, skipping Sunday.
  const due = new Date(`${s.date}T00:00:00+05:30`);
  due.setDate(due.getDate() + 2);
  if (due.getDay() === 0) due.setDate(due.getDate() + 1);
  const saved = await saveSummary(s.id, {
    taughtNote: facts.taughtNote,
    topic: r.draft.topic,
    summaryEn: r.draft.summary,
    homeworkTitle: r.draft.homeworkTitle,
    homeworkBody: r.draft.homeworkBody,
    homeworkDue: due.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
    generationId: r.generationId,
    generatedAt: new Date().toISOString(),
  });
  if (!saved) return { ok: false, error: "Draft not saved" };
  return { ok: true, value: saved };
}

/** Post the (edited) homework to the diary through the shared homework path. */
export async function postSummaryHomework(input: {
  session: OnlineClassSession;
  summary: ClassSummary;
  demoSession: DemoSession;
  masters: MastersState;
}): Promise<Ok<ClassSummary> | Fail> {
  const { session: s, summary } = input;
  if (summary.homeworkPostId) return { ok: false, error: "Already posted to the diary" };
  if (!summary.homeworkTitle.trim() || !summary.homeworkBody.trim()) {
    return { ok: false, error: "Give the homework a title and a task" };
  }
  const r = await postHomeworkServer({
    session: input.demoSession,
    masters: input.masters,
    classId: s.classId,
    sectionId: s.sectionId,
    subjectId: s.subjectId,
    title: summary.homeworkTitle.trim(),
    bodyEn: summary.homeworkBody.trim(),
    date: s.date,
    dueAt: summary.homeworkDue ? `${summary.homeworkDue}T18:00:00+05:30` : undefined,
    requiresSubmit: true,
  });
  if (!r.ok) return { ok: false, error: r.error };
  const saved = await saveSummary(s.id, {
    homeworkPostId: r.post.id,
    homeworkPostedAt: new Date().toISOString(),
  });
  return saved ? { ok: true, value: saved } : { ok: false, error: "Posted, but the link back was not saved" };
}
