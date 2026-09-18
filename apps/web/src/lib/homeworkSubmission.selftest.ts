/**
 * Homework submitted on WhatsApp — which homework a photo belongs to, and
 * what everybody reads.
 * Run: npx tsx src/lib/homeworkSubmission.selftest.ts
 */
import assert from "node:assert/strict";
import {
  SUBMISSION_CODE_ALPHABET,
  chooseSubmissionTarget,
  makeSubmissionCode,
  parseSubmissionReply,
  renderRemarkSent,
  renderRemarkToParent,
  renderSubmissionAck,
  renderSubmissionAsk,
  renderTeacherPacket,
  renderUnknownCode,
  submitInviteLine,
  type SubmittablePost,
} from "./homeworkSubmission";
import { seedWaTemplates } from "./waTemplates";

console.log("homeworkSubmission.selftest.ts");

/* ── The code a teacher retypes ───────────────────────────────────── */
// No 0/O and no 1/I: a teacher reads this off a phone screen, often
// outdoors, and a code that can be read two ways costs a remark. L stays,
// because the office relay's codes keep it and staff learn one shape.
assert.doesNotMatch(SUBMISSION_CODE_ALPHABET, /[01OI]/);
for (let i = 0; i < 200; i += 1) {
  const c = makeSubmissionCode();
  assert.equal(c.length, 4);
  assert.ok([...c].every((ch) => SUBMISSION_CODE_ALPHABET.includes(ch)), c);
}
assert.equal(makeSubmissionCode(() => 0), "2222", "deterministic under a fixed source");

assert.deepEqual(parseSubmissionReply("#A7K2 well done"), { code: "A7K2", remark: "well done" });
assert.deepEqual(parseSubmissionReply("#a7k2: check Q3 again"), { code: "A7K2", remark: "check Q3 again" });
assert.deepEqual(parseSubmissionReply("  # A7K2  — neat work  "), { code: "A7K2", remark: "neat work" });
assert.deepEqual(parseSubmissionReply("#A7K2"), { code: "A7K2", remark: "" }, "a bare code is a question, not a remark");
assert.equal(parseSubmissionReply("well done"), null);
assert.equal(parseSubmissionReply("#A7K2X more"), null, "five characters is not a code");
assert.equal(parseSubmissionReply("#A0K2 hi"), null, "0 is not in the alphabet");
assert.equal(parseSubmissionReply("fees #A7K2"), null, "a code must start the message");

/* ── Which homework a photograph belongs to ───────────────────────── */
const post = (postId: string, studentName: string, subjectLabel: string, date: string): SubmittablePost => ({
  postId, studentId: `stu_${postId}`, studentName, subjectLabel, title: `${subjectLabel} work`, date,
});
const maths = post("p1", "AAROHI KUMARI", "Mathematics", "2026-09-18");
const hindi = post("p2", "AAROHI KUMARI", "Hindi", "2026-09-18");
const bro = post("p3", "AARUSH KUMAR", "Science", "2026-09-17");

assert.deepEqual(chooseSubmissionTarget({ candidates: [], caption: "" }), { kind: "none" });

const only = chooseSubmissionTarget({ candidates: [maths], caption: "" });
assert.equal(only.kind, "one");
if (only.kind === "one") assert.equal(only.post.postId, "p1");

// Two children, one named in the caption.
const named = chooseSubmissionTarget({ candidates: [maths, bro], caption: "Aarush ka homework" });
assert.equal(named.kind, "one");
if (named.kind === "one") assert.equal(named.post.postId, "p3");

// One child, two subjects, the subject named.
const bySubject = chooseSubmissionTarget({ candidates: [maths, hindi], caption: "hindi wala" });
assert.equal(bySubject.kind, "one");
if (bySubject.kind === "one") assert.equal(bySubject.post.postId, "p2");

// Answering the numbered list this sent a moment ago.
const byNumber = chooseSubmissionTarget({ candidates: [maths, hindi, bro], caption: "2" });
assert.equal(byNumber.kind, "one");
if (byNumber.kind === "one") assert.equal(byNumber.post.postId, "p2");
assert.equal(
  chooseSubmissionTarget({ candidates: [maths, hindi], caption: "9" }).kind,
  "ask",
  "a number past the end of the list decides nothing",
);

// Nothing decides it: ASK. Filing a child's work against their sibling's
// homework is a small humiliation for both, and invisible to the teacher.
const ambiguous = chooseSubmissionTarget({ candidates: [maths, hindi, bro], caption: "done" });
assert.equal(ambiguous.kind, "ask");
if (ambiguous.kind === "ask") assert.equal(ambiguous.options.length, 3);
assert.equal(
  chooseSubmissionTarget({ candidates: [maths, hindi, bro, post("p4", "X Y", "English", "2026-09-16"), post("p5", "X Y", "EVS", "2026-09-16"), post("p6", "X Y", "Arts", "2026-09-15")], caption: "" }).kind,
  "ask",
);
const capped = chooseSubmissionTarget({ candidates: [maths, hindi, bro, post("p4", "X Y", "English", "2026-09-16"), post("p5", "X Y", "EVS", "2026-09-16"), post("p6", "X Y", "Arts", "2026-09-15")], caption: "" });
if (capped.kind === "ask") assert.ok(capped.options.length <= 5, "a family is not asked to read a menu of ten");

/* ── What people read ─────────────────────────────────────────────── */
const ask = renderSubmissionAsk({ options: [maths, hindi], language: "en" });
assert.match(ask, /1\. AAROHI — Mathematics/);
assert.match(ask, /2\. AAROHI — Hindi/);
assert.match(renderSubmissionAsk({ options: [maths], language: "hi" }), /नंबर/);

const ack = renderSubmissionAck({ childName: "Aarohi", subjectLabel: "Mathematics", teacherName: "Sujata Bajpayee", language: "en" });
assert.match(ack, /Got Aarohi's Mathematics homework/);
assert.match(ack, /Sujata Bajpayee/);
assert.match(ack, /reply here/, "the loop stays on WhatsApp");
assert.match(
  renderSubmissionAck({ childName: "आरोही", subjectLabel: "गणित", teacherName: "", language: "hi" }),
  /कक्षा शिक्षक/,
  "no teacher named still reads as a sentence",
);

const packet = renderTeacherPacket({
  childName: "AAROHI KUMARI", classLabel: "Class 5-A", subjectLabel: "Mathematics",
  title: "Exercise 5.2", code: "A7K2", submittedAtLabel: "18 Sep 2026, 4:20 pm", note: "she did it herself",
});
assert.match(packet, /#A7K2/);
assert.match(packet, /she did it herself/, "the parent's own words reach the teacher");
assert.match(packet, /Nothing is marked or graded by this/, "the teacher is told what this is not");

const remark = renderRemarkToParent({ childName: "Aarohi", subjectLabel: "Mathematics", teacherName: "Sujata", remark: "Well done", language: "en" });
assert.match(remark, /“Well done”/, "the teacher's words, as written");
assert.match(remark, /Sujata/);
assert.match(renderRemarkSent({ childName: "Aarohi", ok: true }), /Sent to Aarohi's family/);
assert.match(renderRemarkSent({ childName: "Aarohi", ok: false, error: "no number" }), /saved on the submission/);
assert.match(renderUnknownCode("A7K2"), /#A7K2/);

/* ── The invitation that starts the loop ──────────────────────────── */
for (const lang of ["en", "hi"] as const) {
  assert.match(submitInviteLine(lang), /photo|फ़ोटो/);
}
// And it is in the template itself, in both languages — the whole point is
// that a parent never has to open anything.
const full = seedWaTemplates().filter((t) => t.familyKey === "homework_published_full");
assert.equal(full.length, 2);
for (const t of full) {
  const lang = t.language === "hi" ? "hi" : "en";
  assert.ok(
    t.body.includes(submitInviteLine(lang)),
    `${t.language}: the template must promise exactly what submitInviteLine says, word for word`,
  );
}

console.log("ok");
