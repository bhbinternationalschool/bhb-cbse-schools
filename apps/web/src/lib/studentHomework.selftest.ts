/**
 * Run: npx tsx src/lib/studentHomework.selftest.ts
 *
 * The rule that makes this number worth reading: only work that ASKED for a
 * submission counts against the child. Most homework is "read pages 12-14"
 * with nothing to hand in — count those as unsubmitted and every child in
 * the school is a defaulter, the figure means nothing, and the first parent
 * shown it is owed an apology.
 */
import assert from "node:assert/strict";
import {
  emptyHomeworkState,
  type HomeworkPost,
  type HomeworkState,
} from "./homework";
import type { SisStudent } from "./sis";
import { homeworkStatusLabel, studentHomeworkRecord } from "./studentHomework";

console.log("studentHomework.selftest.ts");

const AY = "2026-27";
const NOW = new Date("2026-09-11T04:00:00.000Z"); // 09:30 IST

const student = {
  id: "st1",
  academicYearCode: AY,
  sectionId: "secA",
  classId: "cls5",
} as unknown as SisStudent;

let n = 0;
function post(p: Partial<HomeworkPost>): HomeworkPost {
  n += 1;
  return {
    id: `hw${n}`,
    academicYearCode: AY,
    classId: "cls5",
    sectionId: "secA",
    subjectId: "sub_math",
    teacherStaffId: "t1",
    teacherName: "Mrs Rao",
    date: "2026-09-10",
    title: `Work ${n}`,
    bodyEn: "",
    bodyHi: "",
    attachments: [],
    dueAt: "",
    requiresSubmit: false,
    aiTutorHint: "",
    referenceAnswer: "",
    status: "published",
    createdAt: `2026-09-10T05:00:0${n}.000Z`,
    whatsappNotifiedAt: "",
    whatsappNotifiedCount: 0,
    ...p,
  };
}

function state(posts: HomeworkPost[], extra?: Partial<HomeworkState>): HomeworkState {
  return { ...emptyHomeworkState(), posts, ...extra };
}

// --- reading tasks are not unsubmitted homework -----------------------
{
  const s = studentHomeworkRecord(
    state([
      post({ requiresSubmit: false }),
      post({ requiresSubmit: false }),
      post({ requiresSubmit: false }),
    ]),
    student,
    { now: NOW },
  );
  assert.equal(s.posts, 3);
  assert.equal(s.requiring, 0, "nothing was asked for");
  assert.equal(
    s.submissionRate,
    null,
    "no rate at all — never 0%, which would read as 'never does his work'",
  );
  assert.equal(s.overdue, 0);
  assert.deepEqual(
    s.rows.map((r) => r.status),
    ["not_required", "not_required", "not_required"],
  );
  assert.equal(homeworkStatusLabel("not_required"), "Nothing to submit");
}

// --- the four states of a submission ----------------------------------
{
  const posts = [
    post({ id: "p_ack", requiresSubmit: true, dueAt: "2026-09-09T12:00:00.000Z" }),
    post({ id: "p_sub", requiresSubmit: true, dueAt: "2026-09-09T12:00:00.000Z" }),
    post({ id: "p_late", requiresSubmit: true, dueAt: "2026-09-10T12:00:00.000Z" }),
    post({ id: "p_open", requiresSubmit: true, dueAt: "2026-09-12T12:00:00.000Z" }),
  ];
  const s = studentHomeworkRecord(
    state(posts, {
      submissions: [
        {
          id: "s1",
          postId: "p_ack",
          studentId: "st1",
          note: "",
          photoUrl: "",
          submittedAt: "2026-09-09T10:00:00.000Z",
          teacherAckAt: "2026-09-09T13:00:00.000Z",
          teacherAckBy: "Mrs Rao",
        },
        {
          id: "s2",
          postId: "p_sub",
          studentId: "st1",
          note: "",
          photoUrl: "",
          submittedAt: "2026-09-09T11:00:00.000Z",
          teacherAckAt: "",
          teacherAckBy: "",
        },
      ],
    }),
    student,
    { now: NOW },
  );
  const byId = new Map(s.rows.map((r) => [r.postId, r.status]));
  assert.equal(byId.get("p_ack"), "acknowledged");
  assert.equal(byId.get("p_sub"), "submitted");
  assert.equal(byId.get("p_late"), "overdue", "due yesterday, nothing handed in");
  assert.equal(byId.get("p_open"), "pending", "due tomorrow — not a failure yet");

  assert.equal(s.requiring, 4);
  assert.equal(s.submitted, 2, "acknowledged work is also submitted work");
  assert.equal(s.acknowledged, 1);
  assert.equal(s.overdue, 1);
  assert.equal(s.pending, 1);
  assert.equal(s.submissionRate, 50);
}

// --- no due date is not a missed deadline -----------------------------
{
  const s = studentHomeworkRecord(
    state([post({ requiresSubmit: true, dueAt: "" })]),
    student,
    { now: NOW },
  );
  assert.equal(s.overdue, 0, "the teacher set no deadline");
  assert.equal(s.pending, 1);
  assert.equal(s.submissionRate, 0, "required, not submitted — that is 0 of 1");
}

// --- work handed in for an optional post still counts -----------------
{
  const s = studentHomeworkRecord(
    state([post({ id: "p_opt", requiresSubmit: false })], {
      submissions: [
        {
          id: "s3",
          postId: "p_opt",
          studentId: "st1",
          note: "",
          photoUrl: "",
          submittedAt: "2026-09-10T10:00:00.000Z",
          teacherAckAt: "",
          teacherAckBy: "",
        },
      ],
    }),
    student,
    { now: NOW },
  );
  assert.equal(s.requiring, 1, "he did it — it counts");
  assert.equal(s.submitted, 1);
  assert.equal(s.submissionRate, 100);
}

// --- another child's submission is not this child's --------------------
{
  const s = studentHomeworkRecord(
    state([post({ id: "p1", requiresSubmit: true, dueAt: "2026-09-09T12:00:00.000Z" })], {
      submissions: [
        {
          id: "s4",
          postId: "p1",
          studentId: "someone_else",
          note: "",
          photoUrl: "",
          submittedAt: "2026-09-09T10:00:00.000Z",
          teacherAckAt: "",
          teacherAckBy: "",
        },
      ],
    }),
    student,
    { now: NOW },
  );
  assert.equal(s.rows[0]?.status, "overdue");
  assert.equal(s.submissionRate, 0);
}

// --- withdrawn work, another section, another year: all out -----------
{
  const s = studentHomeworkRecord(
    state([
      post({ status: "withdrawn", requiresSubmit: true }),
      post({ sectionId: "secB", requiresSubmit: true }),
      post({ academicYearCode: "2025-26", requiresSubmit: true }),
      post({ requiresSubmit: true, dueAt: "2026-09-20T12:00:00.000Z" }),
    ]),
    student,
    { now: NOW },
  );
  assert.equal(s.posts, 1, "only this section's published work, this year");
  assert.equal(s.requiring, 1);
}

// --- did the family even open it? -------------------------------------
{
  const s = studentHomeworkRecord(
    state([post({ id: "a" }), post({ id: "b" }), post({ id: "c" }), post({ id: "d" })], {
      seen: [
        {
          id: "v1",
          kind: "post",
          refId: "a",
          studentId: "st1",
          householdId: "hh1",
          seenAt: "2026-09-10T06:00:00.000Z",
        },
      ],
    }),
    student,
    { now: NOW },
  );
  assert.equal(s.seenRate, 25, "one of four opened at home");
  assert.equal(s.rows.find((r) => r.postId === "a")?.seenByFamily, true);
  assert.equal(s.rows.find((r) => r.postId === "b")?.seenByFamily, false);
}

// --- nothing published at all -----------------------------------------
{
  const s = studentHomeworkRecord(state([]), student, { now: NOW });
  assert.equal(s.posts, 0);
  assert.equal(s.submissionRate, null);
  assert.equal(s.seenRate, null, "no posts → no seen rate either");
  assert.equal(s.lastPostDate, "");
}

// --- newest first ------------------------------------------------------
{
  const s = studentHomeworkRecord(
    state([
      post({ id: "old", date: "2026-09-01" }),
      post({ id: "new", date: "2026-09-10" }),
      post({ id: "mid", date: "2026-09-05" }),
    ]),
    student,
    { now: NOW },
  );
  assert.deepEqual(
    s.rows.map((r) => r.postId),
    ["new", "mid", "old"],
  );
  assert.equal(s.lastPostDate, "2026-09-10");
}

console.log("  all student-homework assertions passed");
