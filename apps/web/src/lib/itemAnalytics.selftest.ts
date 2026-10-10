import assert from "node:assert/strict";

import { emptyQuestion } from "./examPapers";
import type { StudentItemScore } from "./exams";
import {
  buildPedagogyUserPrompt,
  cleanPedagogyFacts,
  indexItemScores,
  parsePedagogyJson,
  rollupItemScores,
  studentsBelowHalf,
} from "./itemAnalytics";

console.log("itemAnalytics.selftest.ts");

const q1 = emptyQuestion({ id: "q1", marks: 2, unitId: "u1", competencyCode: "M801", bloomLevel: "remember", type: "mcq" });
const q2 = emptyQuestion({ id: "q2", marks: 4, unitId: "u1", competencyCode: "M802", bloomLevel: "apply", type: "competency" });
const q3 = emptyQuestion({ id: "q3", marks: 4, unitId: "u2", competencyCode: "", bloomLevel: "apply", type: "short" });
const questions = [q1, q2, q3];

const sc = (studentId: string, questionId: string, marks: number | null): StudentItemScore => ({
  studentId,
  subjectId: "sub",
  paperId: "p1",
  setCode: "A",
  questionId,
  marks,
});
const scores: StudentItemScore[] = [
  // 6 students; everyone aces q1, most fail q2, q3 mixed; s6 unmarked on q3
  ...["s1", "s2", "s3", "s4", "s5", "s6"].map((s) => sc(s, "q1", 2)),
  sc("s1", "q2", 1), sc("s2", "q2", 0), sc("s3", "q2", 1), sc("s4", "q2", 4), sc("s5", "q2", 0), sc("s6", "q2", 1),
  sc("s1", "q3", 4), sc("s2", "q3", 4), sc("s3", "q3", 2), sc("s4", "q3", 4), sc("s5", "q3", 1), sc("s6", "q3", null),
  // another paper/set — must be ignored
  sc("s1", "q1", 0) && { ...sc("s1", "q1", 0), paperId: "other" },
];
const idx = indexItemScores(scores, "p1", "A");
assert.equal(idx.size, 6);
assert.equal(idx.get("s1")?.get("q1"), 2, "other paper's row ignored");

const unitLabel = (id: string) => ({ u1: "Ch 3 · Quadrilaterals", u2: "Ch 6 · Squares" })[id] ?? id;

// by competency: M802 (q2) is weak, M801 (q1) is strong; q3 has no code → no bucket
{
  const rows = rollupItemScores({ questions, scoresByStudent: idx, dimension: "competency", unitLabel });
  assert.deepEqual(rows.map((r) => r.key), ["M802", "M801"], "weakest first");
  const m802 = rows[0];
  assert.equal(m802.students, 6);
  assert.equal(m802.avgPct, Math.round(((1 + 0 + 1 + 4 + 0 + 1) / 24) * 1000) / 10);
  assert.equal(m802.weak, true);
  assert.equal(m802.belowHalfShare, 0.83, "rounded to 2 dp");
  assert.equal(rows[1].avgPct, 100);
  assert.equal(rows[1].weak, false);
}

// by unit: u1 = q1+q2 (6 marks); u2 = q3 (4 marks); s6 unmarked on q3 → not counted in u2
{
  const rows = rollupItemScores({ questions, scoresByStudent: idx, dimension: "unit", unitLabel });
  const u2 = rows.find((r) => r.key === "u2")!;
  assert.equal(u2.label, "Ch 6 · Squares");
  assert.equal(u2.students, 5, "student with no mark in the bucket is not counted");
  const u1 = rows.find((r) => r.key === "u1")!;
  assert.equal(u1.maxMarks, 6);
}

// weak needs enough students: with min 7 nothing is weak
{
  const rows = rollupItemScores({ questions, scoresByStudent: idx, dimension: "competency", unitLabel, weakMinStudents: 7 });
  assert.ok(rows.every((r) => !r.weak));
}

// remedial group for q2
{
  const below = studentsBelowHalf({ questions, scoresByStudent: idx, questionIds: ["q2"] });
  assert.deepEqual(below.map((s) => s.studentId), ["s2", "s5", "s1", "s3", "s6"]);
}

// pedagogy prompt / parser / cleaner
{
  const f = cleanPedagogyFacts({
    classLabel: "VIII-A",
    subjectName: "Mathematics",
    examLabel: "PT1",
    studentsMarked: 6,
    weak: [{ dimension: "competency", label: "M802", avgPct: 29.2, belowHalfShare: 0.83, sampleQuestions: ["A park shaped like a quadrilateral…"] }],
    strong: [{ dimension: "competency", label: "M801", avgPct: 100 }],
    teacherNote: "",
  })!;
  assert.ok(f);
  const p = buildPedagogyUserPrompt(f);
  assert.match(p, /\[competency\] M802: avg 29%, 83% of students under half/);
  assert.match(p, /e\.g\. A park shaped/);
  assert.match(p, /Strong areas:\n- \[competency\] M801: avg 100%/);
  assert.deepEqual(parsePedagogyJson(JSON.stringify({ suggestions: ["Do X", ""], remedialFocus: "Y" })), { suggestions: ["Do X"], remedialFocus: "Y" });
  assert.equal(parsePedagogyJson(JSON.stringify({ suggestions: [] })), null);
  assert.equal(cleanPedagogyFacts({ subjectName: "M" }), null, "no areas → nothing to advise on");
}

console.log("OK — itemAnalytics.selftest.ts");
