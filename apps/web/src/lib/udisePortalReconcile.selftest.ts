/**
 * A name is not an identity: the three patterns found on 2026-10-06.
 *
 * Run: npx tsx src/lib/udisePortalReconcile.selftest.ts
 */
import assert from "node:assert/strict";
import { normalizeStudent, type SisStudent } from "@/lib/sis";
import { reconcilePortalWithErp, sameChildEvidence } from "@/lib/udisePortalReconcile";

const st = (p: Partial<SisStudent>) =>
  normalizeStudent({ id: "s", admissionNo: "A-1", fullName: "X", status: "active", academicYearCode: "2026-27", ...p } as SisStudent);

// Another name entirely, same birth date + both parents (SUHANI ↔ ANJALI).
const anjali = st({ id: "anj", fullName: "Anjali Patel", dob: "2015-03-09", fatherName: "Indresh Patel", motherName: "Neelam Patel", pen: "0" });
// Surname never typed, and the child left (KAVYA JOSHI ↔ KAVYA).
const kavya = st({ id: "kav", fullName: "Kavya", dob: "2015-05-29", fatherName: "Abhishek Chandra Joshi", motherName: "Damini Joshi", status: "inactive", academicYearCode: "2025-26", pen: "23127598339" });
// One child, two portal records (AKSHITA ↔ SIYA).
const akshita = st({ id: "aks", fullName: "Akshita Dixit", dob: "2022-05-03", fatherName: "Saurabh Dixit", motherName: "Pratima Dixit", pen: "23113352547", fatherMobile: "8459199742" });
const stranger = st({ id: "str", fullName: "Riya", dob: "2015-03-09", fatherName: "Ram", motherName: "Sita", pen: "21111111111" });

const portal = [
  { studentName: "SUHANI PATEL", studentCodeNat: "21440774681", dob: "09/03/2015", gender: 2, fatherName: "INDRESH PATEL", motherName: "NEELAM PATEL", primaryMobile: "9682823436" },
  { studentName: "KAVYA JOSHI", studentCodeNat: "23127598339", dob: "29/05/2015", gender: 2, fatherName: "ABHISHEK CHANDRA JOSHI", motherName: "DAMINI JOSHI" },
  { studentName: "AKSHITA DIXIT", studentCodeNat: "23113352547", dob: "03/05/2022", gender: 2, fatherName: "SAURABH DIXIT", motherName: "PRATIMA DIXIT", primaryMobile: "8459199742" },
  { studentName: "SIYA SAURABH DIXIT", studentCodeNat: "23640091484", dob: "03/05/2022", gender: 2, fatherName: "SAURABH ADYASHANKAR DIXIT", motherName: "PRATIMA DUBEY", primaryMobile: "8459199742" },
  { studentName: "NOBODY KNOWN", studentCodeNat: "29999999999", dob: "01/01/2016", gender: 1, fatherName: "A", motherName: "B" },
];

const r = reconcilePortalWithErp({
  portal,
  erpAll: [anjali, kavya, akshita, stranger],
  activeIds: new Set(["anj", "aks", "str"]),
});
assert.deepEqual(r.differentName.map((x) => [x.portalName, x.erpName]), [
  ["SUHANI PATEL", "ANJALI PATEL"],
  ["SIYA SAURABH DIXIT", "AKSHITA DIXIT"],
]);
assert.match(r.differentName[0]!.why, /birth date \+ father \+ mother/);
assert.deepEqual(r.leftSchool.map((x) => [x.portalName, x.erpName, x.why]), [["KAVYA JOSHI", "KAVYA", "same PEN"]]);
assert.deepEqual(r.notInErp.map((x) => x.portalName), ["NOBODY KNOWN"]);
assert.deepEqual(r.portalDuplicates.map((d) => [d.a, d.b]), [["AKSHITA DIXIT", "SIYA SAURABH DIXIT"]]);
assert.match(r.portalDuplicates[0]!.why, /father \+ mobile/);

// A birth-date typo: same first name + both parents (SHREYANSH PATEL).
const shreyansh = st({ id: "shr", fullName: "Shreyansh Patel", dob: "2019-11-11", fatherName: "Jitendra Kumar Varma", motherName: "Aarti Patel", status: "inactive", academicYearCode: "2025-26" });
assert.match(
  sameChildEvidence({ studentName: "SHREYANSH PATEL", dob: "02/11/2019", fatherName: "JITENDRA KUMAR VARMA", motherName: "AARTI PATEL" }, shreyansh),
  /birth dates differ/,
);
// A sibling shares the parents, not the first name.
assert.equal(sameChildEvidence({ studentName: "PIYUSH PATEL", dob: "03/01/2017", fatherName: "INDRESH PATEL", motherName: "NEELAM PATEL" }, anjali), "");

// A birth date alone never makes two children one.
assert.equal(sameChildEvidence({ dob: "09/03/2015", fatherName: "SOMEONE", motherName: "ELSE" }, stranger), "");
// Titles are not names.
assert.ok(sameChildEvidence({ dob: "09/03/2015", fatherName: "MR. RAM KUMAR" }, stranger));

console.log("udisePortalReconcile selftest: ok");
