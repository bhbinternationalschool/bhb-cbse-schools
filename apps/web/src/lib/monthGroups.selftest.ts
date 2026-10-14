/**
 * Self-test: month grouping for growing lists.
 * Run: npx tsx apps/web/src/lib/monthGroups.selftest.ts
 *
 * The kit folds old months so a growing list stays short. Folding is only
 * safe if nothing is lost or misfiled on the way: a row in the wrong month
 * reads as a wrong fact ("September's payroll ran twice"), and a dropped
 * row is a missing record. Each assertion below is one of those failures.
 */

import assert from "node:assert/strict";

import {
  NO_DATE_KEY,
  attentionMonthKeys,
  groupRowsByMonth,
  istMonthKey,
  monthKeyLabel,
  openMonthKeys,
  selectedInClosedGroups,
} from "./monthGroups";

console.log("monthGroups.selftest.ts");

// ── IST month boundary ────────────────────────────────────────────────
// 20:00 UTC on 30 Sep is 01:30 on 1 Oct in India.
assert.equal(istMonthKey("2026-09-30T20:00:00Z"), "2026-10", "20:00Z on 30 Sep is October in IST");
assert.equal(istMonthKey("2026-09-30T20:00:00.000+00:00"), "2026-10");
assert.equal(istMonthKey(new Date("2026-09-30T20:00:00Z")), "2026-10");
assert.equal(istMonthKey(Date.parse("2026-09-30T20:00:00Z")), "2026-10");
// 18:29:59Z is still 23:59:59 IST on the 30th.
assert.equal(istMonthKey("2026-09-30T18:29:59Z"), "2026-09");
assert.equal(istMonthKey("2026-09-30T18:30:00Z"), "2026-10");
// An IST-zoned stamp is already IST.
assert.equal(istMonthKey("2026-10-01T00:10:00+05:30"), "2026-10");
assert.equal(istMonthKey("2026-10-01T00:10:00+0530"), "2026-10");
// New year in IST.
assert.equal(istMonthKey("2026-12-31T19:00:00Z"), "2027-01");
console.log("  ✓ zoned instants are read in IST (UTC+05:30)");

// ── Calendar dates are never shifted ──────────────────────────────────
assert.equal(istMonthKey("2026-09-30"), "2026-09", "a date-only value is a calendar date");
assert.equal(istMonthKey("2026-10-01"), "2026-10");
assert.equal(istMonthKey("2026-09"), "2026-09", "a payroll month is read as written");
assert.equal(istMonthKey("2026-09-30T23:30:00"), "2026-09", "a zone-less timestamp is wall-clock");
assert.equal(istMonthKey("2026-09-30 23:30"), "2026-09");
console.log("  ✓ date-only, month-only and wall-clock values are read as written");

// ── Unknown stays unknown ─────────────────────────────────────────────
for (const bad of [
  null,
  undefined,
  "",
  "   ",
  "03/04/2026",
  "04-03-2026",
  "Sept 2026",
  "2026-13",
  "2026-00",
  "2026-02-30",
  "2026-09-31",
  "not a date",
  Number.NaN,
  new Date("nope"),
  {},
  true,
]) {
  assert.equal(istMonthKey(bad), null, `unreadable value ${String(bad)} must be null`);
}
console.log("  ✓ unreadable or ambiguous dates are null, never guessed");

// ── Labels ────────────────────────────────────────────────────────────
assert.equal(monthKeyLabel("2026-10"), "October 2026");
assert.equal(monthKeyLabel("2027-01"), "January 2027");
assert.equal(monthKeyLabel(NO_DATE_KEY), "No date");

// ── Grouping ──────────────────────────────────────────────────────────
type Row = { id: string; at: unknown };
const rows: Row[] = [
  { id: "a", at: "2026-10-03" },
  { id: "b", at: "2026-09-30T20:00:00Z" }, // October in IST
  { id: "c", at: "2026-09-12" },
  { id: "d", at: "" }, // no date
  { id: "e", at: "2026-08" },
  { id: "f", at: "2026-09-01" },
  { id: "g", at: "31/08/2026" }, // ambiguous → no date
  { id: "h", at: "2025-10-05" }, // same month name, previous year
];
const groups = groupRowsByMonth(rows, (r) => r.at);
assert.deepEqual(
  groups.map((g) => g.key),
  ["2026-10", "2026-09", "2026-08", "2025-10", NO_DATE_KEY],
  "newest month first, undated last, years kept apart",
);
assert.deepEqual(groups[0]!.rows.map((r) => r.id), ["a", "b"], "IST boundary row is in October");
assert.deepEqual(groups[1]!.rows.map((r) => r.id), ["c", "f"], "input order kept inside a group");
assert.deepEqual(groups[4]!.rows.map((r) => r.id), ["d", "g"]);
assert.equal(groups[4]!.label, "No date");
assert.equal(groups[4]!.isNoDate, true);

// Partition: every row exactly once.
const seen = groups.flatMap((g) => g.rows.map((r) => r.id)).sort();
assert.deepEqual(seen, rows.map((r) => r.id).sort(), "every row lands in exactly one group");
assert.equal(groups.reduce((n, g) => n + g.rows.length, 0), rows.length);

// A throwing accessor files the row as undated rather than losing it.
const throwing = groupRowsByMonth([{ id: "x" }], () => {
  throw new Error("boom");
});
assert.deepEqual(throwing.map((g) => [g.key, g.rows.length]), [[NO_DATE_KEY, 1]]);
assert.deepEqual(groupRowsByMonth([], () => null), []);
console.log("  ✓ groups partition the rows, newest first, No date last");

// ── Which months are open ─────────────────────────────────────────────
assert.deepEqual([...openMonthKeys(groups)], ["2026-10"], "only the newest month is open by default");
assert.deepEqual(
  [...openMonthKeys(groups, { overrides: { "2026-08": true, "2026-10": false } })],
  ["2026-08"],
  "the viewer's toggles win when no filter is active",
);
assert.deepEqual(
  [...openMonthKeys(groups, { filterActive: true, overrides: { "2026-10": false } })],
  groups.map((g) => g.key),
  "a search opens every month that has a match, whatever was folded before",
);
assert.deepEqual(
  [...openMonthKeys(groups, { filterActive: true, filterOverrides: { "2026-09": false } })],
  ["2026-10", "2026-08", "2025-10", NO_DATE_KEY],
  "the viewer may fold a month while searching",
);
// A month holding work still to do starts open; the viewer can still fold it.
const pendingIn = attentionMonthKeys(groups, (r) => r.id === "e");
assert.deepEqual([...pendingIn], ["2026-08"]);
assert.deepEqual(
  [...openMonthKeys(groups, { attention: pendingIn })],
  ["2026-10", "2026-08"],
  "a month with a pending row is not folded away",
);
assert.deepEqual([...openMonthKeys(groups, { attention: pendingIn, overrides: { "2026-08": false } })], ["2026-10"]);
// Only undated rows: that group is the newest and opens.
const undatedOnly = groupRowsByMonth([{ id: "z", at: null }], (r) => r.at);
assert.deepEqual([...openMonthKeys(undatedOnly)], [NO_DATE_KEY]);
console.log("  ✓ newest month open, older folded; search opens every match");

// ── Selection hidden in folded months ─────────────────────────────────
const picked = new Set(["a", "c", "d"]);
const open = openMonthKeys(groups);
assert.equal(
  selectedInClosedGroups(groups, open, (r) => picked.has(r.id)),
  2,
  "ticks in folded months are counted so the bulk bar can say so",
);
assert.equal(selectedInClosedGroups(groups, new Set(groups.map((g) => g.key)), (r) => picked.has(r.id)), 0);
console.log("  ✓ selected rows inside folded months are counted");

console.log("monthGroups.selftest.ts: all passed");
