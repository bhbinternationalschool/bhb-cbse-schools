/**
 * One child's homework record, out of the class feed.
 *
 * Homework is published to a SECTION, and whether a particular child did it
 * lives in a separate submissions list. So "has my son been doing his
 * homework?" — asked at every PTM and every fee call — had no screen to
 * answer it: the teacher had to remember, or scroll the feed post by post.
 *
 * The rule this file is built around: ONLY WORK THAT ASKED FOR A SUBMISSION
 * COUNTS AGAINST THE CHILD. Most posts are "read pages 12-14" with nothing
 * to hand in; counting those as unsubmitted would brand every child in the
 * school a defaulter and make the number worthless. The rate is out of the
 * posts that actually required something, and when nothing did, there is no
 * rate — not 0%.
 */

import {
  listFeedForStudent,
  type HomeworkPost,
  type HomeworkState,
} from "@/lib/homework";
import type { SisStudent } from "@/lib/sis";

export type StudentHomeworkStatus =
  /** Nothing to hand in — a reading or a notice. */
  | "not_required"
  /** Handed in, teacher has not ticked it yet. */
  | "submitted"
  /** Handed in and acknowledged by the teacher. */
  | "acknowledged"
  /** Required, not handed in, and the due time has not passed. */
  | "pending"
  /** Required, not handed in, due time gone. */
  | "overdue";

export type StudentHomeworkRow = {
  postId: string;
  date: string;
  subjectId: string;
  title: string;
  dueAt: string;
  teacherName: string;
  requiresSubmit: boolean;
  status: StudentHomeworkStatus;
  submittedAt: string;
  acknowledgedAt: string;
  /** Did anyone in the family open it in the parent app? */
  seenByFamily: boolean;
};

export type StudentHomeworkSummary = {
  /** Newest first. */
  rows: StudentHomeworkRow[];
  posts: number;
  /** Posts that asked for something to be handed in. */
  requiring: number;
  submitted: number;
  acknowledged: number;
  /** Required, not submitted, still inside the due time. */
  pending: number;
  /** Required, not submitted, due time passed. */
  overdue: number;
  /** submitted ÷ requiring, or null when nothing was ever required. */
  submissionRate: number | null;
  /** Posts the family opened ÷ posts, or null when there are none. */
  seenRate: number | null;
  lastPostDate: string;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function studentHomeworkRecord(
  state: HomeworkState,
  student: SisStudent,
  opts?: { now?: Date; fromDate?: string; toDate?: string },
): StudentHomeworkSummary {
  const now = opts?.now || new Date();
  // The same feed the parent app shows: published only, this section, this
  // year. Reusing it means the profile and the parent's screen cannot
  // disagree about what was even set.
  const { posts } = listFeedForStudent(state, student, {
    fromDate: opts?.fromDate,
    toDate: opts?.toDate,
  });

  const rows: StudentHomeworkRow[] = posts.map((p: HomeworkPost) => {
    const sub = (state.submissions || []).find(
      (s) => s.postId === p.id && s.studentId === student.id,
    );
    const seen = (state.seen || []).some(
      (s) =>
        s.kind === "post" && s.refId === p.id && s.studentId === student.id,
    );
    const dueAt = p.dueAt || "";
    const duePassed = !!dueAt && Date.parse(dueAt) < now.getTime();

    let status: StudentHomeworkStatus;
    if (sub?.teacherAckAt) status = "acknowledged";
    else if (sub?.submittedAt) status = "submitted";
    else if (!p.requiresSubmit) status = "not_required";
    // No due time is not a missed deadline: the teacher set none.
    else if (duePassed) status = "overdue";
    else status = "pending";

    return {
      postId: p.id,
      date: p.date,
      subjectId: p.subjectId,
      title: p.title,
      dueAt,
      teacherName: p.teacherName || "",
      requiresSubmit: !!p.requiresSubmit,
      status,
      submittedAt: sub?.submittedAt || "",
      acknowledgedAt: sub?.teacherAckAt || "",
      seenByFamily: seen,
    };
  });

  let requiring = 0;
  let submitted = 0;
  let acknowledged = 0;
  let pending = 0;
  let overdue = 0;
  let seenCount = 0;
  for (const r of rows) {
    if (r.seenByFamily) seenCount += 1;
    // A child who handed in work the teacher had marked optional still did
    // it, and it still counts — both in the numerator and the denominator.
    const counts = r.requiresSubmit || !!r.submittedAt;
    if (!counts) continue;
    requiring += 1;
    if (r.status === "acknowledged") {
      acknowledged += 1;
      submitted += 1;
    } else if (r.status === "submitted") submitted += 1;
    else if (r.status === "overdue") overdue += 1;
    else if (r.status === "pending") pending += 1;
  }

  return {
    rows,
    posts: rows.length,
    requiring,
    submitted,
    acknowledged,
    pending,
    overdue,
    submissionRate:
      requiring > 0 ? round1((submitted / requiring) * 100) : null,
    seenRate: rows.length > 0 ? round1((seenCount / rows.length) * 100) : null,
    lastPostDate: rows[0]?.date || "",
  };
}

export function homeworkStatusLabel(s: StudentHomeworkStatus): string {
  switch (s) {
    case "acknowledged":
      return "Checked";
    case "submitted":
      return "Submitted";
    case "pending":
      return "To submit";
    case "overdue":
      return "Not submitted";
    default:
      return "Nothing to submit";
  }
}
