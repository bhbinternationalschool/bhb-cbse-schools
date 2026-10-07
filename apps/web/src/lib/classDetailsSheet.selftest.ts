/**
 * Run: npx tsx src/lib/classDetailsSheet.selftest.ts
 */
import assert from "node:assert/strict";
import { checkSheetRow, EDUCATION_LEVELS } from "@/lib/classDetailsSheet";
import { parentEducationCode } from "@/lib/udisePortalFill";

const ok = (input: Record<string, unknown>, current = {}) => {
  const r = checkSheetRow(input, current);
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.values;
};
const bad = (input: Record<string, unknown>, re: RegExp, current = {}) => {
  const r = checkSheetRow(input, current);
  assert.ok(!r.ok, `${JSON.stringify(input)} should be refused`);
  assert.match(r.error, re);
};

// Only the keys sent are changed.
assert.deepEqual(ok({ bloodGroup: "b+" }), { bloodGroup: "B+" });
assert.deepEqual(ok({}), {});
assert.deepEqual(ok({ heightCm: "112", weightKg: "19" }), { heightCm: "112", weightKg: "19" });
bad({ heightCm: "19", weightKg: "112" }, /swapped/);
bad({ bloodGroup: "Z+" }, /blood group/);
assert.deepEqual(ok({ bloodGroup: "B(+)" }), { bloodGroup: "B+" }, "old style saved the standard way");
assert.deepEqual(ok({ bloodGroup: "" }), { bloodGroup: "" }, "blank = not known");

assert.deepEqual(ok({ motherTongue: " bhojpuri " }), { motherTongue: "BHOJPURI" });
bad({ motherTongue: "123" }, /letters only/);
assert.deepEqual(ok({ religion: "hindu" }), { religion: "HINDU" });
assert.deepEqual(ok({ religion: "Hindu" }, { religion: "Hindu" }), { religion: "Hindu" }, "an existing spelling is kept");
bad({ religion: "Martian" }, /religion/);
assert.deepEqual(ok({ category: "obc" }), { category: "OBC" });
bad({ category: "XYZ" }, /category/);

assert.deepEqual(ok({ fatherQualification: "GRADUATE", motherQualification: "" }), { fatherQualification: "GRADUATE", motherQualification: "" });
bad({ fatherQualification: "farmer" }, /Father's education/);
assert.deepEqual(ok({ motherQualification: "B.A. BTC" }, { motherQualification: "B.A. BTC" }), { motherQualification: "B.A. BTC" }, "old free text kept as is");

assert.deepEqual(ok({ isCwsn: true }), { isCwsn: true });
bad({ isCwsn: "yes" }, /CWSN/);

// Every education level reads back on the UDISE+ scale.
assert.deepEqual(
  EDUCATION_LEVELS.map((l) => parentEducationCode(l)),
  [6, 1, 2, 3, 4, 5, 5],
);

console.log("classDetailsSheet selftest: ok");
