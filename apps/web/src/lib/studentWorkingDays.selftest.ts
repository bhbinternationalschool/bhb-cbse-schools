/**
 * Run: npx tsx src/lib/studentWorkingDays.selftest.ts
 */
import assert from "node:assert/strict";
import type { AttendanceRegister } from "@/lib/attendance";
import type { MastersState } from "@/lib/masters";
import {
  attendanceStartFor,
  classCalendar,
  sessionDaysSummary,
} from "@/lib/studentWorkingDays";
import { buildMonthView, monthRegisterExport, planMonthSave, sessionMonths } from "@/lib/attendanceMonthRegister";
import type { SisStudent } from "@/lib/sis";
import { findAttendanceOverride, normalizeAttendanceResultOverrides } from "@/lib/attendanceResultOverrides";

const AY = "2026-27";
const hol = (p: Record<string, unknown>) => ({
  id: String(p.title),
  academicYearCode: AY,
  kind: "holiday",
  scope: "school",
  groupCode: "",
  classIds: [],
  appliesTo: "everyone",
  mode: "one_off",
  weekday: null,
  dayType: "full",
  paidForStaff: true,
  exceptionDates: [],
  workingOverride: false,
  isPublished: true,
  note: "",
  ...p,
});
const masters = {
  academicYears: [{ id: "ay", code: AY, label: AY, startsOn: "2026-04-01", endsOn: "2027-03-31", status: "current", isActive: true }],
  holidays: [
    hol({ title: "Sunday Holiday", mode: "weekly", weekday: 0, startsOn: "2026-04-01", endsOn: "2027-03-31" }),
    hol({ title: "Dussehra", startsOn: "2026-10-02", endsOn: "2026-10-02" }),
    hol({ title: "Unpublished", startsOn: "2026-10-05", endsOn: "2026-10-05", isPublished: false }),
    hol({ title: "Sports day", startsOn: "2026-10-06", endsOn: "2026-10-06", dayType: "half" }),
  ],
  classes: [{ id: "c1", name: "III", isActive: true }],
  sections: [{ id: "s1", classId: "c1", name: "A", isActive: true }],
} as unknown as MastersState;

// The calendar: Sundays and published holidays are off; half days still count.
const oct = classCalendar(masters, AY, "c1", "2026-10-01", "2026-10-10");
const off = oct.filter((d) => !d.working).map((d) => d.date);
assert.deepEqual(off, ["2026-10-02", "2026-10-04"], "Dussehra (Fri 2) and Sunday 4 are off; unpublished 5th is working");
assert.equal(oct.find((d) => d.date === "2026-10-06")?.half, true);
assert.equal(oct.find((d) => d.date === "2026-10-06")?.working, true, "a half holiday is still a working day");

// Admission: counted from the day after; never before the session.
assert.equal(attendanceStartFor("2026-08-10", "2026-04-01"), "2026-08-11");
assert.equal(attendanceStartFor("2024-07-01", "2026-04-01"), "2026-04-01", "admitted in an earlier year: whole session");
assert.equal(attendanceStartFor("2026-04-01", "2026-04-01"), "2026-04-02");
assert.equal(attendanceStartFor("", "2026-04-01"), "2026-04-01", "unknown admission is not 'admitted today'");

const reg = (date: string, marks: Record<string, string>, at = `${date}T05:00:00Z`): AttendanceRegister =>
  ({
    id: `r_${date}`,
    academicYearCode: AY,
    campusId: "",
    classId: "c1",
    sectionId: "s1",
    date,
    marks: Object.entries(marks).map(([studentId, status]) => ({ studentId, status, note: "" })),
    markedBy: "t",
    markedAt: at,
    remark: "",
  }) as AttendanceRegister;
const registers = [
  reg("2026-10-01", { a: "P", b: "P" }),
  reg("2026-10-02", { a: "P" }), // a holiday mark is ignored
  reg("2026-10-03", { a: "HD", b: "A" }),
  reg("2026-10-05", { a: "L" }),
  reg("2026-10-06", { a: "LE" }),
];
// a: admitted long ago; b: admitted 2 Oct → counts from 3 Oct.
const sumA = sessionDaysSummary({ masters, ay: AY, classId: "c1", studentId: "a", joinedOn: "2025-04-01", registers, until: "2026-10-07", today: "2026-10-07" });
const aprToSep = classCalendar(masters, AY, "c1", "2026-04-01", "2026-09-30").filter((d) => d.working).length;
assert.equal(sumA.workingDays, aprToSep + 5, "Apr–Sep working days + Oct 1,3,5,6,7");
assert.equal(sumA.presentDays, 1 + 0.5 + 1, "P + HD½ + L; the holiday mark and LE do not count");
assert.equal(sumA.leaveDays, 1);
assert.equal(sumA.unmarkedDays, aprToSep + 1, "Apr–Sep and 7 Oct were never marked — a gap, not presence");

const sumB = sessionDaysSummary({ masters, ay: AY, classId: "c1", studentId: "b", joinedOn: "2026-10-02", registers, until: "2026-10-07", today: "2026-10-07" });
assert.equal(sumB.workingDays, 4, "3, 5, 6, 7 Oct — from the working day after admission");
assert.equal(sumB.presentDays, 0);
assert.equal(sumB.absentDays, 1);
assert.equal(sumB.percent, 0);

// Capped to today even when the exam ends later.
const capped = sessionDaysSummary({ masters, ay: AY, classId: "c1", studentId: "b", joinedOn: "2026-10-02", registers, until: "2026-12-31", today: "2026-10-05" });
assert.equal(capped.workingDays, 2, "3 and 5 Oct only");

// Months offered: session start to now, newest first.
assert.deepEqual(sessionMonths(masters, AY, "2026-06-15"), ["2026-06", "2026-05", "2026-04"]);

// Month view.
const stu = (id: string, name: string, roll: string, joinedOn: string) =>
  ({ id, fullName: name, rollNo: roll, admissionNo: id, joinedOn, classId: "c1", sectionId: "s1", status: "active" }) as unknown as SisStudent;
const students = [stu("b", "BABLU", "2", "2026-10-02"), stu("a", "ANU", "1", "2025-04-01")];
const view = buildMonthView({ masters, ay: AY, classId: "c1", month: "2026-10", students, registers, today: "2026-10-07" });
assert.ok(!("error" in view));
if (!("error" in view)) {
  assert.equal(view.days.length, 31);
  assert.deepEqual(view.students.map((s) => s.name), ["ANU", "BABLU"], "roll order");
  assert.equal(view.students[1].startsOn, "2026-10-03");
  assert.equal(view.days.find((d) => d.date === "2026-10-08")?.future, true);
  assert.equal(view.students[0].month.workingDays, 5);

  // Export: a column per day, H on holidays, – before admission, blank when
  // unmarked or in the future, totals per child and a headcount row.
  const ex = monthRegisterExport({ days: view.days, students: view.students, markOf: (st, d) => st.marks[d] ?? "" });
  assert.equal(ex.columns.length, 3 + 31 + 5);
  assert.equal(ex.columns.find((c) => c.key === "d02")?.header, "2 H", "2 Oct is a holiday");
  assert.equal(ex.columns.find((c) => c.key === "d01")?.header, "1 Th");
  const anu = ex.rows.find((r) => r.student === "ANU")!;
  const bablu = ex.rows.find((r) => r.student === "BABLU")!;
  assert.deepEqual([anu.d01, anu.d02, anu.d03, anu.d04, anu.d06, anu.d07, anu.d08], ["P", "H", "HD", "H", "LE", "", ""]);
  assert.equal(bablu.d01, "–", "before admission");
  assert.equal(bablu.d03, "A");
  assert.equal(anu.monthP, 1 + 0.5 + 1, "P + HD½ + L");
  assert.equal(anu.monthW, 5);
  const head = ex.rows[ex.rows.length - 1];
  assert.equal(head.student, "Present (headcount)");
  assert.equal(head.d01, 1, "ANU present; BABLU not admitted");
  assert.equal(head.d03, 0.5, "HD counts half; A counts 0");
  assert.equal(head.d02, "H");
}
assert.ok("error" in buildMonthView({ masters, ay: AY, classId: "c1", month: "2027-05", students, registers, today: "2026-10-07" }), "outside the session");

// Month save: refusals are reported, existing marks merged, nothing silent.
const plan = planMonthSave({
  masters,
  ay: AY,
  classId: "c1",
  sectionId: "s1",
  month: "2026-10",
  students,
  registers,
  today: "2026-10-07",
  days: [
    { date: "2026-10-01", marks: [{ studentId: "b", status: "A" }] }, // b not admitted yet
    { date: "2026-10-02", marks: [{ studentId: "a", status: "P" }] }, // holiday
    { date: "2026-10-03", marks: [{ studentId: "b", status: "P" }] }, // change b A→P, keep a's HD
    { date: "2026-10-07", marks: [{ studentId: "a", status: "P" }, { studentId: "b", status: "A" }, { studentId: "zz", status: "P" }] },
    { date: "2026-10-09", marks: [{ studentId: "a", status: "P" }] }, // future
    { date: "2026-10-05", marks: [{ studentId: "a", status: "L" }] }, // unchanged → no write
  ],
});
assert.deepEqual(plan.plan.map((d) => d.date), ["2026-10-03", "2026-10-07"]);
assert.deepEqual(
  plan.plan[0].marks.map((m) => `${m.studentId}:${m.status}`).sort(),
  ["a:HD", "b:P"],
  "merged over the saved register",
);
assert.deepEqual(plan.plan[1].marks.map((m) => `${m.studentId}:${m.status}`).sort(), ["a:P", "b:A"]);
assert.equal(plan.refused.length, 4, plan.refused.join(" | "));
assert.ok(plan.refused.some((r) => /not admitted yet/.test(r)));
assert.ok(plan.refused.some((r) => /holiday \(Dussehra\)/.test(r)));
assert.ok(plan.refused.some((r) => /in the future/.test(r)));
assert.ok(plan.refused.some((r) => /not in this section/.test(r)));

// Clearing every mark of a day is refused, never written as an empty register.
const cleared = planMonthSave({ masters, ay: AY, classId: "c1", sectionId: "s1", month: "2026-10", students, registers, today: "2026-10-07", days: [{ date: "2026-10-05", marks: [{ studentId: "a", status: "" }] }] });
assert.equal(cleared.plan.length, 0);
assert.match(cleared.refused[0], /cannot be empty/);
// Result corrections: only sane figures survive a save/load.
const ov = normalizeAttendanceResultOverrides({
  overrides: [
    { academicYearCode: AY, examTermId: "t1", studentId: "a", presentDays: 118.5, workingDays: 120, note: "medical", by: "director", at: "x" },
    { academicYearCode: AY, examTermId: "t1", studentId: "b", presentDays: 130, workingDays: 120, note: "x" }, // present > working
    { academicYearCode: AY, examTermId: "t1", studentId: "c", presentDays: 0, workingDays: 0, note: "x" }, // no working days
    { examTermId: "t1", studentId: "d", presentDays: 1, workingDays: 2 }, // no year
  ],
});
assert.deepEqual(ov.overrides.map((o) => `${o.studentId}:${o.presentDays}/${o.workingDays}`), ["a:118.5/120"]);
assert.equal(findAttendanceOverride(ov, AY, "t1", "a")?.note, "medical");
assert.equal(findAttendanceOverride(ov, AY, "t2", "a"), null, "per exam term");
console.log("studentWorkingDays selftest: ok");
