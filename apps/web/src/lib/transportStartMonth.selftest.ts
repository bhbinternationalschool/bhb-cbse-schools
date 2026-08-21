/**
 * Self-test: when transport billing may start.
 * Run: npx tsx apps/web/src/lib/transportStartMonth.selftest.ts
 *
 * Two rules under test — never before the child joined, and never in a month
 * the school is shut — plus the thing that matters most: an unconfigured
 * calendar must block nothing rather than inventing a vacation.
 */

import assert from "node:assert/strict";

import {
  checkTransportStartMonth,
  closedMonthsInSession,
  earliestAllowedMonth,
  monthIsSchoolClosed,
  monthLabel,
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

/* ── rule 2: never in a month the school is shut ───────────── */

const summerShut = masters([
  holiday({ title: "Summer vacation", startsOn: "2026-05-20", endsOn: "2026-06-30" }),
]);

// June is covered end to end → closed.
assert.equal(monthIsSchoolClosed(summerShut, AY, "2026-06"), true);
// May is only covered from the 20th → the school ran, so it is not closed.
assert.equal(monthIsSchoolClosed(summerShut, AY, "2026-05"), false);
// July is untouched.
assert.equal(monthIsSchoolClosed(summerShut, AY, "2026-07"), false);

const verdict = checkTransportStartMonth({
  effectiveFrom: "2026-06-01",
  joinedOn: "2026-06-10",
  academicYearCode: AY,
  masters: summerShut,
});
assert.equal(verdict.ok, false);
assert.equal(verdict.ok === false && verdict.code, "school-closed");

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
    academicYearCode: AY,
    masters: masters([]),
  }).ok,
  true,
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

// Admitted in April, June still skipped but April already qualifies.
assert.equal(
  earliestAllowedMonth({
    monthKeys: SESSION,
    joinedOn: "2026-04-05",
    academicYearCode: AY,
    masters: summerShut,
  }),
  "2026-04",
);

/* ── labels ────────────────────────────────────────────────── */

assert.equal(monthLabel("2026-06"), "Jun 2026");
assert.equal(monthLabel("garbage"), "garbage");

console.log("  ok");
