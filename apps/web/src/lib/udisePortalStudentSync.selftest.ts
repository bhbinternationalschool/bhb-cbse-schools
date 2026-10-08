/**
 * Run: npx tsx src/lib/udisePortalStudentSync.selftest.ts
 */
import assert from "node:assert/strict";
import { normalizeStudent, type Household, type SisStudent } from "@/lib/sis";
import {
  diffStudent,
  matchCopies,
  pickEp,
  pickGp,
  proposedValue,
  type PortalStudentCopy,
} from "@/lib/udisePortalStudentSync";

const st = (p: Partial<SisStudent>) =>
  normalizeStudent({ id: "s1", admissionNo: "BHB-1", fullName: "ARPIT PATEL", status: "active", ...p } as SisStudent);
const hh = { id: "h1", address: "", pincode: "", mobile: "9876543210", whatsappMobile: "", altMobile: "" } as unknown as Household;
const copy = (gp: Record<string, unknown>, fp: Record<string, unknown> = {}, ep?: Record<string, unknown>): PortalStudentCopy => ({
  studentId: "1567853709",
  pen: String(gp.studentCodeNat || "sid:1567853709"),
  gp: { studentId: 1567853709, ...gp },
  fp,
  ep,
  fetchedAt: "2026-10-07T00:00:00Z",
});
const of = (diffs: ReturnType<typeof diffStudent>, f: string) => diffs.find((d) => d.field === f);

// The whitelist never keeps an Aadhaar number.
assert.equal("uuid" in pickGp({ uuid: "999999999999", studentName: "X" }), false);
assert.deepEqual(Object.keys(pickEp({ admnStartDate: "03/04/2026", secret: 1 })), ["admnStartDate"]);

const portal = copy(
  {
    studentCodeNat: "23050629003", studentName: "ARPIT  PATEL", gender: 1, dob: "03/01/2023", fatherName: "HARINATH PRASAD PATEL",
    motherName: "REKHA DEVI", socCatId: 4, minorityId: 7, motherTongueDesc: "HINDI", bloodGroup: 3, cwsnYN: 2,
    apaarId: "123456789012", address: "AYAR VARANASI", pincode: 221210, primaryMobile: "8090101534",
  },
  { heightInCm: 98, weightInKg: "15.5" },
  { admnStartDate: "03/04/2026", rollNumber: "7" },
);

// ERP blank → bring into the ERP; same value (spacing/case aside) → nothing.
const blank = diffStudent(portal, st({ pen: "", gender: "" }), hh);
assert.equal(of(blank, "fullName"), undefined, "ARPIT  PATEL = ARPIT PATEL");
assert.equal(of(blank, "gender")?.action, "bring_into_erp");
assert.equal(of(blank, "gender")?.value, "M");
assert.equal(of(blank, "dob")?.value, "2023-01-03");
assert.equal(of(blank, "dob")?.portal, "03/01/2023");
assert.equal(of(blank, "category")?.value, "OBC");
assert.equal(of(blank, "religion"), undefined, "minority 7 names no religion");
assert.equal(of(blank, "bloodGroup")?.value, "B+");
assert.equal(of(blank, "isCwsn"), undefined, "a portal No is not written");
assert.equal(of(blank, "apaarId")?.action, "bring_into_erp");
assert.equal(of(blank, "pen")?.value, "23050629003");
assert.equal(of(blank, "heightCm")?.value, "98");
assert.equal(of(blank, "weightKg")?.value, "15.5");
assert.equal(of(blank, "address")?.action, "bring_into_erp");
assert.equal(of(blank, "pincode")?.value, "221210");
assert.equal(of(blank, "mobile")?.action, "check", "mobiles are never written");
assert.equal(of(blank, "rollNo")?.action, "check");
assert.equal(of(blank, "admissionDate")?.portal, "03/04/2026");
assert.equal(proposedValue(blank, "mobile"), null);
assert.equal(proposedValue(blank, "rollNo"), null);
assert.equal(proposedValue(blank, "dob")?.value, "2023-01-03");

// Both set and different → differs (never pre-decided); the ERP's own
// "B(+)" style is the same blood group as the portal's B+.
const set = diffStudent(
  portal,
  st({ pen: "23050629003", fullName: "ABHI PATEL", gender: "M", dob: "2023-01-03", category: "OBC", bloodGroup: "B(+)", motherName: "REKHA PATEL", heightCm: "98", weightKg: "15.5", apaarId: "123456789012", motherTongue: "Hindi" }),
  { ...hh, address: "AYAR", pincode: "221210" } as Household,
);
assert.equal(of(set, "fullName")?.action, "differs");
assert.equal(of(set, "fullName")?.erp, "ABHI PATEL");
assert.equal(of(set, "motherName")?.action, "differs");
assert.equal(of(set, "bloodGroup"), undefined, "B(+) is B+");
assert.equal(of(set, "motherTongue"), undefined, "Hindi = HINDI");
assert.equal(of(set, "address"), undefined, "an ERP address is never replaced");
assert.equal(of(set, "pen"), undefined);
assert.equal(of(set, "heightCm"), undefined);

// A minority on the portal fills a blank religion; contradicts a set one.
assert.equal(of(diffStudent(copy({ minorityId: 1 }), st({}), hh), "religion")?.value, "MUSLIM");
assert.equal(of(diffStudent(copy({ minorityId: 1 }), st({ religion: "HINDU" }), hh), "religion")?.action, "differs");
assert.equal(of(diffStudent(copy({ minorityId: 7 }), st({ religion: "MUSLIM" }), hh), "religion")?.action, "check");
// ERP EWS vs portal GEN is not a contradiction.
assert.equal(of(diffStudent(copy({ socCatId: 1 }), st({ category: "EWS" }), hh), "category"), undefined);
// Portal CWSN yes is a fact.
assert.equal(of(diffStudent(copy({ cwsnYN: 1 }), st({}), hh), "isCwsn")?.value, true);
// "Under investigation" (9) and junk are not blood groups.
assert.equal(of(diffStudent(copy({ bloodGroup: 9 }), st({}), hh), "bloodGroup"), undefined);

// Matching: PEN first; a PEN-less ERP child by evidence, only when one fits.
const a = copy({ studentCodeNat: "11111111111", studentName: "RIYA SINGH", dob: "01/02/2020", fatherName: "RAM SINGH", motherName: "SITA" });
const b = { ...copy({ studentCodeNat: "22222222222", studentName: "MOHAN LAL", dob: "05/06/2019", fatherName: "SHYAM LAL", motherName: "GITA" }), studentId: "2" };
const erp = [
  st({ id: "e1", fullName: "RIYA SINGH", pen: "11111111111" }),
  st({ id: "e2", fullName: "MOHAN", pen: "", dob: "2019-06-05", fatherName: "SHYAM LAL", motherName: "GITA" }),
  st({ id: "e3", fullName: "NOBODY", pen: "" }),
];
const m = matchCopies([a, b], erp);
assert.equal(m.matched.get("e1")?.by, "pen");
assert.equal(m.matched.get("e2")?.by, "evidence");
assert.equal(m.matched.get("e3"), undefined);
assert.equal(m.unmatched.length, 0);
// Twins: two portal children fit one ERP child → no guess.
const twin = { ...b, studentId: "3", pen: "33333333333", gp: { ...b.gp, studentCodeNat: "33333333333", studentName: "MOHINI LAL" } };
assert.equal(matchCopies([b, twin], [erp[1]!]).matched.get("e2"), undefined);

console.log("udisePortalStudentSync selftest: ok");
