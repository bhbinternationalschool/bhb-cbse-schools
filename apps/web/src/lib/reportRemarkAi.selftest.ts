import assert from "node:assert/strict";

import {
  buildRemarkSystemPrompt,
  buildRemarkUserPrompt,
  chunkStudents,
  parseRemarkDraftsJson,
  type StudentRemarkFacts,
} from "./reportRemarkAi";

console.log("reportRemarkAi.selftest.ts");

const riya: StudentRemarkFacts = {
  studentId: "stu-1",
  firstName: "Riya",
  classLabel: "VIII-B",
  examLabel: "Half Yearly",
  percent: 78.4,
  overallGrade: "B1",
  previousPercent: 71,
  previousExamLabel: "Unit Test 1",
  attendancePercent: 92,
  subjects: [
    { subjectId: "sub-math", subjectName: "Mathematics", marksObtained: 68, maxMarks: 80, grade: "B1", previousGrade: "B2", deltaPercent: 6.5 },
    { subjectId: "sub-eng", subjectName: "English", marksObtained: null, maxMarks: 80, grade: "—", previousGrade: "", deltaPercent: null },
  ],
  coScholastic: [{ domainLabel: "Socio-emotional", ratingLabel: "Outstanding" }],
  existingOverallRemark: "",
};

const arjun: StudentRemarkFacts = {
  ...riya,
  studentId: "stu-2",
  firstName: "Arjun",
  previousPercent: null,
  previousExamLabel: "",
  attendancePercent: null,
  coScholastic: [],
  existingOverallRemark: "Needs to submit homework on time.",
};

// --- system prompt encodes tone and the subject-remark switch
{
  const enc = buildRemarkSystemPrompt({ tone: "encouraging", includeSubjectRemarks: true, schoolName: "BHB" });
  assert.match(enc, /encouraging/i);
  assert.match(enc, /Subject remarks: one short phrase/);
  const firm = buildRemarkSystemPrompt({ tone: "firm", includeSubjectRemarks: false, schoolName: "BHB" });
  assert.match(firm, /firm and direct/i);
  assert.match(firm, /empty subjects array/);
  assert.match(firm, /Never mention AI/);
}

// --- user prompt: unknown is stated as unavailable, never as a number
{
  const p = buildRemarkUserPrompt([riya, arjun]);
  assert.match(p, /Riya/);
  assert.match(p, /Previous \(Unit Test 1\): 71%/);
  assert.match(p, /Attendance: 92%/);
  assert.match(p, /\(\+7 pts vs previous\)|\(\+6 pts vs previous\)/, "delta shown for comparable subject");
  assert.match(p, /English \[sub-eng\]: no mark/);
  // Arjun has no previous term / attendance / ratings
  const arjunBlock = p.slice(p.indexOf("studentId: stu-2"));
  assert.match(arjunBlock, /Previous exam: unavailable/);
  assert.match(arjunBlock, /Attendance: unavailable/);
  assert.match(arjunBlock, /Co-scholastic: unavailable/);
  assert.doesNotMatch(arjunBlock, /Attendance: 0%/);
  assert.match(arjunBlock, /existing note.*homework on time/);
}

// --- parser: keeps only expected ids, drops empties, tolerates missing
{
  const text = JSON.stringify({
    students: [
      { studentId: "stu-1", overall: "Riya has improved steadily.", subjects: [{ subjectId: "sub-math", remark: "Strong in algebra" }, { subjectId: "", remark: "x" }] },
      { studentId: "stu-999", overall: "Invented student." },
      { studentId: "stu-2", overall: "" },
    ],
  });
  const out = parseRemarkDraftsJson(text, ["stu-1", "stu-2"]);
  assert.ok(out);
  assert.equal(out.length, 1, "invented id dropped, empty overall dropped");
  assert.equal(out[0].studentId, "stu-1");
  assert.equal(out[0].subjects.length, 1);
  assert.equal(out[0].overallHi, "", "Hindi is filled later by the translation layer, never by the parser");
  assert.equal(parseRemarkDraftsJson("not json", ["stu-1"]), null);
  assert.equal(parseRemarkDraftsJson('{"students":[]}', ["stu-1"]), null);
}

// --- chunking
{
  const ids = Array.from({ length: 19 }, (_, i) => i);
  const chunks = chunkStudents(ids, 8);
  assert.deepEqual(chunks.map((c) => c.length), [8, 8, 3]);
}

console.log("OK — reportRemarkAi.selftest.ts");
