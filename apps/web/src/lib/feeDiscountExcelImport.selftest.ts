import assert from "node:assert/strict";
import {
  canonicalAdmissionNo,
  findStudentByAdmission,
  parseDiscountLabel,
} from "./feeDiscountExcelImport";
import type { SisState, SisStudent } from "./sis";

assert.equal(canonicalAdmissionNo("BHB-008/2026"), "BHB-8/2026");
assert.equal(canonicalAdmissionNo("BHB-8/2026"), "BHB-8/2026");
assert.equal(canonicalAdmissionNo("008/2026"), "BHB-8/2026");
assert.equal(canonicalAdmissionNo("111"), "111");

const student = {
  id: "stu_1",
  admissionNo: "BHB-008/2026",
  fullName: "TEST STUDENT",
} as SisStudent;

const sis = {
  households: [],
  students: [student],
} as unknown as SisState;

assert.equal(
  findStudentByAdmission(sis, "BHB-8/2026")?.id,
  "stu_1",
);
assert.equal(
  findStudentByAdmission(sis, "BHB-008/2026")?.id,
  "stu_1",
);

assert.deepEqual(parseDiscountLabel("Discount150", "Flat"), {
  label: "Discount150",
  head: "tuition",
  mode: "fixed",
  rupees: 150,
  kind: "hardship",
});

assert.deepEqual(parseDiscountLabel("Transport 200", "Flat")?.head, "transport");

console.log("feeDiscountExcelImport.selftest: ok");
