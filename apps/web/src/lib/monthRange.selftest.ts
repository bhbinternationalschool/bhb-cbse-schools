/**
 * Self-test: the month ↔ date-range rule (lib/monthRange.ts).
 * Run: npx tsx apps/web/src/lib/monthRange.selftest.ts
 *
 * A month picker and a From/To range on one screen must always describe the
 * same period, and the list must filter by exactly that period. Each block
 * below is one way the two used to disagree.
 */

import assert from "node:assert/strict";

import {
  clampToSession,
  defaultMonth,
  editRange,
  exactMonth,
  inRange,
  istThisMonth,
  istTodayIso,
  monthBounds,
  monthBoxValue,
  monthOf,
  reportPeriodMode,
  reportPeriodPayload,
  singleDay,
  snapForMode,
  onSessionChange,
  persistShape,
  pickMonth,
  rangeLabel,
  restoreRange,
  sessionBounds,
  sessionMonths,
} from "./monthRange";

console.log("monthRange.selftest.ts");

// ── IST "today" and month boundaries ─────────────────────────────────
// 18:30Z on 30 Sep is 00:00 on 1 Oct in India.
assert.equal(istTodayIso(Date.parse("2026-09-30T18:29:59Z")), "2026-09-30");
assert.equal(istTodayIso(Date.parse("2026-09-30T18:30:00Z")), "2026-10-01");
assert.equal(istThisMonth(Date.parse("2026-12-31T19:00:00Z")), "2027-01", "New year arrives in IST first");
console.log("  ✓ today and this month are IST");

assert.deepEqual(monthBounds("2026-10"), { from: "2026-10-01", to: "2026-10-31" });
assert.deepEqual(monthBounds("2026-09"), { from: "2026-09-01", to: "2026-09-30" });
assert.deepEqual(monthBounds("2026-12"), { from: "2026-12-01", to: "2026-12-31" });
assert.equal(monthBounds("2026-13"), null);
assert.equal(monthBounds("Oct"), null);
console.log("  ✓ month → first..last day");

// ── February and leap years ──────────────────────────────────────────
assert.deepEqual(monthBounds("2027-02"), { from: "2027-02-01", to: "2027-02-28" });
assert.deepEqual(monthBounds("2028-02"), { from: "2028-02-01", to: "2028-02-29" }, "2028 is a leap year");
assert.deepEqual(monthBounds("2100-02"), { from: "2100-02-01", to: "2100-02-28" }, "2100 is not");
assert.deepEqual(monthBounds("2000-02"), { from: "2000-02-01", to: "2000-02-29" }, "2000 is");
assert.equal(exactMonth({ from: "2028-02-01", to: "2028-02-28" }), null, "28 Feb 2028 is not the whole month");
assert.equal(exactMonth({ from: "2028-02-01", to: "2028-02-29" }), "2028-02");
assert.deepEqual(
  editRange({ from: "2027-02-01", to: "2027-02-28" }, { to: "2027-02-29" }, null),
  { from: "2027-02-01", to: "2027-02-28" },
  "29 Feb 2027 does not exist and is ignored",
);
console.log("  ✓ February and leap years");

// ── Picking a month sets the range; editing the range relabels the month ─
const s2627 = sessionBounds("2026-27");
assert.deepEqual(s2627, { from: "2026-04-01", to: "2027-03-31" });
assert.deepEqual(sessionBounds("2026-2027"), s2627);
assert.equal(sessionBounds(""), null);
const oct = pickMonth("2026-10", s2627)!;
assert.deepEqual(oct, { from: "2026-10-01", to: "2026-10-31" });
assert.equal(monthBoxValue(oct), "2026-10");
assert.equal(rangeLabel(oct), "October 2026");

// The bug this module fixes: month = October while range = September.
const sep = editRange(oct, { from: "2026-09-01" }, s2627);
assert.deepEqual(sep, { from: "2026-09-01", to: "2026-10-31" });
assert.equal(monthBoxValue(sep), "", "a range spanning two months is not October");
assert.equal(rangeLabel(sep), "Custom");
const sepOnly = editRange(sep, { to: "2026-09-30" }, s2627);
assert.equal(monthBoxValue(sepOnly), "2026-09", "exactly September reads as September");
assert.equal(rangeLabel(sepOnly), "September 2026");
console.log("  ✓ month → range, range → month or Custom");

// ── A range spanning months ──────────────────────────────────────────
const span = { from: "2026-09-15", to: "2026-11-10" };
assert.equal(exactMonth(span), null);
assert.equal(rangeLabel(span), "Custom");
assert.equal(inRange("2026-09-14", span), false);
assert.equal(inRange("2026-09-15", span), true, "From is inclusive");
assert.equal(inRange("2026-10-31T23:00:00", span), true);
assert.equal(inRange("2026-11-10", span), true, "To is inclusive");
assert.equal(inRange("2026-11-11", span), false);
assert.equal(inRange("", span), false, "an undated row is outside a set range");
assert.equal(inRange("", { from: "", to: "" }), true, "but inside All dates");
assert.equal(monthOf(span, s2627), "2026-11", "a month-only report uses the month the range ends in");
assert.equal(monthOf({ from: "2026-04-01", to: "2026-10-15" }, s2627), "2026-10", "year-to-date → this month");
console.log("  ✓ ranges spanning months filter inclusively");

// ── Never inverted ───────────────────────────────────────────────────
assert.deepEqual(editRange({ from: "2026-10-01", to: "2026-10-31" }, { from: "2026-11-05" }, s2627), {
  from: "2026-11-05",
  to: "2026-11-05",
});
assert.deepEqual(editRange({ from: "2026-10-01", to: "2026-10-31" }, { to: "2026-09-20" }, s2627), {
  from: "2026-09-20",
  to: "2026-09-20",
});
assert.deepEqual(editRange(oct, { from: "" }, s2627), oct, "emptying an end is refused unless open ends are allowed");
assert.deepEqual(editRange(oct, { from: "" }, s2627, { allowOpen: true }), { from: "", to: "2026-10-31" });
console.log("  ✓ From after To moves the other end");

// ── Session bounds ───────────────────────────────────────────────────
const months = sessionMonths(s2627);
assert.equal(months.length, 12);
assert.equal(months[0], "2026-04");
assert.equal(months[11], "2027-03");
assert.deepEqual(clampToSession({ from: "2026-03-01", to: "2027-05-01" }, s2627), {
  from: "2026-04-01",
  to: "2027-03-31",
});
assert.deepEqual(editRange(oct, { from: "2025-12-01" }, s2627), { from: "2026-04-01", to: "2026-10-31" });
assert.deepEqual(pickMonth("2026-03", s2627), { from: "2026-04-01", to: "2026-04-01" }, "a month before the session is clipped");
const now = Date.parse("2026-10-15T06:00:00Z");
assert.equal(defaultMonth(s2627, now), "2026-10");
assert.equal(defaultMonth(sessionBounds("2025-26"), now), "2026-03", "a past session opens on its last month");
assert.equal(defaultMonth(sessionBounds("2027-28"), now), "2027-04", "a future session opens on its first month");
assert.deepEqual(onSessionChange(oct, sessionBounds("2025-26"), now), { from: "2026-03-01", to: "2026-03-31" });
assert.deepEqual(onSessionChange(oct, s2627, now), oct, "a period that fits is kept");
assert.deepEqual(onSessionChange({ from: "", to: "" }, sessionBounds("2025-26"), now), { from: "", to: "" });
console.log("  ✓ the session bounds both the month and the range");

// ── Restore (URL / localStorage) goes through the same rule ──────────
assert.deepEqual(
  restoreRange({ month: "2026-10", from: "2026-09-01", to: "2026-09-30" }, s2627),
  { from: "2026-09-01", to: "2026-09-30" },
  "a stale contradictory month never wins over the range that was filtered",
);
assert.deepEqual(restoreRange({ month: "2026-10" }, s2627), oct);
assert.equal(restoreRange({ from: "2026-13-01", to: "x" }, s2627), null);
assert.equal(restoreRange({ month: "2025-10" }, s2627), null, "a remembered month from another session is dropped");
assert.equal(restoreRange(null, s2627), null);
assert.deepEqual(restoreRange({ from: "2026-10-31", to: "2026-10-01" }, s2627), {
  from: "2026-10-31",
  to: "2026-10-31",
});
assert.deepEqual(persistShape(oct), { from: "2026-10-01", to: "2026-10-31", month: "2026-10" });
assert.deepEqual(persistShape(span), { from: "2026-09-15", to: "2026-11-10", month: "" });
assert.deepEqual(restoreRange({ from: "", to: "" }, s2627, { allowOpen: true }), { from: "", to: "" });
console.log("  ✓ restored filters are consistent");

// ── Report catalogues: one period, never two that disagree ───────────
assert.equal(reportPeriodMode(["student", "fromTo", "month"]), "range");
assert.equal(reportPeriodMode(["month", "class"]), "month");
assert.equal(reportPeriodMode(["date", "month", "class"]), "dayOrMonth");
assert.equal(reportPeriodMode(["date", "class"]), "none");
const ytd = { from: "2026-04-01", to: "2026-10-15" };
// The old screens sent month=2026-10 next to a year-to-date range and the
// report silently used the range. Now a range report gets no stray month.
assert.deepEqual(reportPeriodPayload("range", ytd, s2627, now), { fromDate: "2026-04-01", toDate: "2026-10-15", month: undefined });
assert.deepEqual(reportPeriodPayload("range", oct, s2627, now), { fromDate: "2026-10-01", toDate: "2026-10-31", month: "2026-10" });
assert.deepEqual(reportPeriodPayload("month", ytd, s2627, now), { month: "2026-10" });
assert.deepEqual(reportPeriodPayload("dayOrMonth", { from: "2026-10-07", to: "2026-10-07" }, s2627, now), { date: "2026-10-07" });
assert.deepEqual(reportPeriodPayload("dayOrMonth", oct, s2627, now), { month: "2026-10" });
assert.deepEqual(reportPeriodPayload("none", oct, s2627, now), {});
assert.equal(singleDay({ from: "2026-10-07", to: "2026-10-07" }), "2026-10-07");
assert.equal(singleDay(oct), null);
assert.deepEqual(snapForMode("month", ytd, s2627, now), oct, "opening a month report snaps the boxes to the month it reads");
assert.equal(snapForMode("month", oct, s2627, now), null);
assert.equal(snapForMode("range", ytd, s2627, now), null);
assert.equal(snapForMode("dayOrMonth", { from: "2026-10-07", to: "2026-10-07" }, s2627, now), null);
assert.deepEqual(snapForMode("dayOrMonth", ytd, s2627, now), oct);
console.log("  ✓ report catalogues read one period");

console.log("monthRange.selftest.ts: all passed");
