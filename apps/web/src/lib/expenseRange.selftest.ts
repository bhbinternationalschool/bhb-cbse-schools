/**
 * Run: npx tsx src/lib/expenseRange.selftest.ts
 *
 * The dashboard Expenses card's periods (director, 7 Oct 2026): India dates,
 * Monday-start weeks, month to date, and a custom range that must be whole.
 */
import assert from "node:assert/strict";
import { expenseRange, istDate } from "./expenseRange";

console.log("expenseRange.selftest.ts");

// 7 Oct 2026 01:00 IST is still 6 Oct in UTC — the school's day wins.
const early = new Date("2026-10-06T19:30:00Z");
assert.equal(istDate(early), "2026-10-07");
assert.deepEqual(expenseRange("today", early), { from: "2026-10-07", to: "2026-10-07" });
// Wed 7 Oct → week from Mon 5 Oct.
assert.deepEqual(expenseRange("week", early), { from: "2026-10-05", to: "2026-10-07" });
// Sunday 11 Oct → still the week from Mon 5 Oct.
assert.deepEqual(expenseRange("week", new Date("2026-10-11T06:00:00Z")), { from: "2026-10-05", to: "2026-10-11" });
// Monday → itself.
assert.deepEqual(expenseRange("week", new Date("2026-10-05T06:00:00Z")), { from: "2026-10-05", to: "2026-10-05" });
// Last week from Wed 7 Oct → Mon 28 Sep – Sun 4 Oct (crosses the month).
assert.deepEqual(expenseRange("lastweek", early), { from: "2026-09-28", to: "2026-10-04" });
// On a Monday, last week is the seven days just ended.
assert.deepEqual(expenseRange("lastweek", new Date("2026-10-05T06:00:00Z")), { from: "2026-09-28", to: "2026-10-04" });
assert.deepEqual(expenseRange("month", early), { from: "2026-10-01", to: "2026-10-07" });
assert.deepEqual(expenseRange("range", early, "2026-04-01", "2026-09-30"), { from: "2026-04-01", to: "2026-09-30" });
assert.equal(expenseRange("range", early, "2026-09-30", "2026-04-01"), null, "backwards");
assert.equal(expenseRange("range", early, "2026-04-01", ""), null, "half a range");

console.log("  ✓ expense periods — India days, Monday weeks, last week, month to date, whole ranges");
