/**
 * Self-test: a discount counts once, on the months it was given for.
 * Run: npx tsx apps/web/src/lib/concessionPerDue.selftest.ts
 *
 * Two defects this pins, both reported from the counter:
 *
 *  1. A ₹150 counter discount on April tuition showed ₹300. The counter posts
 *     a waiver for April AND a recurring grant dated from May, and grants were
 *     judged against TODAY rather than the month being billed — so the May
 *     grant reached back into April on top of April's waiver.
 *  2. Nothing stopped a second rule landing on a head that already had one, so
 *     an imported ₹150 and a counter ₹150 both applied to tuition.
 */

import assert from "node:assert/strict";

import { resolvedConcessionGrantsForStudent } from "./feeDiscountRuntime";
import { activeGrantOnHead } from "./concessionSuggest";
import type { MastersState } from "./masters";

console.log("concessionPerDue.selftest.ts");

const STUDENT = { id: "stu_1", admissionNo: "BHB-1" };
const TUITION = "fh_tuition";

function grant(p: Record<string, unknown>) {
  return {
    id: "cg_1",
    concessionId: "cnc_1",
    studentId: "stu_1",
    status: "approved",
    reason: "",
    effectiveFrom: "2026-05-10",
    effectiveTo: null,
    createdAt: "",
    siblingChildNo: null,
    ...p,
  };
}

function rule(p: Record<string, unknown>) {
  return {
    id: "cnc_1",
    code: "CTR-TUITION",
    name: "Tuition · ₹150 off",
    kind: "other",
    mode: "fixed",
    value: 15000,
    feeHeadIds: [TUITION],
    isActive: true,
    academicYearCode: "2026-27",
    siblingTiers: [],
    incompatibleCodes: [],
    ...p,
  };
}

const masters = {
  concessions: [rule({})],
  concessionGrants: [grant({})],
  feeHeads: [{ id: TUITION, code: "TUITION", isActive: true }],
} as unknown as MastersState;

/* ── 1. A grant starting in May must not reach April ── */
const forApril = resolvedConcessionGrantsForStudent(masters, STUDENT, "2026-04-10");
assert.equal(forApril.length, 0, "a May grant must not discount an April due");

const forMay = resolvedConcessionGrantsForStudent(masters, STUDENT, "2026-05-10");
assert.equal(forMay.length, 1, "it applies from the installment it starts on");

const forAugust = resolvedConcessionGrantsForStudent(masters, STUDENT, "2026-08-10");
assert.equal(forAugust.length, 1, "and every month after");

// The regression itself: judged against today, April wrongly qualified.
const judgedByToday = resolvedConcessionGrantsForStudent(masters, STUDENT, "2026-08-29");
assert.equal(judgedByToday.length, 1);
assert.notEqual(
  forApril.length,
  judgedByToday.length,
  "asking 'is it live today' is what let the grant reach backwards",
);

/* ── 2. One discount per head ── */
const clash = activeGrantOnHead(masters, "stu_1", TUITION);
assert.ok(clash, "an existing tuition grant must be found");
assert.equal(clash!.rule.name, "Tuition · ₹150 off");

// A different head is free.
assert.equal(activeGrantOnHead(masters, "stu_1", "fh_transport"), null);
// A different student is free.
assert.equal(activeGrantOnHead(masters, "stu_2", TUITION), null);

// A revoked grant does not block a replacement — removing the first is
// exactly how the office is meant to change a discount.
const revoked = {
  ...masters,
  concessionGrants: [grant({ status: "rejected" })],
} as unknown as MastersState;
assert.equal(
  activeGrantOnHead(revoked, "stu_1", TUITION),
  null,
  "removing the first discount frees the head",
);

// RTE stacks on purpose: a free-ship plus per-head waivers is one policy.
const rte = {
  ...masters,
  concessions: [rule({ kind: "rte" })],
} as unknown as MastersState;
assert.equal(
  activeGrantOnHead(rte, "stu_1", TUITION),
  null,
  "RTE exemptions are not blocked",
);

console.log("OK — concessionPerDue.selftest.ts");
