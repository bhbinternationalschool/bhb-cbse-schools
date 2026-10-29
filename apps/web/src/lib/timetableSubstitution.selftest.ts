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
  absentTeachersForDate,
  absentTeachersFromData,
  affectedPeriodsForTimeBlock,
  planSubstitutionsForTimeBlock,
} from "./timetableSubstitution";
import { emptyMastersShell } from "./masters";
import { isoDateWeekday } from "./examTimetable";
import type { StaffAttendanceMark, StaffAttendanceRegister } from "./staffAttendance";
import type { LeaveRequest } from "./staffHr";
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

// --- absentTeachersFromData: the absent-list source the Substitution panel
// relies on (bug 29 Oct 2026 — it got an empty list because the loaders
// weren't hydrated on the timetable screen). ----------------------------
{
  // stf_absent/stf_le/stf_hd carry register marks; stf_leave is on approved
  // leave (no mark); stf_late is L (present); stf_inactive is marked A but
  // not active; stf_dup is BOTH marked A and on approved leave.
  const staff = [
    { id: "stf_absent", status: "active" },
    { id: "stf_le", status: "active" },
    { id: "stf_hd", status: "active" },
    { id: "stf_leave", status: "active" },
    { id: "stf_late", status: "active" },
    { id: "stf_dup", status: "active" },
    { id: "stf_inactive", status: "inactive" },
    { id: "stf_present", status: "active" },
  ] as unknown as Parameters<typeof absentTeachersFromData>[0]["staff"];

  const mk = (staffId: string, status: string): StaffAttendanceMark => ({
    staffId,
    status: status as StaffAttendanceMark["status"],
    note: "",
    inTime: "",
    outTime: "",
    punchWay: "",
  });
  const register: StaffAttendanceRegister = {
    id: "sar_1",
    academicYearCode: AY,
    date: DATE,
    markedBy: "office",
    markedAt: "",
    remark: "",
    marks: [
      mk("stf_absent", "A"),
      mk("stf_le", "LE"),
      mk("stf_hd", "HD"),
      mk("stf_late", "L"), // Late = present, must be ignored
      mk("stf_dup", "A"),
      mk("stf_inactive", "A"), // inactive, must be ignored
      mk("stf_present", "P"),
    ],
  };

  const lr = (over: Partial<LeaveRequest>): LeaveRequest =>
    ({
      id: `lr_${over.staffId}`,
      academicYearCode: AY,
      staffId: "",
      typeCode: "CL",
      fromDate: DATE,
      toDate: DATE,
      days: 1,
      halfDay: false,
      reason: "",
      status: "approved",
      origin: "request",
      appliedBy: "",
      appliedAt: "",
      decidedBy: "",
      decidedAt: "",
      decisionNote: "",
      level1By: "",
      level1At: "",
      ...over,
    }) as LeaveRequest;

  const leaveRequests: LeaveRequest[] = [
    lr({ staffId: "stf_leave", typeCode: "CL" }),
    lr({ staffId: "stf_dup", typeCode: "ML" }), // also marked A → attendance wins
    lr({ staffId: "stf_present", status: "pending" }), // not approved → ignored
    lr({ staffId: "stf_le", fromDate: "2025-01-01", toDate: "2025-01-02" }), // wrong dates
    lr({ staffId: "stf_absent", academicYearCode: "2099-00" }), // wrong AY → ignored
    lr({ staffId: "stf_inactive", typeCode: "CL" }), // inactive → ignored
  ];

  const got = absentTeachersFromData({
    staff,
    academicYearCode: AY,
    date: DATE,
    register,
    leaveRequests,
  });
  const byId = new Map(got.map((a) => [a.staffId, a]));

  assert.equal(
    got.length,
    5,
    "THE BUG THIS GUARDS: stf_absent, stf_le, stf_hd, stf_dup (all marked) and stf_leave (approved leave) are absent — late/present/inactive/pending/wrong-date/wrong-AY must all be excluded, and stf_dup counts once",
  );
  assert.equal(byId.get("stf_absent")!.source, "attendance");
  assert.ok(byId.get("stf_absent")!.reason.includes("Marked absent"));
  assert.ok(byId.get("stf_le")!.reason.includes("On leave"));
  assert.ok(byId.get("stf_hd")!.reason.includes("Half day"));
  assert.equal(byId.get("stf_leave")!.source, "leave");
  assert.ok(byId.get("stf_leave")!.reason.includes("Approved CL leave"));
  // Dedupe: the register A mark wins over the approved ML leave for stf_dup.
  assert.equal(byId.get("stf_dup")!.source, "attendance");
  assert.ok(!byId.has("stf_late"), "L (Late) is present, not absent");
  assert.ok(!byId.has("stf_inactive"), "inactive staff excluded");
  assert.ok(!byId.has("stf_present"), "present + pending-leave excluded");
}

// --- The honest before/after proof: the loader-backed wrapper returns []
// outside a browser (exactly what the un-hydrated timetable screen saw),
// while the pure function returns the real list from the same data. --------
{
  const masters2 = emptyMastersShell();
  masters2.staff = [
    { id: "stf_x", status: "active" },
  ] as unknown as typeof masters2.staff;
  const register: StaffAttendanceRegister = {
    id: "sar_2",
    academicYearCode: AY,
    date: DATE,
    markedBy: "",
    markedAt: "",
    remark: "",
    marks: [
      {
        staffId: "stf_x",
        status: "A",
        note: "",
        inTime: "",
        outTime: "",
        punchWay: "",
      },
    ],
  };

  const viaLoaders = absentTeachersForDate(masters2, AY, DATE);
  assert.deepEqual(
    viaLoaders,
    [],
    "un-hydrated loaders (no browser) yield an empty absent list — the reported bug",
  );

  const viaData = absentTeachersFromData({
    staff: masters2.staff,
    academicYearCode: AY,
    date: DATE,
    register,
    leaveRequests: [],
  });
  assert.equal(
    viaData.length,
    1,
    "fed the same register directly, the panel now gets the real absentee",
  );
  assert.equal(viaData[0]!.staffId, "stf_x");
}

console.log("OK — timetableSubstitution.selftest.ts");
