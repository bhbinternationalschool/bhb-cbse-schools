/**
 * The robot types only what the ERP actually knows.
 *
 * Run: npx tsx src/lib/udisePortalFill.selftest.ts
 */
import assert from "node:assert/strict";
import { normalizeStudent, type Household, type SisStudent } from "@/lib/sis";
import { buildUdiseFillPlan, distanceBand, parentEducationCode } from "@/lib/udisePortalFill";
import { normalizeUdiseSchoolAnswers, type UdiseSchoolAnswers } from "@/lib/udiseSchoolAnswers";

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

// ── School answers (7 Oct 2026) ─────────────────────────────────────────
const allOn = Object.fromEntries(
  ["indianNational", "notBpl", "notOutOfSchool", "notCwsnUnlessMarked", "rteFromAdmissionType", "noCompetitions", "noNccNssScouts", "noVocational", "mediumEnglish", "promotionByExam"].map((k) => [k, true]),
);
const school: UdiseSchoolAnswers = normalizeUdiseSchoolAnswers({ answers: allOn, confirmedBy: "Office", confirmedAt: "2026-10-07T10:00:00Z" });
// Unsigned answers are no answers.
assert.deepEqual(normalizeUdiseSchoolAnswers({ answers: allOn }).answers, {});
assert.deepEqual(normalizeUdiseSchoolAnswers({ answers: { notBpl: "yes" }, confirmedBy: "x", confirmedAt: "y" }).answers, {}, "only a real true counts");

const withSchool = buildUdiseFillPlan(st({}), undefined, { school });
assert.equal(val(withSchool, "isBplYN"), "2");
assert.equal(val(withSchool, "ooscYN"), "2");
assert.equal(val(withSchool, "natIndYN"), "1");
assert.equal(val(withSchool, "cwsnYN"), "2");
assert.equal(val(withSchool, "isRte"), "2");
assert.equal(val(withSchool, "nccYn"), "2");
assert.equal(val(withSchool, "mediumOfInstruction"), "19");
for (const q of ["BPL / AAY", "Out-of-school child", "Nationality", "CWSN (Yes/No)"]) {
  assert.ok(!withSchool.leftForYou.includes(q), `${q} is answered by the school`);
}
// Without confirmed answers, the same questions stay the office's.
const noSchool = buildUdiseFillPlan(st({}), undefined, { school: normalizeUdiseSchoolAnswers(null) });
assert.equal(val(noSchool, "isBplYN"), undefined);
assert.ok(noSchool.leftForYou.includes("BPL / AAY"));
assert.deepEqual(noSchool.leftControls["BPL / AAY"], ["isBplYN"]);
// The child's own record beats the school default.
assert.equal(val(buildUdiseFillPlan(st({ isCwsn: true }), undefined, { school }), "cwsnYN"), "1");
assert.equal(buildUdiseFillPlan(st({ isCwsn: true }), undefined, { school }).fields.filter((f) => f.control === "cwsnYN").length, 1);
assert.equal(val(buildUdiseFillPlan(st({ studentType: "RTE" }), undefined, { school }), "isRte"), "1");
const nepali = buildUdiseFillPlan(st({ nationality: "Nepali" }), undefined, { school });
assert.equal(val(nepali, "natIndYN"), undefined);
assert.ok(nepali.leftForYou.some((l) => l.startsWith("Nationality")));
// Facilities is not a 2026-27 portal question; admission date is never guessed.
assert.ok(!full.leftForYou.includes("Facilities received"));
assert.equal(val(withSchool, "admnStartDate"), undefined);

// ── Previous year ───────────────────────────────────────────────────────
const prev = { yearCode: "2025-26", className: "UKG", portalClassId: -1, currentPortalClassId: 1 };
const v1 = buildUdiseFillPlan(st({}), undefined, { previousYear: prev });
assert.equal(val(v1, "enrStatusPY"), "1");
assert.equal(val(v1, "classPY"), undefined, "an old robot cannot fill a box that appears later");
const v2 = buildUdiseFillPlan(st({}), undefined, { previousYear: prev, dependentFields: true, school });
assert.equal(val(v2, "classPY"), "-1");
assert.equal(val(v2, "examResultPy"), "4", "UKG → I: promoted without exam");
assert.ok(v2.fields.findIndex((f) => f.control === "enrStatusPY") < v2.fields.findIndex((f) => f.control === "classPY"), "status before class");
assert.equal(
  val(buildUdiseFillPlan(st({}), undefined, { previousYear: { ...prev, className: "II", portalClassId: 2, currentPortalClassId: 3 }, dependentFields: true, school }), "examResultPy"),
  "1",
  "II → III: promoted by exam",
);
assert.equal(val(buildUdiseFillPlan(st({}), undefined, { previousYear: prev, dependentFields: true }), "examResultPy"), undefined, "exam or not is the school's answer");
const same = buildUdiseFillPlan(st({}), undefined, { previousYear: { ...prev, currentPortalClassId: -1 }, dependentFields: true, school });
assert.equal(val(same, "examResultPy"), undefined, "same class both years is not read as a repeat");
assert.ok(same.leftForYou.some((l) => l.includes("both years")));
assert.equal(val(buildUdiseFillPlan(st({}), undefined, { previousYear: { ...prev, currentPortalClassId: null }, dependentFields: true, school }), "examResultPy"), undefined);
assert.equal(val(buildUdiseFillPlan(st({}), undefined, {}), "enrStatusPY"), undefined, "no row last year = not known");

// ── Distance ────────────────────────────────────────────────────────────
assert.equal(distanceBand(0.6), "1");
assert.equal(distanceBand(1.08), "2");
assert.equal(distanceBand(3), "3");
assert.equal(distanceBand(4.99), "3");
assert.equal(distanceBand(5), "4");
assert.equal(distanceBand(0), "");
assert.equal(val(buildUdiseFillPlan(st({}), undefined, { distance: { km: 3.6, from: "PUARI" } }), "distanceFrmSchool"), "3");
const edge = buildUdiseFillPlan(st({}), undefined, { distance: { km: 1.08, from: "Ayar" } });
assert.equal(val(edge, "distanceFrmSchool"), undefined, "1.08 km could be either side of 1 km");
assert.ok(edge.leftForYou.some((l) => l.includes("Ayar")));
assert.equal(
  val(buildUdiseFillPlan(st({}), { ...hh, address: "AYAR, AYAR", locality: "ayar", city: "VARANASI, Varanasi" } as Household, {}), "address"),
  "AYAR, VARANASI",
  "repeated parts dropped",
);
assert.ok(buildUdiseFillPlan(st({}), undefined, { distance: null }).leftForYou.includes("Distance from school"));

console.log("udisePortalFill selftest: ok");
