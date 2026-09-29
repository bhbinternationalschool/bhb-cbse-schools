/**
 * Staff day status — no default present; punches graded by Masters rules.
 * Run: npx tsx src/lib/staffDayStatus.selftest.ts
 *
 * Dates are a Tuesday (2026-09-29) so school timing applies; Masters has no
 * timing loaded here, so the library default (09:00–15:30) is in force, and
 * Leave settings are the defaults (grace 15 min).
 */
import { defaultStaffMarks, NOT_PUNCHED_NOTE } from "./staffAttendance";
import {
  emptyRuleStep,
  gradeStaffPunch,
  normalizeAttendanceRulesState,
} from "./staffAttendanceRules";
import type { StaffRecord } from "./foundationMasters";

let failed = 0;
function expect(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failed += 1;
    console.error(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const roster = [
  { id: "a", status: "active" },
  { id: "b", status: "active" },
  { id: "gone", status: "inactive" },
] as StaffRecord[];

// Nobody starts present.
const seeded = defaultStaffMarks(roster);
expect("seed statuses", seeded.map((m) => m.status), ["A", "A"]);
expect("seed note", seeded[0]?.note, NOT_PUNCHED_NOTE);

// No rules saved at all → everyone graded on school timing + grace.
const none = normalizeAttendanceRulesState(null);
const d = "2026-09-29";
expect("on time", gradeStaffPunch(none, "a", d, "09:05", "").status, "P");
expect("within grace", gradeStaffPunch(none, "a", d, "09:14", "").status, "P");
expect("late", gradeStaffPunch(none, "a", d, "09:40", "").status, "L");
expect("rule name", gradeStaffPunch(none, "a", d, "09:05", "").ruleName, "School timing");
// School timing alone invents no half-day cut-off.
expect("no invented half day", gradeStaffPunch(none, "a", d, "11:30", "12:00").status, "L");

// An assigned half-day rule applies to that person only.
const withRule = normalizeAttendanceRulesState({
  version: 1,
  rules: [
    {
      id: "r1",
      code: "HD-TIME",
      name: "Half day by time",
      description: "",
      isActive: true,
      followSchoolTiming: true,
      steps: [
        emptyRuleStep("use_school_timing"),
        emptyRuleStep("buffer_late", { bufferMinutes: 15 }),
        emptyRuleStep("half_day_by_time", { halfDayInAfter: "11:00", halfDayOutBefore: "14:00" }),
      ],
      createdAt: "",
      updatedAt: "",
    },
  ],
  assignments: [{ staffId: "b", ruleId: "r1" }],
});
expect("rule: in after cut-off", gradeStaffPunch(withRule, "b", d, "11:30", "").status, "HD");
expect("rule: out before cut-off", gradeStaffPunch(withRule, "b", d, "09:00", "13:00").status, "HD");
expect("rule: full day", gradeStaffPunch(withRule, "b", d, "09:00", "15:30").status, "P");
expect("rule: unassigned person unaffected", gradeStaffPunch(withRule, "a", d, "11:30", "").status, "L");

if (failed) {
  console.error(`staffDayStatus: ${failed} failure(s)`);
  process.exit(1);
}
console.log("staffDayStatus: ok");
