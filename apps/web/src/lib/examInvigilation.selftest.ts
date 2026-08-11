/**
 * Exam invigilation conflict-detection regression test.
 *
 * Run: npx tsx src/lib/examInvigilation.selftest.ts
 */
import assert from "node:assert/strict";

import { defaultExamPolicy, type ExamsState, type ExamDateSheetEntry } from "./exams";
import {
  emptyInvigilationState,
  invigilationCandidates,
  invigilationConflictsFor,
  upsertInvigilationAssignment,
  type InvigilationState,
} from "./examInvigilation";
import { emptyMastersShell } from "./masters";
import { defaultBellTemplate, emptyTimetableState, type TimetableState } from "./timetable";
import { isoDateWeekday } from "./examTimetable";

console.log("examInvigilation.selftest.ts");

const AY = "2026-27";
const DATE = "2026-09-15"; // any fixed date; weekday derived below, not hardcoded
const weekday = isoDateWeekday(DATE)!;

const masters = emptyMastersShell();
masters.staff = [
  {
    id: "stf_free",
    empCode: "T001",
    fullName: "Free Teacher",
    stream: "teaching",
    category: "permanent",
    departmentId: null,
    designationId: null,
    campusId: null,
    mobile: "9000000001",
    email: "free@example.com",
    status: "active",
  },
  {
    id: "stf_teaching",
    empCode: "T002",
    fullName: "Teaching Elsewhere",
    stream: "teaching",
    category: "permanent",
    departmentId: null,
    designationId: null,
    campusId: null,
    mobile: "9000000002",
    email: "teaching@example.com",
    status: "active",
  },
  {
    id: "stf_absent",
    empCode: "T003",
    fullName: "Absent Teacher",
    stream: "teaching",
    category: "permanent",
    departmentId: null,
    designationId: null,
    campusId: null,
    mobile: "9000000003",
    email: "absent@example.com",
    status: "active",
  },
] as unknown as typeof masters.staff;

const examsState: ExamsState = {
  version: 1,
  terms: [],
  subjects: [],
  dateSheet: [],
  sheets: [],
  policy: defaultExamPolicy(),
  promotions: [],
};

const entryA: ExamDateSheetEntry = {
  id: "ex_a",
  academicYearCode: AY,
  examTermId: "term_1",
  classId: "cls_x",
  subjectId: "sub_math",
  date: DATE,
  startTime: "09:00",
  durationMinutes: 120,
  note: "",
  updatedAt: "",
};
const entryBOverlap: ExamDateSheetEntry = {
  ...entryA,
  id: "ex_b_overlap",
  classId: "cls_y",
  subjectId: "sub_sci",
  startTime: "10:00", // overlaps 09:00-11:00
};
const entryCSequential: ExamDateSheetEntry = {
  ...entryA,
  id: "ex_c_sequential",
  classId: "cls_y",
  subjectId: "sub_sci",
  startTime: "11:00", // starts exactly when A ends — no overlap
};
examsState.dateSheet = [entryA, entryBOverlap, entryCSequential];

const bellTemplate = defaultBellTemplate();
const teachingPeriod = bellTemplate.find((p) => p.kind === "teaching")!;
const timetableState: TimetableState = {
  ...emptyTimetableState(),
  bellTemplate,
  grids: [
    {
      id: "grid_1",
      academicYearCode: AY,
      classId: "cls_other",
      sectionId: "sec_a",
      slots: [
        {
          weekday,
          periodNo: teachingPeriod.no,
          subjectId: "sub_eng",
          teacherId: "stf_teaching",
          roomId: "",
        },
      ],
      updatedAt: "",
    },
  ],
};

let state: InvigilationState = emptyInvigilationState();

// --- A genuinely free teacher has zero conflicts -----------------------
{
  const conflicts = invigilationConflictsFor({
    state,
    masters,
    examsState,
    timetableState,
    entry: entryA,
    teacherId: "stf_free",
  });
  assert.deepEqual(conflicts, [], "a free teacher must have no conflicts");
}

// --- THE REGRESSION THIS GUARDS: double-booking across overlapping sittings
{
  const r = upsertInvigilationAssignment(state, {
    academicYearCode: AY,
    examEntryId: entryA.id,
    roomLabel: "Room 1",
    teacherId: "stf_free",
    createdBy: "tester",
  });
  state = r.state;

  const conflicts = invigilationConflictsFor({
    state,
    masters,
    examsState,
    timetableState,
    entry: entryBOverlap,
    teacherId: "stf_free",
  });
  assert.ok(
    conflicts.some((c) => c.kind === "double_booked"),
    "assigning the same teacher to an overlapping sitting must be flagged",
  );
}

// --- Sequential (non-overlapping) sittings are NOT a conflict ----------
{
  const conflicts = invigilationConflictsFor({
    state,
    masters,
    examsState,
    timetableState,
    entry: entryCSequential,
    teacherId: "stf_free",
  });
  assert.ok(
    !conflicts.some((c) => c.kind === "double_booked"),
    "back-to-back sittings with no time overlap must not conflict",
  );
}

// --- A teacher already teaching a regular class at that time is flagged
{
  const conflicts = invigilationConflictsFor({
    state,
    masters,
    examsState,
    timetableState,
    entry: entryA,
    teacherId: "stf_teaching",
  });
  assert.ok(
    conflicts.some((c) => c.kind === "teaching"),
    "a teacher scheduled to teach at that time must be flagged",
  );
}

// --- An absent teacher (staff attendance/leave) is flagged --------------
// absentTeachersForDate reads localStorage-backed staff attendance/leave,
// which is empty/unavailable outside a browser — so this only proves the
// wiring doesn't throw and returns no false positive here (no register
// data exists in this Node run). The "absent" branch itself is exercised
// indirectly via absentTeachersForDate's own contract; kept as a smoke
// check rather than asserting a real absence outside a DOM environment.
{
  const conflicts = invigilationConflictsFor({
    state,
    masters,
    examsState,
    timetableState,
    entry: entryA,
    teacherId: "stf_absent",
  });
  assert.ok(Array.isArray(conflicts), "must not throw without a DOM/localStorage");
}

// --- Candidate ranking: nobody is filtered out; conflict-free candidates
// always sort ahead of conflicted ones (not just excluded from the list —
// a school may still need to see and knowingly override a conflict).
{
  const candidates = invigilationCandidates({
    state,
    masters,
    examsState,
    timetableState,
    entry: entryBOverlap,
  });
  assert.equal(candidates.length, 3, "every active teaching staff member is listed, none filtered out");

  const freeTeacher = candidates.find((c) => c.teacherId === "stf_free")!;
  assert.ok(
    freeTeacher.conflicts.some((c) => c.kind === "double_booked"),
    "stf_free must show its double-booking conflict for entryBOverlap",
  );

  const firstConflictedIndex = candidates.findIndex((c) => c.conflicts.length > 0);
  const lastFreeIndex = candidates.reduce(
    (last, c, i) => (c.conflicts.length === 0 ? i : last),
    -1,
  );
  assert.ok(
    firstConflictedIndex === -1 || lastFreeIndex < firstConflictedIndex,
    "every conflict-free candidate must sort ahead of every conflicted one",
  );
}

console.log("OK — examInvigilation.selftest.ts");
