import assert from "node:assert/strict";
import { holidayCoversDate, weeklyRuleIsWholeSession } from "./holidayPolicy";
import { weeklyRuleWhen } from "./holidayCalendarView";
import type { Holiday } from "./foundationMasters";

console.log("weeklyHolidayRange.selftest.ts");

/**
 * 9 Oct 2026: "Sawan Somvaar" — every Monday 3–24 Aug 2026 — was saved
 * right, but the holiday list showed only "Monday" and the timetable took
 * Monday out of the whole year.
 */

const rule = (over: Partial<Holiday>) =>
  ({
    id: "h",
    title: "Sawan Somvaar",
    academicYearCode: "2026-27",
    mode: "weekly",
    weekday: 1,
    startsOn: "2026-08-03",
    endsOn: "2026-08-24",
    isPublished: true,
    exceptionDates: [],
    ...over,
  }) as unknown as Holiday;

const sawan = rule({});
const sunday = rule({ title: "Sunday Holiday", weekday: 0, startsOn: "2026-04-01", endsOn: "2027-03-31" });

assert.equal(weeklyRuleIsWholeSession(sawan), false, "four Mondays are not the session");
assert.equal(weeklyRuleIsWholeSession(sunday), true);
assert.equal(weeklyRuleIsWholeSession(rule({ startsOn: "2026-04-10", endsOn: "2027-03-31" })), true, "a few days' grace");

assert.equal(holidayCoversDate(sawan, "2026-08-10"), true);
assert.equal(holidayCoversDate(sawan, "2026-08-31"), false, "after the stretch, Monday is a school day");
assert.equal(holidayCoversDate(sawan, "2026-10-12"), false);

assert.equal(weeklyRuleWhen(sawan, false), "Mon 3 – Mon 24 Aug · 4 days");
assert.equal(weeklyRuleWhen(rule({ exceptionDates: ["2026-08-17"] }), false), "Mon 3 – Mon 24 Aug · 3 days");
assert.equal(weeklyRuleWhen(sunday, true), "Whole session");

console.log("weeklyHolidayRange.selftest: all assertions passed");
