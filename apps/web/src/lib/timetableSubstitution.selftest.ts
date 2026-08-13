/**
 * Run: npx tsx src/lib/timetableSubstitution.selftest.ts
 *
 * Covers affectedPeriodsForTimeBlock's window-overlap edges (the exact
 * boundary math a partial-day TeacherTimeBlock depends on to only pull in
 * periods that actually clash) and planSubstitutionsForTimeBlock's
 * end-to-end wiring (source tagged "block", not "auto"). All functions here
 * take an explicit `state`, so this runs fully in Node — no browser needed.
 */
import assert from "node:assert/strict";

import {
  affectedPeriodsForTimeBlock,
  planSubstitutionsForTimeBlock,
} from "./timetableSubstitution";
import { emptyMastersShell } from "./masters";
import { isoDateWeekday } from "./examTimetable";
import {
  defaultBellTemplate,
  emptyTimetableState,
  type TimetableGrid,
} from "./timetable";

console.log("timetableSubstitution.selftest.ts");

const masters = emptyMastersShell();
masters.staff = [
  {
    id: "stf_teacher1",
    empCode: "T001",
    fullName: "Teacher One",
    stream: "teaching",
    category: "permanent",
    departmentId: null,
    designationId: null,
    campusId: null,
    mobile: "9876543210",
    email: "teacher1@example.com",
    status: "active",
  },
  {
    id: "stf_sub1",
    empCode: "T002",
    fullName: "Substitute One",
    stream: "teaching",
    category: "permanent",
    departmentId: null,
    designationId: null,
    campusId: null,
    mobile: "9000000001",
    email: "sub1@example.com",
    status: "active",
  },
] as unknown as typeof masters.staff;
masters.classes = [
  { id: "cls_a", name: "VI", isActive: true, sortOrder: 1 },
] as unknown as typeof masters.classes;
masters.sections = [
  { id: "sec_a", classId: "cls_a", name: "A", isActive: true },
] as unknown as typeof masters.sections;
masters.subjects = [
  { id: "sub_math", code: "MAT", name: "Mathematics" },
] as unknown as typeof masters.subjects;

const AY = "2026-27";
const DATE = "2026-09-16"; // any date; weekday derived below, not hardcoded
const weekday = isoDateWeekday(DATE)!;

// Bell template periods 1-3: 09:00-09:40, 09:40-10:20, 10:20-11:00
// (see defaultBellTemplate). Teacher One teaches all three on `weekday`.
const grid: TimetableGrid = {
  id: "grid_a",
  academicYearCode: AY,
  classId: "cls_a",
  sectionId: "sec_a",
  slots: [1, 2, 3].map((periodNo) => ({
    weekday,
    periodNo,
    subjectId: "sub_math",
    teacherId: "stf_teacher1",
    roomId: "",
  })),
  updatedAt: "",
};

const state = {
  ...emptyTimetableState(),
  bellTemplate: defaultBellTemplate(),
  grids: [grid],
};

function periodNos(startTime: string, endTime: string): number[] {
  return affectedPeriodsForTimeBlock({
    state,
    academicYearCode: AY,
    date: DATE,
    staffId: "stf_teacher1",
    startTime,
    endTime,
  })
    .map((p) => p.periodNo)
    .sort();
}

// --- Period ending exactly at block start → excluded --------------------
{
  const got = periodNos("09:40", "10:20");
  assert.deepEqual(
    got,
    [2],
    "period 1 (ends 09:40) must NOT be pulled in by a block starting at 09:40",
  );
}

// --- Period starting exactly at block end → excluded ---------------------
{
  const got = periodNos("09:00", "10:20");
  assert.deepEqual(
    got,
    [1, 2],
    "period 3 (starts 10:20) must NOT be pulled in by a block ending at 10:20",
  );
}

// --- Period fully inside the window → included ---------------------------
{
  const got = periodNos("09:30", "10:30");
  assert.deepEqual(got, [1, 2, 3], "all three periods overlap 09:30-10:30");
}

// --- Period straddling one edge (starts before, ends inside; and starts
// inside, ends after) → both included -------------------------------------
{
  const got = periodNos("09:20", "10:00");
  assert.deepEqual(
    got,
    [1, 2],
    "period 1 straddles the window start, period 2 straddles the window end — both affected",
  );
}

// --- Window matching nothing → empty, no crash ----------------------------
{
  const got = periodNos("07:00", "08:00");
  assert.deepEqual(got, []);
}

// --- planSubstitutionsForTimeBlock: end-to-end, tagged "block" -----------
{
  const result = planSubstitutionsForTimeBlock({
    masters,
    academicYearCode: AY,
    date: DATE,
    staffId: "stf_teacher1",
    startTime: "09:40",
    endTime: "10:20",
    state,
  });
  assert.equal(result.substitutions.length, 1, "only period 2 is in window");
  assert.equal(result.substitutions[0]!.periodNo, 2);
  assert.equal(
    result.substitutions[0]!.source,
    "block",
    "THE REGRESSION THIS GUARDS: time-block-driven rows must be tagged 'block', not 'auto' — reports/filters distinguish the two",
  );
  assert.equal(result.substitutions[0]!.substituteTeacherId, "stf_sub1");
  assert.equal(result.uncovered.length, 0);
}

console.log("OK — timetableSubstitution.selftest.ts");
