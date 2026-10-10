/**
 * Self-test: when transport billing may start.
 * Run: npx tsx apps/web/src/lib/transportStartMonth.selftest.ts
 *
 * The floor is the joining month, bumped past a full closure only when the
 * child joined during one. A closed month is NOT off-limits to everybody —
 * the school bills June transport to continuing riders, and the regression
 * section below exists to keep it that way.
 */

import assert from "node:assert/strict";

import {
  checkTransportStartMonth,
  closedMonthsInSession,
  earliestAllowedMonth,
  monthIsSchoolClosed,
  monthLabel,
  transportFloorMonth,
} from "./transportStartMonth";
import type { Holiday } from "./foundationMasters";
import type { MastersState } from "./masters";

console.log("transportStartMonth.selftest.ts");

const AY = "2026-27";

function holiday(partial: Partial<Holiday>): Holiday {
  return {
    id: `h_${Math.random().toString(36).slice(2, 8)}`,
    academicYearCode: AY,
    title: "Holiday",
    startsOn: "",
    endsOn: "",
    kind: "vacation",
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
    publishedAt: "2026-04-01T00:00:00.000Z",
    publishedBy: "test",
    note: "",
    ...partial,
  } as Holiday;
}

function masters(holidays: Holiday[]): MastersState {
  return { holidays, classes: [], sections: [] } as unknown as MastersState;
}

/* ── rule 1: never before the child joined ─────────────────── */

assert.deepEqual(
  checkTransportStartMonth({
    effectiveFrom: "2026-04-01",
    joinedOn: "2026-07-15",
    academicYearCode: AY,
    masters: null,
  }),
  {
    ok: false,
    code: "before-admission",
    reason:
      "Admitted Jul 2026 — transport cannot start in Apr 2026, before the child joined.",
  },
);

// The joining month itself is allowed — they were here for part of it.
assert.equal(
  checkTransportStartMonth({
    effectiveFrom: "2026-07-20",
    joinedOn: "2026-07-15",
    academicYearCode: AY,
    masters: null,
  }).ok,
  true,
);

// Starting later than admission is fine — a family may add transport mid-year.
assert.equal(
  checkTransportStartMonth({
    effectiveFrom: "2026-11-01",
    joinedOn: "2026-07-15",
    academicYearCode: AY,
    masters: null,
  }).ok,
  true,
);

// No admission date recorded blocks nothing. Unknown is not a reason to refuse.
assert.equal(
  checkTransportStartMonth({
    effectiveFrom: "2026-04-01",
    joinedOn: "",
    academicYearCode: AY,
    masters: null,
  }).ok,
  true,
);

/* ── rule 2: a joining month that is a full closure ────────── */

const summerShut = masters([
  holiday({ title: "Summer vacation", startsOn: "2026-05-20", endsOn: "2026-06-30" }),
]);

// June is covered end to end → closed.
assert.equal(monthIsSchoolClosed(summerShut, AY, "2026-06"), true);
// May is only covered from the 20th → the school ran, so it is not closed.
assert.equal(monthIsSchoolClosed(summerShut, AY, "2026-05"), false);
// July is untouched.
assert.equal(monthIsSchoolClosed(summerShut, AY, "2026-07"), false);

// Admitted DURING the closure → the floor bumps to the next month that runs.
const verdict = checkTransportStartMonth({
  effectiveFrom: "2026-06-01",
  joinedOn: "2026-06-10",
  academicYearCode: AY,
  masters: summerShut,
});
assert.equal(verdict.ok, false);
assert.equal(verdict.ok === false && verdict.code, "school-closed");
assert.equal(
  transportFloorMonth({ joinedOn: "2026-06-10", academicYearCode: AY, masters: summerShut }),
  "2026-07",
);

/* ── THE regression this file exists to prevent ─────────────── */
//
// The school bills June transport to continuing riders. An earlier version
// blocked any start in a closed month, which would have stopped a child
// admitted in April from adding transport in June. Only the JOINING month
// gets bumped — a closed month is not off-limits to everybody.

assert.equal(
  checkTransportStartMonth({
    effectiveFrom: "2026-06-01",
    joinedOn: "2026-04-05",
    academicYearCode: AY,
    masters: summerShut,
  }).ok,
  true,
  "a child admitted in April may start transport in June",
);

// Same for a rider from a previous session — their floor is long past.
assert.equal(
  checkTransportStartMonth({
    effectiveFrom: "2026-06-01",
    joinedOn: "2024-04-01",
    academicYearCode: AY,
    masters: summerShut,
  }).ok,
  true,
  "a continuing rider is billed through the summer closure",
);

// And a child admitted in May, when May is partly open.
assert.equal(
  checkTransportStartMonth({
    effectiveFrom: "2026-06-01",
    joinedOn: "2026-05-10",
    academicYearCode: AY,
    masters: summerShut,
  }).ok,
  true,
);

// An unpublished holiday is a draft and must not block billing.
const draftOnly = masters([
  holiday({
    title: "Summer vacation (draft)",
    startsOn: "2026-05-20",
    endsOn: "2026-06-30",
    isPublished: false,
  }),
]);
assert.equal(monthIsSchoolClosed(draftOnly, AY, "2026-06"), false);

// A holiday belonging to another session must not block this one.
const otherYear = masters([
  holiday({
    title: "Summer vacation",
    startsOn: "2026-05-20",
    endsOn: "2026-06-30",
    academicYearCode: "2025-26",
  }),
]);
assert.equal(monthIsSchoolClosed(otherYear, AY, "2026-06"), false);

// THE important case: an empty calendar invents nothing. June is only a
// vacation if the school says so.
assert.equal(monthIsSchoolClosed(masters([]), AY, "2026-06"), false);
assert.equal(
  checkTransportStartMonth({
    effectiveFrom: "2026-06-01",
    joinedOn: "2026-06-02",
    academicYearCode: AY,
    masters: masters([]),
  }).ok,
  true,
  "an unconfigured calendar bumps nothing",
);

// A working-day override inside the break reopens the month.
const withOverride = masters([
  holiday({ title: "Summer vacation", startsOn: "2026-05-20", endsOn: "2026-06-30" }),
  holiday({
    title: "Result day",
    startsOn: "2026-06-15",
    endsOn: "2026-06-15",
    workingOverride: true,
  }),
]);
assert.equal(monthIsSchoolClosed(withOverride, AY, "2026-06"), false);

/* ── rules together ────────────────────────────────────────── */

const SESSION = [
  "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09",
  "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03",
];

assert.deepEqual(closedMonthsInSession(summerShut, AY, SESSION), ["2026-06"]);

// Admitted in June, which is shut → the first billable month is July.
assert.equal(
  earliestAllowedMonth({
    monthKeys: SESSION,
    joinedOn: "2026-06-10",
    academicYearCode: AY,
    masters: summerShut,
  }),
  "2026-07",
);

// Admitted in April — April already qualifies.
assert.equal(
  earliestAllowedMonth({
    monthKeys: SESSION,
    joinedOn: "2026-04-05",
    academicYearCode: AY,
    masters: summerShut,
  }),
  "2026-04",
);

// No admission date recorded → nothing is blocked at all, including June.
assert.equal(
  earliestAllowedMonth({
    monthKeys: SESSION,
    academicYearCode: AY,
    masters: summerShut,
  }),
  "2026-04",
);

/* ── labels ────────────────────────────────────────────────── */

assert.equal(monthLabel("2026-06"), "Jun 2026");
assert.equal(monthLabel("garbage"), "garbage");

console.log("  ok");
