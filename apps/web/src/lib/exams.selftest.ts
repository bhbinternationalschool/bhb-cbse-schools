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
  flattenItemScores,
  flattenOverallRemarks,
  normalizeRemarkSource,
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
    { studentId: "stu-1", subjectId: "sub-math", marksObtained: 88, grade: "A1", remark: "", remarkSource: "manual" },
    { studentId: "stu-2", subjectId: "sub-math", marksObtained: 72, grade: "B1", remark: "", remarkSource: "manual" },
  ],
  coScholastic: [
    { studentId: "stu-1", domain: "socioEmotional", rating: "A" },
    { studentId: "stu-1", domain: "psychomotor", rating: "B" },
  ],
  overallRemarks: [
    {
      studentId: "stu-1",
      text: "Consistent effort in Mathematics.",
      textHi: "गणित में निरंतर प्रयास।",
      source: "ai_edited",
      generatedAt: "2026-08-10T00:00:00.000Z",
      model: "gemini-3.6-flash",
    },
  ],
  itemScores: [],
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
    { studentId: "stu-3", subjectId: "sub-eng", marksObtained: 91, grade: "A1", remark: "", remarkSource: "manual" },
  ],
  coScholastic: [],
  overallRemarks: [],
  itemScores: [
    { studentId: "stu-3", subjectId: "sub-eng", paperId: "ep-1", setCode: "A", questionId: "q-1", marks: 4 },
    { studentId: "stu-3", subjectId: "sub-eng", paperId: "ep-1", setCode: "A", questionId: "q-2", marks: null },
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
    marks: [{ studentId: "stu-4", subjectId: "sub-sci", marksObtained: null, grade: "", remark: "Absent", remarkSource: "manual" }],
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

// --- flattenOverallRemarks: `${sheetId}:${studentId}` keys, provenance kept
{
  const flat = flattenOverallRemarks([sheetA, sheetB]);
  assert.equal(flat.length, 1, "only sheetA has a remark; sheetB's empty array adds nothing");
  assert.equal(flat[0].id, "sheet-a:stu-1");
  assert.equal(flat[0].source, "ai_edited");
  assert.equal(flat[0].textHi, "गणित में निरंतर प्रयास।");
}

// --- normalizeRemarkSource: anything unknown is "manual" — an old row or a
// garbled value must never be promoted to "ai" (that would misattribute a
// human's words to a machine on an official record).
{
  assert.equal(normalizeRemarkSource("ai"), "ai");
  assert.equal(normalizeRemarkSource("ai_edited"), "ai_edited");
  assert.equal(normalizeRemarkSource("manual"), "manual");
  assert.equal(normalizeRemarkSource(undefined), "manual");
  assert.equal(normalizeRemarkSource("AI"), "manual");
  assert.equal(normalizeRemarkSource(null), "manual");
}

// --- flattenExamMarks carries remarkSource so per-subject remark
// provenance is auditable alongside the mark itself
{
  const flat = flattenExamMarks([sheetA]);
  assert.ok(flat.every((m) => m.remarkSource === "manual"));
}

// --- item scores flatten with the same key scheme as exam_desk_item_scores --
{
  const flat = flattenItemScores([sheetA, sheetB]);
  assert.equal(flat.length, 2, "only sheetB has item scores");
  assert.deepEqual(
    flat.map((e) => e.id).sort(),
    ["sheet-b:stu-3:ep-1:A:q-1", "sheet-b:stu-3:ep-1:A:q-2"],
    "id must be `${sheetId}:${studentId}:${paperId}:${setCode}:${questionId}`",
  );
  assert.equal(flat.find((e) => e.questionId === "q-2")?.marks, null, "unmarked item stays null, never 0");
  assert.deepEqual(flattenItemScores([{ ...sheetA, itemScores: [] }]), []);
}

console.log("OK — exams.selftest.ts");
