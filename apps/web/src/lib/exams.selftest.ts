/**
 * Run: npx tsx src/lib/exams.selftest.ts
 *
 * Exercises only the pure logic:
 * - flattenExamMarks() / flattenCoScholastic() — give StudentSubjectMark /
 *   StudentCoScholasticEntry (neither has its own id) an addressable id so
 *   per-record audit diffing is possible.
 * - buildEmptyCoScholasticGrid() — the co-scholastic analog of
 *   buildEmptyMarksGrid().
 * Saving/pushing needs a live Supabase service-role client, so that's
 * verified live against the real exams-desk route instead.
 */
import assert from "node:assert/strict";

import {
  buildEmptyCoScholasticGrid,
  flattenCoScholastic,
  flattenExamMarks,
  type MarkSheet,
} from "./exams";
import type { SisStudent } from "./sis";

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
  coScholastic: [
    { studentId: "stu-1", domain: "socioEmotional", rating: "A" },
    { studentId: "stu-1", domain: "psychomotor", rating: "B" },
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
  coScholastic: [],
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

// --- flattenCoScholastic: same id scheme, domain-keyed not subject-keyed --
{
  const flat = flattenCoScholastic([sheetA, sheetB]);
  assert.equal(flat.length, 2, "only sheetA has co-scholastic entries");
  assert.deepEqual(
    flat.map((r) => r.id).sort(),
    ["sheet-a:stu-1:psychomotor", "sheet-a:stu-1:socioEmotional"],
    "id must be exactly `${sheetId}:${studentId}:${domain}`, matching exam_desk_coscholastic's DB key scheme",
  );
  const social = flat.find((r) => r.domain === "socioEmotional");
  assert.ok(social);
  assert.equal(social.rating, "A");
  assert.equal(social.sheetId, "sheet-a");
  assert.equal(social.studentId, "stu-1");
}

// --- flattenCoScholastic: a sheet with zero ratings -> zero records --------
{
  assert.deepEqual(flattenCoScholastic([sheetB]), []);
  assert.deepEqual(flattenCoScholastic([]), []);
}

// --- buildEmptyCoScholasticGrid: one entry per student x domain, carries --
// --- forward an existing rating, defaults an unrated pair to null ---------
{
  const students = [{ id: "stu-1" }, { id: "stu-2" }] as SisStudent[];
  const grid = buildEmptyCoScholasticGrid(students, sheetA);
  assert.equal(grid.length, 4, "2 students x 2 domains");
  const stu1Social = grid.find((e) => e.studentId === "stu-1" && e.domain === "socioEmotional");
  assert.ok(stu1Social);
  assert.equal(stu1Social.rating, "A", "carries forward sheetA's existing rating");
  const stu2Social = grid.find((e) => e.studentId === "stu-2" && e.domain === "socioEmotional");
  assert.ok(stu2Social);
  assert.equal(stu2Social.rating, null, "stu-2 was never rated on sheetA -> defaults to null, not fabricated");
}

// --- buildEmptyCoScholasticGrid: no existing sheet -> every rating is null
{
  const students = [{ id: "stu-9" }] as SisStudent[];
  const grid = buildEmptyCoScholasticGrid(students);
  assert.equal(grid.length, 2);
  assert.ok(grid.every((e) => e.rating === null));
}

console.log("OK — exams.selftest.ts");
