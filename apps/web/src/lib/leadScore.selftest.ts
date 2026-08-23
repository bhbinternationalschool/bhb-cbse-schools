/**
 * Self-test: admissions lead scoring.
 * Run: npx tsx apps/web/src/lib/leadScore.selftest.ts
 *
 * The rules being pinned:
 *  · Enrolled and lost are FACTS and override the arithmetic. A scoring model
 *    that predicts a family will probably enrol, after they already have, is
 *    how a desk learns to ignore the column.
 *  · An unknown distance or DOB scores NEUTRAL, never zero. Zero would bury
 *    every family we simply have not measured beneath every one we have —
 *    the same "unknown is not bad news" rule the penetration figures follow.
 *  · Hot must stay hard to reach. A list where half the leads are hot has no
 *    priority order, which is the only thing the score is for.
 */

import assert from "node:assert/strict";

import {
  childAgeYears,
  isPositiveOutcome,
  scoreLead,
  statusForScore,
  type LeadScoreInput,
} from "./leadScore";

console.log("leadScore.selftest.ts");

const base: LeadScoreInput = {
  distanceKm: 3,
  touchpoints: 5,
  childAgeYears: 3.5,
  stage: "enquiry",
};

/* ── the ideal lead ─────────────────────────────────────────── */

const ideal = scoreLead({ ...base, lastOutcomePositive: true });
assert.equal(ideal.score, 100, "close, engaged, right age, positive = full marks");
assert.equal(ideal.status, "hot");
assert.equal(ideal.breakdown.length, 4, "every component is shown, including zeros");

/* ── facts beat arithmetic ──────────────────────────────────── */

// A family 40 km away with no contact still enrolled. The score must report
// what happened, not what it would have guessed.
const enrolled = scoreLead({
  distanceKm: 40,
  touchpoints: 0,
  childAgeYears: 12,
  stage: "enrolled",
});
assert.equal(enrolled.status, "enrolled");
assert.equal(enrolled.score, 100);

// And a perfect-looking lead the desk has closed is cold, not hot.
const lost = scoreLead({ ...base, stage: "lost", lastOutcomePositive: true });
assert.equal(lost.status, "cold");
assert.equal(lost.score, 0);

/* ── unknown is neutral, not bad ────────────────────────────── */

const noDistance = scoreLead({ ...base, distanceKm: null });
const farAway = scoreLead({ ...base, distanceKm: 30 });
assert.ok(
  noDistance.score > farAway.score,
  "an unmeasured village must not rank below one measured as too far",
);
assert.ok(
  noDistance.score < ideal.score,
  "…but it must not outrank a village measured as near, either",
);
assert.match(noDistance.breakdown[0].note, /not resolved/);

const noDob = scoreLead({ ...base, childAgeYears: null });
const wrongAge = scoreLead({ ...base, childAgeYears: 15 });
assert.ok(noDob.score > wrongAge.score, "a missing DOB is not a wrong age");

/* ── distance curve ─────────────────────────────────────────── */

const near = scoreLead({ ...base, distanceKm: 2 });
const mid = scoreLead({ ...base, distanceKm: 15 });
const far = scoreLead({ ...base, distanceKm: 26 });
assert.ok(near.score > mid.score && mid.score > far.score, "monotonic in distance");
assert.equal(far.breakdown[0].points, 0, "beyond bus range earns nothing");
assert.equal(near.breakdown[0].points, 40, "inside 5 km earns full marks");
// The boundary itself must be full marks, not a fraction.
assert.equal(scoreLead({ ...base, distanceKm: 5 }).breakdown[0].points, 40);

/* ── engagement saturates ───────────────────────────────────── */

const contacted2 = scoreLead({ ...base, touchpoints: 2 });
const contacted5 = scoreLead({ ...base, touchpoints: 5 });
const contacted20 = scoreLead({ ...base, touchpoints: 20 });
assert.ok(contacted5.score > contacted2.score);
assert.equal(
  contacted20.score,
  contacted5.score,
  "chasing 20 times must not manufacture a hotter lead than 5",
);
assert.equal(scoreLead({ ...base, touchpoints: 0 }).breakdown[1].points, 0);

/* ── bands ──────────────────────────────────────────────────── */

assert.equal(statusForScore(0), "cold");
assert.equal(statusForScore(39), "cold");
assert.equal(statusForScore(40), "warm");
assert.equal(statusForScore(69), "warm");
assert.equal(statusForScore(70), "hot");
assert.equal(statusForScore(100), "hot");

// A lead with nothing going for it but proximity must not read as hot.
const onlyClose = scoreLead({
  distanceKm: 1,
  touchpoints: 0,
  childAgeYears: 14,
  stage: "enquiry",
});
assert.ok(onlyClose.status !== "hot", `living nearby alone is not hot (got ${onlyClose.score})`);

/* ── age parsing ────────────────────────────────────────────── */

const asOf = new Date("2026-08-24T00:00:00Z");
assert.equal(childAgeYears("2023-02-24", asOf), 3.5);
assert.equal(childAgeYears("", asOf), null);
assert.equal(childAgeYears("not-a-date", asOf), null);
assert.equal(childAgeYears("2030-01-01", asOf), null, "a future DOB is a typo, not a newborn");
assert.equal(childAgeYears("1980-01-01", asOf), null, "a 46-year-old is not the child");

/* ── outcomes ───────────────────────────────────────────────── */

assert.equal(isPositiveOutcome("interested"), true);
assert.equal(isPositiveOutcome("visit_scheduled"), true);
assert.equal(isPositiveOutcome("Connected"), true, "case-insensitive");
assert.equal(isPositiveOutcome("not_interested"), false);
assert.equal(isPositiveOutcome("wrong_number"), false);
assert.equal(isPositiveOutcome(""), false);

/* ── the score is always a sane number ──────────────────────── */

for (const d of [null, 0, 5, 12.5, 25, 100]) {
  for (const t of [0, 1, 5, 50]) {
    for (const a of [null, 1, 3.5, 6, 20]) {
      const r = scoreLead({ distanceKm: d, touchpoints: t, childAgeYears: a, stage: "enquiry" });
      assert.ok(
        Number.isInteger(r.score) && r.score >= 0 && r.score <= 100,
        `score out of range for d=${d} t=${t} a=${a}: ${r.score}`,
      );
    }
  }
}

console.log("  ok");
