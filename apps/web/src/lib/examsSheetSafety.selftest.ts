/**
 * Run: npx tsx src/lib/examsSheetSafety.selftest.ts
 *
 * Pins the rules that keep one teacher's save from destroying another's
 * (2026-09-15 audit, docs/EXAMS_AUDIT_AND_PLAN_2026-09-15.md):
 * - a locked sheet refuses marks, whether or not the caller asks to lock;
 * - a sheet carries the version it was edited from, and the server-side
 *   comparison treats Postgres "+00:00" and browser "Z" as the same instant;
 * - a hydrate keeps the sheets this browser has not managed to send;
 * - synthesised exam subjects get the same id every time, so a read can
 *   stay pure and a phone and a desk resolve the same subject;
 * - the roster-wide subject map agrees with the per-student resolver.
 */
import assert from "node:assert/strict";

import {
  defaultExamPolicy,
  examSubjectIdForCode,
  prepareMarkSheet,
  subjectTakeMap,
  subjectsForStudent,
  type ExamsState,
  type ExamSubject,
  type ExamTerm,
  type MarkSheet,
} from "./exams";
import { sameInstant } from "./examsSheetVersion";
import { mergeDbDeskIntoExamsState } from "./examsNormalizedMerge";
import type { SisStudent } from "./sis";
import { defaultMasters } from "./masters";

console.log("examsSheetSafety.selftest.ts");

const term: ExamTerm = {
  id: "term_ut1",
  code: "UT1",
  label: "Unit Test 1",
  academicYearCode: "2026-27",
  maxMarks: 40,
  sortOrder: 1,
  isActive: true,
  startsOn: "",
  endsOn: "",
  note: "",
  countsTowardHy: true,
  countsTowardFinal: false,
  weightInHy: 20,
  weightInFinal: 0,
  requiredOnMarksheet: true,
  requiresSeparateMarksheet: true,
};

const eng: ExamSubject = {
  id: "sub_eng",
  code: "ENG",
  name: "English",
  classIds: [],
  maxMarks: 100,
  sortOrder: 1,
  isActive: true,
};

const state: ExamsState = {
  version: 1,
  terms: [term],
  subjects: [eng],
  dateSheet: [],
  sheets: [],
  policy: defaultExamPolicy(),
  promotions: [],
    rooms: [],
    seating: [],
};

const masters = defaultMasters();
const cls = masters.classes[0]!;
const sec = masters.sections.find((s) => s.classId === cls.id) ?? masters.sections[0]!;

const student = {
  id: "stu_1",
  fullName: "Test Child",
  classId: cls.id,
  sectionId: sec.id,
  academicYearCode: "2026-27",
  status: "active",
} as unknown as SisStudent;

const deps = { state, masters, sis: { version: 1, households: [], students: [student], curriculumRequests: [] } as never };

// ---------------------------------------------------------------- lock rule
{
  const locked: MarkSheet = {
    id: "ms_locked",
    academicYearCode: "2026-27",
    examTermId: term.id,
    classId: cls.id,
    sectionId: sec.id,
    marks: [{ studentId: student.id, component: "", subjectId: eng.id, marksObtained: 30, grade: "B1", remark: "", remarkSource: "manual" }],
    absences: [],
    coScholastic: [],
    overallRemarks: [],
    itemScores: [],
    lockedAt: "2026-09-15T05:00:00.000Z",
    enteredBy: "Teacher A",
    updatedAt: "2026-09-15T05:00:00.000Z",
  };
  const input = {
    academicYearCode: "2026-27",
    examTermId: term.id,
    classId: cls.id,
    sectionId: sec.id,
    marks: [{ studentId: student.id, component: "", subjectId: eng.id, marksObtained: 39, grade: "", remark: "", remarkSource: "manual" as const }],
    enteredBy: "Teacher B",
  };
  const r1 = prepareMarkSheet(input, state, locked, deps);
  assert.equal(r1.ok, false, "a locked sheet refuses new marks");
  const r2 = prepareMarkSheet({ ...input, lock: true }, state, locked, deps);
  assert.equal(r2.ok, false, "'Save & lock' on a locked sheet is refused too (it used to rewrite the marks)");

  const open = { ...locked, id: "ms_open", lockedAt: null };
  const r3 = prepareMarkSheet(input, state, open, deps);
  assert.ok(r3.ok, "an unlocked sheet accepts marks");
  if (r3.ok) {
    assert.equal(r3.sheet.id, "ms_open", "keeps the existing sheet id");
    assert.equal(r3.sheet.marks[0]!.marksObtained, 39);
    assert.equal(r3.sheet.marks[0]!.grade, "A1", "39/40 = 97.5% → A1");
    assert.equal(r3.sheet.lockedAt, null);
  }
  const r4 = prepareMarkSheet(
    { ...input, marks: [{ ...input.marks[0]!, marksObtained: 41 }] },
    state,
    open,
    deps,
  );
  assert.equal(r4.ok, false, "marks above the exam max are refused");
  const r5 = prepareMarkSheet({ ...input, lock: true }, state, undefined, deps);
  assert.ok(r5.ok && r5.sheet.lockedAt, "a fresh sheet can be saved locked");

  // Absent: the cell's number is dropped and the row reads AB, reason kept.
  const r6 = prepareMarkSheet(
    { ...input, absences: [{ studentId: student.id, subjectId: eng.id, reason: "  Fever " }] },
    state,
    open,
    deps,
  );
  assert.ok(r6.ok);
  if (r6.ok) {
    assert.equal(r6.sheet.marks[0]!.marksObtained, null);
    assert.equal(r6.sheet.marks[0]!.grade, "AB");
    assert.deepEqual(r6.sheet.absences, [{ studentId: student.id, subjectId: eng.id, reason: "Fever" }]);
  }
  const r7 = prepareMarkSheet(input, state, r6.ok ? r6.sheet : open, deps);
  assert.ok(r7.ok && r7.sheet.absences.length === 1, "omitting absences keeps what the sheet had");
  const r8 = prepareMarkSheet({ ...input, absences: [] }, state, r6.ok ? r6.sheet : open, deps);
  assert.ok(r8.ok && r8.sheet.absences.length === 0 && r8.sheet.marks[0]!.marksObtained === 39, "sending an empty list clears the absence");
}

// ------------------------------------------------------------ version rule
{
  assert.equal(sameInstant(null, null), true);
  assert.equal(sameInstant(undefined, ""), true);
  assert.equal(sameInstant("2026-09-15T05:00:00.000Z", null), false, "stored vs never-seen differ");
  assert.equal(
    sameInstant("2026-09-15T05:00:00.451+00:00", "2026-09-15T05:00:00.451Z"),
    true,
    "Postgres offset form equals the browser's Z form",
  );
  assert.equal(
    sameInstant("2026-09-15T05:00:00.451Z", "2026-09-15T05:00:01.000Z"),
    false,
    "a later save is a different version",
  );
}

// ------------------------------------------------- hydrate keeps unsent sheets
{
  const mine: MarkSheet = {
    id: "ms_mine",
    academicYearCode: "2026-27",
    examTermId: term.id,
    classId: cls.id,
    sectionId: sec.id,
    marks: [{ studentId: student.id, component: "", subjectId: eng.id, marksObtained: 12, grade: "E", remark: "", remarkSource: "manual" }],
    absences: [],
    coScholastic: [],
    overallRemarks: [],
    itemScores: [],
    lockedAt: null,
    enteredBy: "Me",
    updatedAt: "2026-09-15T06:00:00.000Z",
  };
  const theirsOlder: MarkSheet = { ...mine, marks: [], updatedAt: "2026-09-15T05:00:00.000Z", enteredBy: "Server" };
  const other: MarkSheet = { ...mine, id: "ms_other", sectionId: "sec_other", enteredBy: "Server" };
  const local: ExamsState = { ...state, sheets: [mine] };
  const bundle = {
    terms: [term],
    subjects: [eng],
    dateSheet: [],
    sheets: [theirsOlder, other],
    policy: defaultExamPolicy(),
    promotions: [],
    rooms: [],
    seating: [],
  };

  const dropped = mergeDbDeskIntoExamsState(local, bundle, { preferDb: true });
  assert.equal(
    dropped.sheets.find((s) => s.id === "ms_mine")?.enteredBy,
    "Server",
    "without a pending set, DB wins (the old behaviour)",
  );

  const kept = mergeDbDeskIntoExamsState(local, bundle, {
    preferDb: true,
    keepLocalSheetIds: new Set(["ms_mine"]),
  });
  assert.equal(kept.sheets.find((s) => s.id === "ms_mine")?.enteredBy, "Me", "a pending sheet keeps the local copy");
  assert.equal(kept.sheets.find((s) => s.id === "ms_mine")?.marks.length, 1, "…with its marks");
  assert.ok(kept.sheets.some((s) => s.id === "ms_other"), "other sheets still come from the DB");

  const unsentNew = mergeDbDeskIntoExamsState(
    { ...state, sheets: [{ ...mine, id: "ms_new" }] },
    { ...bundle, sheets: [other] },
    { preferDb: true, keepLocalSheetIds: new Set(["ms_new"]) },
  );
  assert.ok(unsentNew.sheets.some((s) => s.id === "ms_new"), "a sheet the DB has never seen is kept while pending");
}

// ----------------------------------------------- deterministic subject ids
{
  assert.equal(examSubjectIdForCode("SKT"), "esub_skt");
  assert.equal(examSubjectIdForCode("SKT"), examSubjectIdForCode("skt"));
  assert.equal(examSubjectIdForCode("Art & Craft"), "esub_art_craft");
  assert.equal(examSubjectIdForCode("!!"), "esub_x");
}

// ------------------------------------------------- roster-wide subject map
{
  const list = subjectsForStudent(student, state, deps);
  assert.ok(list.some((s) => s.code === "ENG"), "class map gives the class its subjects");
  const map = subjectTakeMap([student], [eng], state, deps);
  assert.deepEqual([...(map.get(student.id) ?? [])], [eng.id], "the map agrees with the per-student resolver");
  assert.equal(subjectTakeMap([], [eng], state, deps).size, 0);
}

console.log("OK — examsSheetSafety.selftest.ts");
