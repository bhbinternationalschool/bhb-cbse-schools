/**
 * Run: npx tsx src/lib/attendanceMonthRegisterEdit.selftest.ts
 *
 * Filling / editing the month register from the staff app (request
 * mr_mv9ysuiwc6ks, 20 Oct 2026). The app and the web panel read the same
 * `canEdit` from GET /api/v1/attendance/month and save through its POST:
 *   - who may edit: attendance·edit AND (office/leadership, or the class
 *     teacher of THAT section); a subject teacher or another class's
 *     teacher is read-only and POST answers 403;
 *   - a "fill this day" save names one date, so no other day's register is
 *     written (one register write per changed day, merged over what is saved).
 */
import assert from "node:assert/strict";
import type { AttendanceRegister } from "@/lib/attendance";
import type { MastersState } from "@/lib/masters";
import type { SisStudent } from "@/lib/sis";
import { monthRegisterCanEdit, planMonthSave } from "@/lib/attendanceMonthRegister";

console.log("attendanceMonthRegisterEdit.selftest.ts");

/* ── who may edit ─────────────────────────────────────────────── */

const mine = new Set(["c3|s3a"]);
const teacher = { unrestricted: false, classTeacherOf: mine, canEditAttendance: true };
assert.equal(monthRegisterCanEdit(teacher, "c3", "s3a"), true, "class teacher: own section");
assert.equal(monthRegisterCanEdit(teacher, "c3", "s3b"), false, "class teacher: another section of the same class");
assert.equal(monthRegisterCanEdit(teacher, "c5", "s5a"), false, "class teacher: another class");
assert.equal(
  monthRegisterCanEdit({ unrestricted: false, classTeacherOf: new Set(), canEditAttendance: true }, "c3", "s3a"),
  false,
  "a subject teacher of the section marks days from the daily register, not the month",
);
assert.equal(
  monthRegisterCanEdit({ unrestricted: true, classTeacherOf: new Set(), canEditAttendance: true }, "c9", "s9a"),
  true,
  "principal / admin / office: every section",
);
assert.equal(
  monthRegisterCanEdit({ unrestricted: true, classTeacherOf: new Set(), canEditAttendance: false }, "c9", "s9a"),
  false,
  "a view-only leadership login gets the read-only register (no edit boxes)",
);
assert.equal(
  monthRegisterCanEdit({ ...teacher, canEditAttendance: false }, "c3", "s3a"),
  false,
  "a class teacher without attendance·edit is read-only",
);

/* ── a day fill writes that day only ──────────────────────────── */

const AY = "2026-27";
const masters = {
  academicYears: [{ id: "ay", code: AY, label: AY, startsOn: "2026-04-01", endsOn: "2027-03-31", status: "current", isActive: true }],
  holidays: [],
  classes: [{ id: "c3", name: "III", isActive: true }],
  sections: [{ id: "s3a", classId: "c3", name: "A", isActive: true }],
} as unknown as MastersState;
const reg = (date: string, marks: Record<string, string>): AttendanceRegister =>
  ({
    id: `r_${date}`,
    academicYearCode: AY,
    campusId: "",
    classId: "c3",
    sectionId: "s3a",
    date,
    marks: Object.entries(marks).map(([studentId, status]) => ({ studentId, status, note: "" })),
    markedBy: "t",
    markedAt: `${date}T05:00:00Z`,
    remark: "",
  }) as AttendanceRegister;
const stu = (id: string) =>
  ({ id, fullName: id.toUpperCase(), rollNo: id, joinedOn: "2025-04-01", classId: "c3", sectionId: "s3a", status: "active" }) as unknown as SisStudent;
const students = [stu("a"), stu("b"), stu("c")];
const registers = [reg("2026-10-12", { a: "A", b: "P", c: "LE" }), reg("2026-10-13", { a: "P" })];

// What the app sends for "fill 13 Oct present, then mark c absent":
// the still-blank children of that day only, plus the exception.
const fill = planMonthSave({
  masters,
  ay: AY,
  classId: "c3",
  sectionId: "s3a",
  month: "2026-10",
  students,
  registers,
  today: "2026-10-14",
  days: [{ date: "2026-10-13", marks: [{ studentId: "b", status: "P" }, { studentId: "c", status: "A" }] }],
});
assert.deepEqual(fill.refused, []);
assert.deepEqual(fill.plan.map((d) => d.date), ["2026-10-13"], "only the filled day is written");
assert.deepEqual(
  fill.plan[0].marks.map((m) => `${m.studentId}:${m.status}`).sort(),
  ["a:P", "b:P", "c:A"],
  "a's saved mark on that day is kept",
);
assert.deepEqual(
  registers.find((r) => r.date === "2026-10-12")!.marks.map((m) => `${m.studentId}:${m.status}`),
  ["a:A", "b:P", "c:LE"],
  "the day before is untouched",
);

// Back-dating follows the web: any past working day of the month, never a
// future day.
const ahead = planMonthSave({
  masters,
  ay: AY,
  classId: "c3",
  sectionId: "s3a",
  month: "2026-10",
  students,
  registers,
  today: "2026-10-14",
  days: [{ date: "2026-10-15", marks: [{ studentId: "a", status: "P" }] }],
});
assert.equal(ahead.plan.length, 0);
assert.match(ahead.refused[0], /in the future/);

console.log("attendanceMonthRegisterEdit.selftest: all assertions passed");
