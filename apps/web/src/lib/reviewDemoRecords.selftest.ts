/**
 * The Play review family is reported on by nothing, and reachable by the
 * app exactly as before.
 * Run: npx tsx src/lib/reviewDemoRecords.selftest.ts
 */
import assert from "node:assert/strict";
import {
  isReviewDemoHousehold,
  isReviewDemoStudent,
  reviewDemoHouseholdIds,
  withoutReviewDemo,
} from "./reviewDemoRecords";

console.log("reviewDemoRecords.selftest.ts");

/* The real records, as production holds them. */
const demoHh = { id: "hh_zzdemo01", code: "DEMO-REVIEW" };
const realHh = { id: "hh_xtz65gpp", code: "HH-180" };
const demoKids = [
  { id: "stu_zzdemo01", householdId: "hh_zzdemo01", admissionNo: "BHB-DEMO-0001" },
  { id: "stu_zzdemo02", householdId: "hh_zzdemo01", admissionNo: "BHB-DEMO-0002" },
];
const realKid = { id: "stu_real", householdId: "hh_xtz65gpp", admissionNo: "BHB-2026-27-1230" };

assert.equal(isReviewDemoHousehold(demoHh), true);
assert.equal(isReviewDemoHousehold(realHh), false);
assert.equal(isReviewDemoHousehold(null), false);
assert.equal(isReviewDemoHousehold({ code: "demo-review" }), true, "case does not decide identity");
assert.equal(isReviewDemoStudent(demoKids[0]), true);
assert.equal(isReviewDemoStudent(realKid), false);
assert.equal(isReviewDemoStudent({}), false);
/* A real admission number must never be mistaken for the demo prefix. */
assert.equal(isReviewDemoStudent({ admissionNo: "BHB-2025-26-1105" }), false);
assert.equal(isReviewDemoStudent({ admissionNo: "BHB-DEMOCRACY-1" }), false, "the hyphen is part of the prefix — a real number is never swallowed by it");

/* Ids come from the household AND from the children, so a renamed code
 * still cannot smuggle the family into a report. */
const state = { households: [demoHh, realHh], students: [...demoKids, realKid] };
assert.deepEqual([...reviewDemoHouseholdIds(state)], ["hh_zzdemo01"]);
assert.deepEqual(
  [...reviewDemoHouseholdIds({ households: [{ id: "hh_zzdemo01", code: "HH-999" }], students: demoKids })],
  ["hh_zzdemo01"],
  "recognised by the children even if the household code were edited",
);

/* What a report sees. */
const clean = withoutReviewDemo(state);
assert.deepEqual(clean.households.map((h) => h.id), ["hh_xtz65gpp"]);
assert.deepEqual(clean.students.map((s) => s.id), ["stu_real"]);
/* A roster with no demo family is returned untouched. */
const untouched = withoutReviewDemo({ households: [realHh], students: [realKid] });
assert.equal(untouched.households.length, 1);
assert.equal(untouched.students.length, 1);
/* And an empty roster does not throw. */
assert.deepEqual(withoutReviewDemo({}), { households: [], students: [] });

/* Once the listing no longer needs a demo login and the family is deleted,
 * this module matches nothing — no leftover filter to find and remove. */
assert.equal(reviewDemoHouseholdIds({ households: [realHh], students: [realKid] }).size, 0);

console.log("ok");
