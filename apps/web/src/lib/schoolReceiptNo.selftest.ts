/**
 * Self-test: one paper leaf per family visit.
 * Run: npx tsx apps/web/src/lib/schoolReceiptNo.selftest.ts
 *
 * The school writes one book leaf per family visit, so collecting for two
 * siblings produces two system receipts carrying the SAME school receipt no.
 * Refusing that pushed the counter to clear the field, which left receipts
 * with no link to the book at all. Reuse across a different family is still
 * refused — that is the case the rule exists for.
 */

import assert from "node:assert/strict";

import { isSchoolReceiptNoTaken } from "./fees";
import type { FeesState } from "./fees";

console.log("schoolReceiptNo.selftest.ts");

const HH_A = "hh_2qj11bfa";
const HH_B = "hh_other";

function voucher(p: Record<string, unknown>) {
  return {
    id: "v1",
    householdId: HH_A,
    schoolReceiptNo: "1376",
    manualBookSeries: "",
    manualBookLeaf: "",
    source: "counter",
    voidedAt: null,
    ...p,
  };
}

const fees = (vs: unknown[]) => ({ vouchers: vs } as unknown as FeesState);

// Shaurya's receipt already carries leaf 1376 for household A.
const state = fees([voucher({ id: "v_shaurya" })]);

// Pratiksha, same family, same visit, same leaf — must be allowed.
assert.equal(
  isSchoolReceiptNoTaken("1376", state, undefined, HH_A),
  false,
  "same household must be allowed to reuse the visit's leaf",
);

// A different family using that leaf is still refused.
assert.equal(
  isSchoolReceiptNoTaken("1376", state, undefined, HH_B),
  true,
  "another household must not reuse the leaf",
);

// With no household given, the old strict behaviour holds.
assert.equal(isSchoolReceiptNoTaken("1376", state), true);

// A voided receipt frees its number for everyone.
assert.equal(
  isSchoolReceiptNoTaken(
    "1376",
    fees([voucher({ id: "v_void", voidedAt: "2026-08-29" })]),
    undefined,
    HH_B,
  ),
  false,
  "a voided receipt must not hold a number",
);

// Manual-book refs (SERIES/LEAF) follow the same household rule.
const bookState = fees([
  voucher({
    id: "v_book",
    schoolReceiptNo: "",
    source: "manual_book",
    manualBookSeries: "A",
    manualBookLeaf: "4521",
  }),
]);
assert.equal(isSchoolReceiptNoTaken("A/4521", bookState, undefined, HH_A), false);
assert.equal(isSchoolReceiptNoTaken("A/4521", bookState, undefined, HH_B), true);

// An empty number is never "taken".
assert.equal(isSchoolReceiptNoTaken("", state, undefined, HH_B), false);

console.log("OK — schoolReceiptNo.selftest.ts");
