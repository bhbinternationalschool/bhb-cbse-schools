/**
 * Run: npx tsx src/lib/udiseTeacherApaar.selftest.ts
 *
 * Director, 6 Oct 2026: the Office Robot fills UDISE+ teacher profiles from
 * ERP Staff and opens "Generate APAAR ID" for children whose families said
 * yes. Codes are the portal's own, read off its live forms that day.
 */
import assert from "node:assert/strict";
import type { StaffRecord } from "./foundationMasters";
import type { MastersState } from "./masters";
import {
  academicLevelCode,
  buildTeacherBoard,
  buildTeacherFillPlan,
  classesTaughtCode,
  matchPortalTeacher,
  pickPortalTeacher,
  portalCode,
  portalDate,
  professionalQualCode,
  teacherTypeCode,
} from "./udiseTeacherFill";
import { buildApaarFillPlan, buildApaarQueue, consenterOf } from "./udiseApaarFill";

console.log("udiseTeacherApaar.selftest.ts");

/* ── Wording → portal codes; unknown stays blank ── */
assert.equal(academicLevelCode("M.A., B.Ed"), "5");
assert.equal(academicLevelCode("BSc"), "4");
assert.equal(academicLevelCode("Intermediate"), "3");
assert.equal(academicLevelCode("Ph.D (Hindi)"), "7");
assert.equal(academicLevelCode("CTET pass"), "", "not an academic level");
assert.equal(professionalQualCode("M.A., B.Ed"), "3");
assert.equal(professionalQualCode("BTC"), "1");
assert.equal(professionalQualCode("D.El.Ed"), "10");
assert.equal(professionalQualCode("NTT"), "11");
assert.equal(professionalQualCode("M.Ed, B.Ed"), "4", "highest wins");
assert.equal(professionalQualCode("B.P.Ed"), "13");
assert.equal(professionalQualCode("B.A."), "", "no training named is not 'None'");
assert.equal(teacherTypeCode("Principal"), "6");
assert.equal(teacherTypeCode("Vice Principal"), "7");
assert.equal(teacherTypeCode("Headmistress"), "1");
assert.equal(teacherTypeCode("Coordinator"), "", "only what it says outright");
assert.equal(teacherTypeCode("Head Teacher"), "1");
assert.equal(teacherTypeCode("PRT"), "3");
assert.equal(teacherTypeCode("Accountant"), "");
assert.equal(classesTaughtCode(new Set(["PRE_PRIMARY"])), "10");
assert.equal(classesTaughtCode(new Set(["PRE_PRIMARY", "PRIMARY"])), "11");
assert.equal(classesTaughtCode(new Set(["PRIMARY", "MIDDLE"])), "3");
assert.equal(classesTaughtCode(new Set(["PRE_PRIMARY", "MIDDLE"])), "", "no portal code for that mix");
assert.equal(portalDate("2023-04-04"), "04/04/2023");
assert.equal(portalDate("23/03/1991"), "23/03/1991");
assert.equal(portalDate(""), "");
assert.equal(portalCode("5-Post Graduate"), "5");
assert.equal(portalCode("1 - Regular"), "1");
assert.equal(portalCode("Regular"), "");

/* ── Test fixtures ── */
const staff = (over: Partial<StaffRecord>): StaffRecord =>
  ({
    id: "s",
    empCode: "",
    fullName: "",
    stream: "teaching",
    status: "active",
    gender: "",
    casteCategory: "",
    dateOfBirth: "",
    joiningDate: "",
    jobType: "",
    designationId: null,
    qualification: "",
    subjectsTaught: "",
    mobile: "",
    email: "",
    oasisId: "",
    classTeacherLinks: [],
    subjectTeachingLinks: [],
    ...over,
  }) as unknown as StaffRecord;

const ravi = staff({
  id: "s1",
  fullName: "Ravindra Yadav",
  gender: "M",
  casteCategory: "OBC",
  dateOfBirth: "1991-03-23",
  joiningDate: "2025-02-02",
  jobType: "confirmed",
  designationId: "d1",
  qualification: "M.P.Ed",
  mobile: "+91 9876543210",
  email: "ravi@example.com",
  subjectTeachingLinks: [
    { id: "l1", classId: "c6", sectionId: null, subjectId: "pe", academicYearCode: "2026-27", periodsPerWeek: 12 },
    { id: "l2", classId: "c3", sectionId: null, subjectId: "eng", academicYearCode: "2026-27", periodsPerWeek: 4 },
    { id: "l3", classId: "c1", sectionId: null, subjectId: "eng", academicYearCode: "2025-26", periodsPerWeek: 30 },
  ],
});
const masters = {
  designations: [{ id: "d1", code: "TGT", name: "TGT" }],
  classes: [
    { id: "c1", name: "Nursery", groupCode: "PRE_PRIMARY" },
    { id: "c3", name: "III", groupCode: "PRIMARY" },
    { id: "c6", name: "VI", groupCode: "MIDDLE" },
  ],
  subjects: [
    { id: "pe", code: "PE", nameEn: "Physical Education" },
    { id: "eng", code: "ENG", nameEn: "English" },
  ],
} as unknown as MastersState;

/* ── GP: what the ERP knows, and the rest listed ── */
{
  const p = buildTeacherFillPlan(ravi, "gp", masters, "2026-27");
  const v = Object.fromEntries(p.fields.map((f) => [f.control, f.value]));
  assert.deepEqual(v, { gender: "1", socialCat: "4", qualProf: "14", mobile: "9876543210", email: "ravi@example.com" });
  assert.ok(p.leftForYou.includes("Highest academic qualification"), "M.P.Ed names no academic level");
  assert.ok(!p.fields.some((f) => ["empName", "dob", "aadhaarNo"].includes(f.control)), "locked fields never offered");
}

/* ── AT: this year's links only; joining date is a hint for the post ── */
{
  const p = buildTeacherFillPlan(ravi, "at", masters, "2026-27");
  const v = Object.fromEntries(p.fields.map((f) => [f.control, f.value]));
  assert.equal(v.natureOfAppt, "1");
  assert.equal(v.dojPs, "02/02/2025");
  assert.equal(v.tchType, "3");
  assert.equal(v.classTaught, "3", "VI + III this year — last year's Nursery link ignored");
  assert.equal(v.subTaught1, "92", "most periods first");
  assert.equal(v.subTaught2, "46");
  assert.ok(!("docPh" in v), "date of present post is not guessed");
  assert.ok(p.leftForYou.some((x) => x.startsWith("Date of joining present post (joined the school 02/02/2025)")));
}

/* ── TD: the ERP has none of it ── */
assert.equal(buildTeacherFillPlan(ravi, "td", masters, "2026-27").fields.length, 0);

/* ── Matching: National Code, else name AND date of birth ── */
{
  const coded = { ...ravi, oasisId: "TP73446390" } as StaffRecord;
  const twin = staff({ id: "s2", fullName: "Ravindra Yadav", dateOfBirth: "1988-01-01" });
  assert.deepEqual(
    matchPortalTeacher([coded, twin], { empStaffId: 1, nationalCode: "tp73446390", staffName: "X" }).kind,
    "matched",
  );
  const byNameDob = matchPortalTeacher([ravi, twin], { empStaffId: 1, nationalCode: "", staffName: "RAVINDRA  YADAV", dateOfBirth: "23/03/1991" });
  assert.ok(byNameDob.kind === "matched" && byNameDob.staff.id === "s1" && byNameDob.by === "name_dob");
  assert.equal(matchPortalTeacher([ravi, twin], { empStaffId: 1, nationalCode: "", staffName: "Ravindra Yadav" }).kind, "unsure", "a name alone is not an identity");
  assert.equal(matchPortalTeacher([ravi], { empStaffId: 1, nationalCode: "", staffName: "Anita" }).kind, "none");
}

/* ── Board: differences, missing codes, ERP teachers not on the portal ── */
{
  const other = staff({ id: "s9", fullName: "New Teacher", stream: "teaching" });
  const clerk = staff({ id: "s8", fullName: "Clerk", stream: "non_teaching" });
  const b = buildTeacherBoard([ravi, other, clerk], [
    pickPortalTeacher({
      empStaffId: 105999666,
      nationalCode: "TP73446390",
      staffName: "RAVINDRA YADAV",
      gender: "1-Male",
      dateOfBirth: "23/03/1991",
      dateOfJoiningInPresentSchool: "02/02/2024",
      academicQualification: "5-Post Graduate",
      aadhaarNo: "xxxx-xxxx-4413",
      mobile: "85******19",
    }),
  ]);
  assert.equal(b.rows[0]!.match, "matched");
  assert.equal(b.rows[0]!.codeMissingInErp, true);
  assert.deepEqual(b.rows[0]!.differences, ["Joined this school: portal 02/02/2024, ERP 02/02/2025"]);
  assert.deepEqual(b.notOnPortal.map((x) => x.name), ["New Teacher"], "non-teaching staff are not teachers");
  assert.ok(!("aadhaarNo" in pickPortalTeacher({ aadhaarNo: "x", mobile: "y" })), "Aadhaar and mobile never leave the portal tab");
}

/* ── APAAR: who consented, relation, their own card ── */
{
  const kid = {
    apaarConsentBy: "KISHAN YADAV · WhatsApp +9198… · msg x",
    fatherName: "Kishan Yadav",
    motherName: "Rita Devi",
    fatherAadhaarNumber: "234567890123",
    motherAadhaarNumber: "",
  };
  assert.equal(consenterOf(kid), "KISHAN YADAV");
  const p = buildApaarFillPlan(kid, "Varanasi");
  const v = Object.fromEntries(p.fields.map((f) => [f.control, f.value]));
  assert.deepEqual(v, { consenterName: "KISHAN YADAV", consenterRelation: "1", idType: "1", idNo: "234567890123", place: "Varanasi" });
  assert.ok(p.leftForYou.some((x) => /printed consent/.test(x)), "the physical-copy rule is always said");

  // A grandparent said yes: no relation guessed, and the father's card is not theirs.
  const g = buildApaarFillPlan({ ...kid, apaarConsentBy: "RAM PRASAD · WhatsApp" }, "Varanasi");
  const gv = Object.fromEntries(g.fields.map((f) => [f.control, f.value]));
  assert.equal(gv.consenterName, "RAM PRASAD");
  assert.ok(!("consenterRelation" in gv) && !("idNo" in gv));
  // Last four only is not a card number.
  const l4 = buildApaarFillPlan({ ...kid, fatherAadhaarNumber: "0123" }, "Varanasi");
  assert.ok(!l4.fields.some((f) => f.control === "idNo"));
}

/* ── APAAR queue: ERP-ready AND portal-verified AND no APAAR ── */
{
  const q = buildApaarQueue(
    [
      { studentId: 1, studentName: "A", studentCodeNat: "23402219306", classId: 1, sectionId: 9, uuidStatus: 1 },
      { studentId: 2, studentName: "B", studentCodeNat: "23248590915", classId: 1, sectionId: 9, uuidStatus: 0 },
      { studentId: 3, studentName: "C", studentCodeNat: "23374099810", classId: 1, sectionId: 9, uuidStatus: 1, apaarIdStatusDesc: "Generated" },
      { studentId: 4, studentName: "D", studentCodeNat: "23111111111", classId: 2, sectionId: 7, uuidStatus: 1 },
      { studentId: 5, studentName: "E", studentCodeNat: "", classId: 2, sectionId: 7, uuidStatus: 1 },
    ],
    new Set(["23402219306", "23248590915", "23374099810"]),
  );
  assert.deepEqual(q.items.map((i) => i.name), ["A"]);
  assert.deepEqual(q.aadhaarNotVerified.map((i) => i.name), ["B"]);
  assert.equal(q.waitingInErp, 2, "D (no consent) and E (no PEN) wait on the ERP side");
  assert.equal(q.items[0]!.sectionId, "9");
}

console.log("  ✓ UDISE teacher profiles + APAAR consent page — portal codes, identity, readiness");
