/**
 * staffMonthCalendar — the month a member of staff sees = what payroll counts.
 * Run: npx tsx src/lib/staffMonthCalendar.selftest.ts
 */
import { daysOfMonth, staffMonthCalendar } from "./staffMonthCalendar";

let failed = 0;
function expect(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failed += 1;
    console.error(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

expect("Sept has 30 days", daysOfMonth("2026-09").length, 30);
expect("Feb 2028 leap", daysOfMonth("2028-02").length, 29);

const marks: Record<string, { status: string; inTime?: string }> = {
  "2026-09-01": { status: "P", inTime: "08:50" },
  "2026-09-02": { status: "L", inTime: "09:40" },
  "2026-09-03": { status: "HD" },
  "2026-09-04": { status: "A" },
  "2026-09-05": { status: "LE" },
};
const sundays = new Set(["2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27"]);
const cal = staffMonthCalendar({
  month: "2026-09",
  today: "2026-09-29",
  markOn: (d) => marks[d] ?? null,
  holidayOn: (d) => (sundays.has(d)
    ? { status: "holiday", label: "Sunday", paidForStaff: true }
    : d === "2026-09-17"
      ? { status: "holiday", label: "Strike", paidForStaff: false }
      : { status: "working", label: "", paidForStaff: true }),
  approvedLeaveOn: (d) => d === "2026-09-10" || d === "2026-09-11",
  surveyOn: (d) => d === "2026-09-12",
  exempt: false,
});
const kind = (d: string) => cal.days.find((x) => x.date === d)?.kind;
expect("present", kind("2026-09-01"), "present");
expect("late", kind("2026-09-02"), "late");
expect("half", kind("2026-09-03"), "half_day");
expect("absent", kind("2026-09-04"), "absent");
expect("leave mark", kind("2026-09-05"), "leave");
expect("sunday", kind("2026-09-06"), "holiday");
expect("approved leave, no register", kind("2026-09-10"), "leave");
expect("survey, no register", kind("2026-09-12"), "present");
expect("unpaid holiday", kind("2026-09-17"), "unpaid_holiday");
expect("no register, working day", kind("2026-09-08"), "not_marked");
expect("future", kind("2026-09-30"), "future");
// 30 days: 4 Sundays paid; marked 1-5; leave 10,11; survey 12; unpaid 17; future 30.
// not_marked = 7,8,9,14,15,16,18,19,21..26,28,29 = 16 days.
expect("counts", cal.counts, {
  present: 3, late: 1, halfDay: 1, absent: 2, notMarked: 16, leave: 3, holidays: 4, lwpDays: 18.5,
});

// Exempt staff: never absent for want of a register.
const ex = staffMonthCalendar({
  month: "2026-09", today: "2026-09-29",
  markOn: () => null,
  holidayOn: () => ({ status: "working", label: "", paidForStaff: true }),
  approvedLeaveOn: () => false,
  exempt: true,
});
expect("exempt no absences", [ex.counts.absent, ex.counts.notMarked, ex.counts.lwpDays], [0, 0, 0]);

if (failed) {
  console.error(`staffMonthCalendar: ${failed} failure(s)`);
  process.exit(1);
}
console.log("staffMonthCalendar: ok");
