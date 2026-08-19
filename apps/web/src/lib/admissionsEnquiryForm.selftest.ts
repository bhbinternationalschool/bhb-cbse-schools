import assert from "node:assert/strict";
import { enquiryQuestionsFor, isSeniorClassName, LEAD_CONCERNS, PREVIOUS_BOARDS } from "./admissionsEnquiryForm";

console.log("admissionsEnquiryForm.selftest.ts");

for (const n of ["VI", "VII", "X", "XII", "6", "9", "Class 6", "Grade VIII", "10th", "Std. XI"]) {
  assert.equal(isSeniorClassName(n), true, `${n} is senior`);
}
for (const n of ["Nursery", "LKG", "UKG", "I", "V", "1", "5", "Class 5", "", "Playgroup"]) {
  assert.equal(isSeniorClassName(n), false, `${n} is not senior`);
}
assert.deepEqual(enquiryQuestionsFor("VII"), { previousBoard: true, previousSchool: true });
assert.deepEqual(enquiryQuestionsFor("LKG"), { previousBoard: false, previousSchool: false });

// Fixed codes, no duplicates.
assert.equal(new Set(LEAD_CONCERNS.map((c) => c.id)).size, LEAD_CONCERNS.length);
assert.equal(new Set(PREVIOUS_BOARDS.map((c) => c.id)).size, PREVIOUS_BOARDS.length);

console.log("OK — admissionsEnquiryForm.selftest.ts");
