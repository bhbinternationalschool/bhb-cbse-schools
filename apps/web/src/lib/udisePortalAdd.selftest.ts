/**
 * The add-missing-children queue: who is offered, and what is typed.
 *
 * Run: npx tsx src/lib/udisePortalAdd.selftest.ts
 */
import assert from "node:assert/strict";
import { normalizeStudent, type Household, type SisStudent } from "@/lib/sis";
import { buildUdiseAddPlan, listUdiseAddCandidates, portalClassIdFor, probablyOnPortal } from "@/lib/udisePortalAdd";

const st = (p: Partial<SisStudent>) =>
  normalizeStudent({ id: "s", admissionNo: "A-1", fullName: "Riya Verma", status: "active", classId: "c-n", sectionId: "x-a", ...p } as SisStudent);
const hh = { id: "h", guardianName: "Ram Verma", whatsappMobile: "+919400000011", mobile: "", altMobile: "" } as unknown as Household;

assert.equal(portalClassIdFor("Nursery"), -3);
assert.equal(portalClassIdFor("LKG"), -2);
assert.equal(portalClassIdFor("UKG"), -1);
assert.equal(portalClassIdFor("I"), 1);
assert.equal(portalClassIdFor("VIII"), 8);
assert.equal(portalClassIdFor("Class 4"), 4);
assert.equal(portalClassIdFor("Toddlers"), null);

const plan = buildUdiseAddPlan(st({ gender: "F", dob: "2022-01-21", fatherName: "Ram Verma", motherName: "Sita Verma" }), hh);
const v = (c: string) => plan.fields.find((f) => f.control === c)?.value;
assert.equal(v("studentName"), "RIYA VERMA");
assert.equal(v("gender"), "2");
assert.equal(v("dob"), "21/01/2022", "the portal's DD/MM/YYYY");
assert.equal(v("fatherName"), "RAM VERMA");
assert.equal(v("guardianName"), "RAM VERMA");
assert.equal(v("primaryMobile"), "9400000011");
assert.equal(v("uuid"), "999999999999", "no Aadhaar in the ERP → the portal's 'not available' value");
assert.ok(plan.hints.some((h) => /AADHAAR not available/.test(h)), "and the office is told to collect the real one");
assert.equal(v("admnStartDate"), undefined, "admission date is never guessed from joinedOn");
// joinedOn carried the day-overwritten-by-month fault (7 Oct 2026). It must not
// reach the portal form, as a field or as a hint the office might copy.
{
  const p2 = buildUdiseAddPlan(st({ joinedOn: "2023-02-02" }), hh);
  const text = JSON.stringify(p2);
  assert.ok(!/2023-02-02|02\/02\/2023/.test(text), "the ERP join date appears nowhere in the Add plan");
  assert.equal(p2.fields.find((f) => f.control === "admnStartDate"), undefined);
  assert.ok(p2.hints.some((h) => /paper admission register/.test(h)), "the office is pointed at the register");
}
assert.ok(!plan.leftForYou.some((x) => /^Name as per Aadhaar/.test(x)), "no Aadhaar name is asked for with the placeholder");
// A number that fails the Aadhaar checksum is not typed.
assert.equal(buildUdiseAddPlan(st({ aadhaarNumber: "123412341234" }), hh).fields.find((f) => f.control === "uuid")?.value, "999999999999", "a number failing the checksum is never typed");

// Already on the portal by name + DOB, or name + father: not offered again.
assert.ok(probablyOnPortal(st({ dob: "2022-01-21" }), [{ studentName: "RIYA KUMARI VERMA", dob: "21/01/2022" }]));
assert.ok(probablyOnPortal(st({ fatherName: "Ram Verma" }), [{ studentName: "RIYA", fatherName: "RAM VERMA" }]));
assert.ok(!probablyOnPortal(st({ dob: "2022-01-21" }), [{ studentName: "RIYA VERMA", dob: "22/01/2022" }]));

// A checksum-valid test Aadhaar (Verhoeff), so the child is addable.
const OK_AADHAAR = (() => {
  for (let n = 0; n < 10; n++) {
    const a = `23412341234${n}`;
    if (buildUdiseAddPlan(st({ aadhaarNumber: a }), hh).fields.some((f) => f.control === "uuid" && f.value === a)) return a;
  }
  throw new Error("no valid test Aadhaar");
})();
const res = listUdiseAddCandidates({
  students: [
    st({ id: "a", fullName: "Aarav", classId: "c-n", aadhaarNumber: OK_AADHAAR }),
    st({ id: "g", fullName: "No Aadhaar Yet" }),
    st({ id: "b", fullName: "Has Pen", pen: "23263951182" }),
    st({ id: "c", fullName: "Transfer", udiseInboundTransferPending: true }),
    st({ id: "d", fullName: "Riya Verma", dob: "2022-01-21" }),
    st({ id: "e", fullName: "Gone", status: "inactive" }),
    st({ id: "f", fullName: "Odd", classId: "c-odd" }),
  ],
  portal: [{ studentName: "RIYA VERMA", dob: "21/01/2022" }],
  classLabelOf: (s) => ({ className: s.classId === "c-odd" ? "Toddlers" : "Nursery", sectionName: "A" }),
  householdOf: () => hh,
});
assert.deepEqual(res.candidates.map((c) => c.studentId).sort(), ["a", "g"]);
assert.equal(res.candidates[0]!.portalClassId, -3);
assert.equal(res.alreadyOnPortal.length, 1);
assert.equal(res.noPortalClass.length, 1);
assert.deepEqual(res.aadhaarPlaceholder, ["NO AADHAAR YET (Nursery)"], "added with 999999999999, flagged to collect");

console.log("udisePortalAdd selftest: ok");
