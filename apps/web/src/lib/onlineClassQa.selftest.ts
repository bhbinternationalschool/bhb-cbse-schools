/**
 * Self-test: an in-class answer is a child's work, and the note only
 * says what the teacher said.
 * Run: npx tsx apps/web/src/lib/onlineClassQa.selftest.ts
 */

import assert from "node:assert/strict";

import {
  answerPhotoPath,
  buildClassSummaryUserPrompt,
  cleanClassSummaryFacts,
  parseClassSummaryJson,
  readQuestionText,
  readVerdict,
  tallyAnswers,
} from "./onlineClassQa";

console.log("onlineClassQa.selftest.ts");

assert.equal(readQuestionText("  Solve   3/4 + 1/2 "), "Solve 3/4 + 1/2");
assert.equal(readQuestionText("x"), null, "one character is not a question");
assert.equal(readQuestionText("a".repeat(601)), null);

assert.equal(readVerdict("right"), "right");
assert.equal(readVerdict(""), "", "clearing a verdict is allowed");
assert.equal(readVerdict("correct"), null, "only the three words");

// The photo path cannot escape its folder whatever the ids contain.
assert.equal(
  answerPhotoPath("ocl_1", "../q", "st/../x", "jpg"),
  "online-classes/ocl_1/q/stx.jpg",
);

// The summary needs the teacher's own line; without it there is nothing to say.
assert.equal(cleanClassSummaryFacts({ taughtNote: "  " }), null);
const facts = cleanClassSummaryFacts({
  classLabel: "5 A",
  subjectName: "Maths",
  date: "2026-09-10",
  startTime: "10:00",
  endTime: "10:40",
  taughtNote: "Adding fractions with different denominators",
  rosterCount: 30,
  joinedCount: 22,
  questions: [{ text: "3/4 + 1/2", answered: 18, right: 11, wrong: 5, partial: 0, unchecked: 2 }],
})!;
assert.ok(facts);
const prompt = buildClassSummaryUserPrompt(facts);
assert.match(prompt, /joined the online class: 22/);
assert.match(prompt, /18 answered; 11 right/);
assert.match(buildClassSummaryUserPrompt({ ...facts, questions: [] }), /none asked/);

// A parser that refuses a half answer, and tolerates prose around the JSON.
assert.equal(parseClassSummaryJson('{"topic":"x","summary":"s"}'), null, "homework missing");
const parsed = parseClassSummaryJson(
  'Here you go:\n{"topic":"Fractions","summary":"The class added fractions.","homeworkTitle":"Fractions practice","homeworkBody":"1. Add 1/3 + 1/6\\n2. Add 2/5 + 3/10"}\nThanks',
);
assert.ok(parsed);
assert.equal(parsed!.topic, "Fractions");
assert.match(parsed!.homeworkBody, /^1\. Add/);

// Tally counts only this question's answers.
const q = { id: "q1", sessionId: "s", orderNo: 1, text: "Q", askedBy: "", askedAt: "", closedAt: "" };
const a = (questionId: string, verdict: "" | "right" | "wrong" | "partial") => ({
  id: `${questionId}-${Math.random()}`, questionId, sessionId: "s", studentId: "x", householdId: "",
  photoPath: "", photoMime: "", text: "", submittedAt: "", verdict, verdictBy: "", verdictAt: "",
});
const t = tallyAnswers(q, [a("q1", "right"), a("q1", ""), a("q2", "wrong")]);
assert.deepEqual(t, { text: "Q", answered: 2, right: 1, wrong: 0, partial: 0, unchecked: 1 });

console.log("ok");
