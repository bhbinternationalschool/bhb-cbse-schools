/**
 * Run: npx tsx src/lib/exams.selftest.ts
 *
 * Exercises only the pure logic — flattenExamMarks(), the helper that
 * makes per-student-mark audit diffing possible (StudentSubjectMark has no
 * id of its own; this gives it one, matching the exam_desk_marks DB key
 * scheme). Saving/pushing needs a live Supabase service-role client, so
 * that's verified live against the real exams-desk route instead.
 */
import assert from "node:assert/strict";

import { flattenExamMarks, type MarkSheet } from "./exams";

console.log("exams.selftest.ts");

const sheetA: MarkSheet = {
  id: "sheet-a",
  academicYearCode: "2026-27",
  examTermId: "term-1",
  classId: "class-9",
  sectionId: "section-a",
  marks: [
    { studentId: "stu-1", subjectId: "sub-math", marksObtained: 88, grade: "A1", remark: "" },
    { studentId: "stu-2", subjectId: "sub-math", marksObtained: 72, grade: "B1", remark: "" },
  ],
  lockedAt: null,
  enteredBy: "teacher-1",
  updatedAt: "2026-08-10T00:00:00.000Z",
};

const sheetB: MarkSheet = {
  id: "sheet-b",
  academicYearCode: "2026-27",
  examTermId: "term-1",
  classId: "class-9",
  sectionId: "section-b",
  marks: [
    { studentId: "stu-3", subjectId: "sub-eng", marksObtained: 91, grade: "A1", remark: "" },
  ],
  lockedAt: null,
  enteredBy: "teacher-2",
  updatedAt: "2026-08-10T00:00:00.000Z",
};

// --- flattens every sheet's marks into synthetic-id-keyed flat records ----
{
  const flat = flattenExamMarks([sheetA, sheetB]);
  assert.equal(flat.length, 3, "3 total marks across both sheets");
  assert.deepEqual(
    flat.map((m) => m.id).sort(),
    ["sheet-a:stu-1:sub-math", "sheet-a:stu-2:sub-math", "sheet-b:stu-3:sub-eng"],
    "id must be exactly `${sheetId}:${studentId}:${subjectId}`, matching the exam_desk_marks DB key scheme",
  );
  const stu1 = flat.find((m) => m.id === "sheet-a:stu-1:sub-math");
  assert.ok(stu1);
  assert.equal(stu1.sheetId, "sheet-a");
  assert.equal(stu1.studentId, "stu-1");
  assert.equal(stu1.subjectId, "sub-math");
  assert.equal(stu1.marksObtained, 88);
  assert.equal(stu1.grade, "A1");
}

// --- a sheet with zero marks produces zero flattened records, not a crash -
{
  const emptySheet: MarkSheet = { ...sheetA, id: "sheet-empty", marks: [] };
  const flat = flattenExamMarks([emptySheet]);
  assert.deepEqual(flat, []);
}

// --- empty sheet list -> empty output --------------------------------------
{
  assert.deepEqual(flattenExamMarks([]), []);
}

// --- null marksObtained (not entered / absent) passes through untouched ---
{
  const absentSheet: MarkSheet = {
    ...sheetA,
    id: "sheet-absent",
    marks: [{ studentId: "stu-4", subjectId: "sub-sci", marksObtained: null, grade: "", remark: "Absent" }],
  };
  const flat = flattenExamMarks([absentSheet]);
  assert.equal(flat.length, 1);
  assert.equal(flat[0].marksObtained, null);
  assert.equal(flat[0].remark, "Absent");
}

console.log("OK — exams.selftest.ts");
