/**
 * Run: npx tsx src/lib/holidayCalendarView.selftest.ts
 */
import assert from "node:assert/strict";
import type { Holiday } from "@/lib/foundationMasters";
import { compareWeeklyRules, duplicateHolidayIds, holidayDateLabel, holidayDayCount, holidaysByMonth, isWeeklyRule } from "@/lib/holidayCalendarView";

const h = (title: string, startsOn: string, endsOn = startsOn, p: Partial<Holiday> = {}) =>
  ({ id: title, title, startsOn, endsOn, mode: "one_off", weekday: null, kind: "gazetted", scope: "school", exceptionDates: [], workingOverride: false, isPublished: true, academicYearCode: "2026-27", ...p }) as unknown as Holiday;

// Entered out of order (an import adds Diwali before Holi): shown by date.
const list = [
  h("Diwali", "2026-11-08", "2026-11-10"),
  h("Sunday Holiday", "2026-04-01", "2027-03-31", { mode: "weekly", weekday: 0 }),
  h("Holi", "2027-03-03"),
  h("Gandhi Jayanti", "2026-10-02"),
  h("Dussehra", "2026-10-19", "2026-10-20"),
  h("Pre-primary Saturday", "2026-04-01", "2027-03-31", { mode: "weekly", weekday: 6 }),
  h("Ambedkar Jayanti", "2026-04-14"),
  h("Winter break", "2026-12-31", "2027-01-02", { exceptionDates: ["2027-01-01"] }),
  h("Extra working Saturday", "2026-10-24", "2026-10-24", { workingOverride: true }),
];
const months = holidaysByMonth(list, "2026-04-01", "2027-03-31");
assert.equal(months.length, 12, "every month of the session, empty ones too");
assert.deepEqual(months.map((m) => m.key).slice(0, 3), ["2026-04", "2026-05", "2026-06"]);
assert.equal(months[11].key, "2027-03");
const flat = months.flatMap((m) => m.holidays.map((x) => x.title));
assert.deepEqual(flat, ["Ambedkar Jayanti", "Gandhi Jayanti", "Dussehra", "Extra working Saturday", "Diwali", "Winter break", "Holi"], "date order");
assert.ok(!flat.includes("Sunday Holiday"), "weekly rules are listed apart");
assert.equal(months.find((m) => m.key === "2026-05")?.holidays.length, 0, "an empty month shows empty (a missing summer break is visible)");
assert.equal(months.find((m) => m.key === "2026-10")?.days, 3, "2 Oct + 19–20 Oct; a working-day override adds no day off");
assert.equal(holidayDayCount(list[7]), 2, "31 Dec + 2 Jan; 1 Jan is an exception");
assert.equal(months.find((m) => m.key === "2026-12")?.days, 2, "a break counts in the month it starts");

assert.equal(holidayDateLabel(list[3]), "Fri 2 Oct");
assert.equal(holidayDateLabel(list[4]), "Mon 19 – Tue 20 Oct");
assert.equal(holidayDateLabel(list[7]), "Thu 31 Dec – Sat 2 Jan");

assert.deepEqual(list.filter(isWeeklyRule).sort(compareWeeklyRules).map((x) => x.title), ["Sunday Holiday", "Pre-primary Saturday"]);

// A holiday outside the session still shows, after the session's months.
const stray = holidaysByMonth([h("Old", "2025-12-25")], "2026-04-01", "2027-03-31");
assert.equal(stray[stray.length - 1].key, "2025-12");
// Entered twice: flagged, and counted once.
const twice = [h("Buddha Purnima", "2026-05-01"), { ...h("Buddha Purnima", "2026-05-01"), id: "bp2" } as Holiday, h("Bakrid", "2026-05-26")];
assert.deepEqual([...duplicateHolidayIds(twice)], ["bp2"]);
assert.equal(holidaysByMonth(twice, "2026-04-01", "2027-03-31").find((m) => m.key === "2026-05")?.days, 2, "1 May counts once");
console.log("holidayCalendarView selftest: ok");
