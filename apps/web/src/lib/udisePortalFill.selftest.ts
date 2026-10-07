/**
 * The robot types only what the ERP actually knows.
 *
 * Run: npx tsx src/lib/udisePortalFill.selftest.ts
 */
import assert from "node:assert/strict";
import { normalizeStudent, type Household, type SisStudent } from "@/lib/sis";
import { buildUdiseFillPlan, parentEducationCode } from "@/lib/udisePortalFill";

const st = (p: Partial<SisStudent>) =>
  normalizeStudent({ id: "s", admissionNo: "A-1", fullName: "TEST", status: "active", ...p } as SisStudent);
const hh = { id: "h", address: "VILL PUARI", city: "Varanasi", pincode: "221202", whatsappMobile: "+919400000011", mobile: "", email: "", locality: "", landmark: "" } as unknown as Household;
const val = (plan: ReturnType<typeof buildUdiseFillPlan>, c: string) => plan.fields.find((f) => f.control === c)?.value;

const full = buildUdiseFillPlan(
  st({ category: "OBC", religion: "Hindu", bloodGroup: "B+", rollNo: "12", heightCm: "102", weightKg: "16.5", fatherQualification: "Intermediate", motherQualification: "10th", motherMobile: "9876543210" }),
  hh,
);
assert.equal(val(full, "address"), "VILL PUARI, Varanasi");
assert.equal(val(full, "pincode"), "221202");
assert.equal(val(full, "primaryMobile"), "9400000011");
assert.equal(val(full, "secondaryMobile"), "9876543210");
assert.equal(val(full, "socCatId"), "4");
assert.equal(val(full, "minorityId"), "7");
assert.equal(val(full, "ewsYN"), "2");
assert.equal(val(full, "bloodGroup"), "3");
assert.equal(val(full, "admnNumber"), "A-1");
// The ERP's joinedOn carried the day-overwritten-by-month fault (7 Oct 2026):
// the admission date on the portal comes from the paper register, never from it.
{
  const p2 = buildUdiseFillPlan(st({ joinedOn: "2023-02-02" }), hh);
  assert.equal(val(p2, "admnStartDate"), undefined, "admission date is never filled from joinedOn");
  assert.ok(!/2023-02-02|02\/02\/2023/.test(JSON.stringify(p2)), "the ERP join date appears nowhere in the fill plan");
}
assert.equal(val(full, "rollNumber"), "12");
assert.equal(val(full, "heightInCm"), "102");
assert.equal(val(full, "weightInKg"), "16.5");
assert.equal(val(full, "parentEducation"), "4", "highest of the two parents");

// Nothing known → nothing typed; the gaps are listed instead.
const bare = buildUdiseFillPlan(st({}), undefined);
for (const c of ["address", "pincode", "primaryMobile", "socCatId", "minorityId", "ewsYN", "cwsnYN", "bloodGroup", "heightInCm", "parentEducation"]) {
  assert.equal(val(bare, c), undefined, `${c} must not be guessed`);
}
assert.ok(bare.leftForYou.includes("Social category"));
assert.ok(bare.leftForYou.includes("CWSN (Yes/No)"), "an unticked CWSN box is not a No");
// The normaliser's default nationality is never typed.
assert.equal(val(bare, "natIndYN"), undefined);
// EWS is a category in the ERP.
assert.equal(val(buildUdiseFillPlan(st({ category: "EWS" }), hh), "ewsYN"), "1");
assert.equal(val(buildUdiseFillPlan(st({ category: "EWS" }), hh), "socCatId"), undefined);
// Implausible numbers and bad mobiles are not typed.
assert.equal(val(buildUdiseFillPlan(st({ heightCm: "0", weightKg: "999" }), hh), "heightInCm"), undefined);
assert.equal(val(buildUdiseFillPlan(st({ heightCm: "0", weightKg: "999" }), hh), "weightInKg"), undefined);
assert.equal(val(buildUdiseFillPlan(st({ fatherMobile: "12345" }), undefined), "primaryMobile"), undefined);

assert.equal(parentEducationCode("B.A."), 5);
assert.equal(parentEducationCode("graduate"), 5);
assert.equal(parentEducationCode("12th pass"), 4);
assert.equal(parentEducationCode("High School"), 3);
assert.equal(parentEducationCode("8th"), 2);
assert.equal(parentEducationCode("illiterate"), 6);
assert.equal(parentEducationCode("farmer"), null);
assert.equal(parentEducationCode(""), null);

console.log("udisePortalFill selftest: ok");
