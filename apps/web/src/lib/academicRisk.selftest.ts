import assert from "node:assert/strict";

import {
  assessStudentRisk,
  bandsDropped,
  buildRiskNoteUserPrompt,
  cleanRiskFacts,
  parseRiskNotesJson,
  type StudentRiskFacts,
} from "./academicRisk";

console.log("academicRisk.selftest.ts");

const base: StudentRiskFacts = {
  studentId: "s1",
  fullName: "Riya Singh",
  examLabel: "Half Yearly",
  percent: 72,
  overallGrade: "B1",
  previousExamLabel: "PT1",
  previousPercent: 74,
  previousGrade: "B1",
  subjects: [
    { subjectName: "Maths", grade: "B1", previousGrade: "B1" },
    { subjectName: "Science", grade: "B2", previousGrade: "B1" },
  ],
  attendancePercent: 92,
  incidents: 0,
  escalations: 0,
  homework: { assigned: 10, submitted: 9 },
};

// bands
assert.equal(bandsDropped("A1", "B1"), 2);
assert.equal(bandsDropped("B1", "A2"), -1, "improvement is negative, never a drop");
assert.equal(bandsDropped("—", "B1"), null, "no previous grade → not comparable");

// nothing wrong → none
{
  const r = assessStudentRisk(base);
  assert.equal(r.level, "none");
  assert.deepEqual(r.flags, []);
}

// unknown must not become fact: missing inputs fire nothing
{
  const r = assessStudentRisk({
    ...base,
    previousGrade: "",
    previousPercent: null,
    attendancePercent: null,
    incidents: null,
    homework: null,
    subjects: [{ subjectName: "Maths", grade: "B1", previousGrade: "" }],
  });
  assert.equal(r.level, "none");
}

// one soft flag → watch
{
  const r = assessStudentRisk({ ...base, overallGrade: "B2" }); // B1 → B2
  assert.equal(r.level, "watch");
  assert.equal(r.flags[0].id, "grade_drop");
  assert.match(r.flags[0].detail, /B1 in PT1 → B2 in Half Yearly/);
}

// stacked flags → high
{
  const r = assessStudentRisk({
    ...base,
    overallGrade: "C1",
    attendancePercent: 68,
    homework: { assigned: 8, submitted: 3 },
  });
  assert.equal(r.level, "high");
  assert.deepEqual(r.flags.map((f) => f.id), ["grade_drop", "low_attendance", "homework"]);
}

// below pass in 2 subjects is high on its own
{
  const r = assessStudentRisk({
    ...base,
    subjects: [
      { subjectName: "Maths", grade: "E", previousGrade: "D" },
      { subjectName: "Hindi", grade: "E", previousGrade: "" },
    ],
  });
  assert.equal(r.level, "high");
  const bp = r.flags.find((f) => f.id === "below_pass")!;
  assert.equal(bp.severity, 2);
  assert.match(bp.detail, /Maths \(E\), Hindi \(E\)/);
}

// escalation fires conduct even with 1 incident; homework needs enough due
{
  const r = assessStudentRisk({ ...base, incidents: 1, escalations: 1, homework: { assigned: 3, submitted: 0 } });
  assert.deepEqual(r.flags.map((f) => f.id), ["conduct"], "3 due is below the min-due floor");
}

// subject drops rule
{
  const r = assessStudentRisk({
    ...base,
    subjects: [
      { subjectName: "Maths", grade: "B2", previousGrade: "B1" },
      { subjectName: "Science", grade: "C1", previousGrade: "B2" },
      { subjectName: "English", grade: "A2", previousGrade: "A2" },
    ],
  });
  assert.equal(r.flags.find((f) => f.id === "subject_drops")?.label, "2 subjects slipped");
}

// prompt + parser
{
  const r = assessStudentRisk({ ...base, overallGrade: "C1" });
  const p = buildRiskNoteUserPrompt([{ ...base, overallGrade: "C1", flags: r.flags }]);
  assert.match(p, /studentId: s1/);
  assert.match(p, /name: Riya$/m, "first name only");
  assert.match(p, /flags: Grade dropped — B1 in PT1 → C1/);
  const parsed = parseRiskNotesJson(JSON.stringify({ notes: [{ studentId: "s1", note: "Do X." }, { studentId: "zzz", note: "ignored" }] }), ["s1"]);
  assert.deepEqual(parsed, [{ studentId: "s1", note: "Do X." }]);
  assert.equal(parseRiskNotesJson("nope", ["s1"]), null);
}

// cleaner
{
  const f = cleanRiskFacts({ studentId: "x", fullName: "Y Z", percent: "70", incidents: 2.7, homework: { assigned: 5, submitted: 2 } });
  assert.ok(f);
  assert.equal(f.percent, null, "string numbers are not numbers");
  assert.equal(f.incidents, 2);
  assert.deepEqual(f.homework, { assigned: 5, submitted: 2 });
  assert.equal(cleanRiskFacts({ fullName: "no id" }), null);
}

console.log("OK — academicRisk.selftest.ts");
