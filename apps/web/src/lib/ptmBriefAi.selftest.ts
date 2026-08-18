import assert from "node:assert/strict";

import {
  buildPtmBriefSystemPrompt,
  buildPtmBriefUserPrompt,
  cleanPtmBriefFacts,
  parsePtmBriefJson,
} from "./ptmBriefAi";

console.log("ptmBriefAi.selftest.ts");

// ─── cleaner ───────────────────────────────────────────────────────────
{
  const f = cleanPtmBriefFacts({
    studentId: "stu-1",
    firstName: "Riya",
    classLabel: "VIII-B",
    terms: [
      { label: "PT1", percent: 61.25, overallGrade: "B2", subjects: [{ subjectName: "Maths", marksObtained: 24, maxMarks: 40, grade: "B2" }] },
      { label: "Half Yearly", percent: 70.04, overallGrade: "B1", subjects: [] },
      { label: "Final", percent: 75, overallGrade: "B1", subjects: [] },
    ],
    attendancePercent: 88.46,
    homework: { assigned: 12, submitted: 9 },
    discipline: { incidents: 1, meritPoints: 5, demeritPoints: 2, recent: [{ date: "2026-07-02", categoryLabel: "Late arrival", escalationLabel: "None" }] },
    priorFeedback: [{ date: "2026-05-10", strengths: "Reads well", areas: "", followUp: "Practice tables" }],
    teacherNote: "",
  });
  assert.ok(f);
  assert.equal(f.terms.length, 2, "keeps the last two terms");
  assert.equal(f.terms[0].label, "Half Yearly");
  assert.equal(f.terms[0].percent, 70);
  assert.equal(f.attendancePercent, 88.5);
  assert.deepEqual(f.homework, { assigned: 12, submitted: 9 });
  assert.equal(f.discipline?.recent.length, 1);
  assert.equal(f.priorFeedback.length, 1);
}
{
  // Absent stays absent — never zero.
  const f = cleanPtmBriefFacts({ studentId: "s", firstName: "Arjun", terms: [{ label: "PT1", percent: 40, overallGrade: "C2" }] });
  assert.ok(f);
  assert.equal(f.attendancePercent, null);
  assert.equal(f.homework, null);
  assert.equal(f.discipline, null);
  const user = buildPtmBriefUserPrompt(f);
  assert.match(user, /Attendance: not available/);
  assert.match(user, /Homework: not available/);
  assert.match(user, /Conduct log: not available/);
  assert.doesNotMatch(user, /Earlier PTM notes/);
}
{
  // Nothing to brief on → null (route answers 400, no LLM call).
  assert.equal(cleanPtmBriefFacts({ studentId: "s", firstName: "X" }), null);
  assert.equal(cleanPtmBriefFacts({ firstName: "X", terms: [{ label: "PT1", percent: 50 }] }), null, "no studentId");
  // A teacher note alone is enough (they may want a brief for a new admission).
  assert.ok(cleanPtmBriefFacts({ studentId: "s", firstName: "X", teacherNote: "new admission, parent anxious" }));
}

// ─── prompts ───────────────────────────────────────────────────────────
{
  const sys = buildPtmBriefSystemPrompt({ language: "en", schoolName: "BHB" });
  assert.match(sys, /three short paragraphs/);
  assert.match(sys, /do not mention it at all/);
  assert.match(sys, /Do not diagnose/);
  assert.match(buildPtmBriefSystemPrompt({ language: "hi", schoolName: "BHB" }), /Devanagari/);

  const f = cleanPtmBriefFacts({
    studentId: "s",
    firstName: "Riya",
    classLabel: "VIII-B",
    terms: [{ label: "PT1", percent: 61, overallGrade: "B2", subjects: [{ subjectName: "Maths", marksObtained: null, maxMarks: 40, grade: "—" }] }],
    homework: { assigned: 0, submitted: 0 },
    discipline: { incidents: 0, meritPoints: 0, demeritPoints: 0, recent: [] },
    teacherNote: "father travels a lot",
  })!;
  const user = buildPtmBriefUserPrompt(f);
  assert.match(user, /Student: Riya · Class VIII-B/);
  assert.match(user, /PT1: 61% overall, grade B2/);
  assert.match(user, /Maths: absent\/no mark/);
  assert.match(user, /Homework: no submissions were due yet/);
  assert.match(user, /Conduct log: no incidents recorded this year/);
  assert.match(user, /Teacher's note: father travels a lot/);
}

// ─── parser ────────────────────────────────────────────────────────────
{
  const d = parsePtmBriefJson(JSON.stringify({ observations: "a\r\nb", concerns: "", suggestions: "c", extra: 1 }));
  assert.ok(d);
  assert.equal(d.observations, "a\nb");
  assert.equal(d.concerns, "");
  assert.equal(parsePtmBriefJson("nope"), null);
  assert.equal(parsePtmBriefJson(JSON.stringify({ concerns: "only" })), null, "needs observations + suggestions");
}

console.log("OK — ptmBriefAi.selftest.ts");
