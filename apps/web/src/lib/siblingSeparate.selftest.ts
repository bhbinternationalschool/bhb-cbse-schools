/**
 * Run: npx tsx src/lib/siblingSeparate.selftest.ts
 *
 * 26–27 Aug 2026: AASHI, DIVYANSHU PATEL and MOHAMMAD ALI were admitted with
 * the placeholder mobile 0000000000 and became one family; editing one
 * child's parents rewrote the others'. Placeholders must never group
 * children, and household codes must not repeat.
 */
import assert from "node:assert/strict";
import { emptySisState, isPlaceholderMobile, nextHouseholdCode, normalizeHousehold, normalizeStudent } from "./sis";
import { listPossibleSiblingPairs } from "./siblingMatching";

for (const m of ["0000000000", "9999999999", "1111111111", "1234567890", "", "12345", "5123456789", "000-000-0000"]) {
  assert.equal(isPlaceholderMobile(m), true, `placeholder: "${m}"`);
}
for (const m of ["8878910755", "9919101755", "+91 87379 56249", "07266931910"]) {
  assert.equal(isPlaceholderMobile(m), false, `real: "${m}"`);
}

assert.equal(nextHouseholdCode(["HH-001", "HH-102", "HH-RTE-4", "HH-099"]), "HH-103");
assert.equal(nextHouseholdCode([]), "HH-001");

// Two unrelated children sharing only a placeholder number are not siblings.
const st = (id: string, name: string, father: string, hh: string, mobile: string) =>
  normalizeStudent({
    id,
    fullName: name,
    admissionNo: `ADM-${id}`,
    status: "active",
    academicYearCode: "2026-27",
    fatherName: father,
    fatherMobile: mobile,
    motherMobile: "0000000000",
    householdId: hh,
  } as Parameters<typeof normalizeStudent>[0]);
const sis = {
  ...emptySisState(),
  households: [
    normalizeHousehold({ id: "h1", mobile: "0000000000" }),
    normalizeHousehold({ id: "h2", mobile: "0000000000" }),
  ],
  students: [st("a", "AASHI", "ASHISH KUMAR GOND", "h1", "0000000000"), st("b", "MOHAMMAD ALI", "IRFAN", "h2", "0000000000")],
};
assert.equal(listPossibleSiblingPairs(sis).length, 0, "a shared placeholder is not evidence of siblings");

// A real shared number still is.
const real = {
  ...sis,
  students: [st("a", "RIYA", "RAM", "h1", "8878910755"), st("b", "RAHUL", "RAM", "h2", "8878910755")],
};
assert.ok(listPossibleSiblingPairs(real).length >= 1, "a real shared father mobile still suggests siblings");

console.log("OK — siblingSeparate.selftest.ts");
