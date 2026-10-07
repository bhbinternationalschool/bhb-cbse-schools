/**
 * Run: npx tsx src/lib/udiseTeacherSync.selftest.ts
 *
 * Director, 7 Oct 2026: two-way UDISE+ ↔ ERP sync, teachers part. The
 * portal's teacher details come into the ERP only as a review the office
 * ticks; this checks the whitelist, the code → ERP value mapping, that an
 * unknown never becomes a value, and that a stale tick is refused.
 */
import assert from "node:assert/strict";
import type { StaffRecord } from "./foundationMasters";
import type { MastersState } from "./masters";
import {
  buildTeacherSyncReview,
  codeOf,
  defaultTicked,
  isoDate,
  normalizePortalTeacherSnapshot,
  pickPortalForm,
  planStaffPatch,
  type PortalTeacherSnapshot,
} from "./udiseTeacherSync";
import { buildTeacherAddPlan, buildTeacherBoard, pickPortalTeacher } from "./udiseTeacherFill";

console.log("udiseTeacherSync.selftest.ts");

/* ── Small readers ── */
assert.equal(codeOf("5-Post Graduate"), "5");
assert.equal(codeOf("5"), "5");
assert.equal(codeOf("Regular"), "");
assert.equal(isoDate("23/03/1991"), "1991-03-23");
assert.equal(isoDate("1991-03-23T00:00:00.000+00:00"), "1991-03-23");
assert.equal(isoDate("31/02/1991"), "", "not a real date");
assert.equal(isoDate(""), "");

/* ── Whitelist: Aadhaar never kept, unknown keys dropped, null = not read ── */
{
  const gp = pickPortalForm("gp", { empName: "X", referenceKey: "123412341234", aadhaar: "1", empNamePerUid: "X", mobile: 9876543210, socialCat: { id: 4 } });
  assert.deepEqual(gp, { empName: "X", mobile: "9876543210", socialCat: "4" });
  assert.equal(pickPortalForm("at", null), null);
  const snap = normalizePortalTeacherSnapshot(
    {
      listsRead: { teaching: true, non_teaching: "yes" },
      teachers: [
        { staffType: "teaching", list: { empStaffId: 1, staffName: "A", aadhaarNo: "x" }, gp: { referenceKey: "1" }, at: null },
        { staffType: "x", list: {} },
        "junk",
      ],
    },
    "Office",
    "2026-10-07T10:00:00Z",
  );
  assert.equal(snap.teachers.length, 1, "a row with neither name nor code is dropped");
  assert.ok(!("aadhaarNo" in snap.teachers[0]!.list));
  assert.deepEqual(snap.teachers[0]!.gp, {}, "read, nothing known");
  assert.equal(snap.teachers[0]!.at, null, "not read stays not read");
  assert.deepEqual(snap.listsRead, { teaching: true, non_teaching: false }, "only a real true counts");
}

/* ── Fixtures ── */
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
    aadhaarNo: "",
    classTeacherLinks: [],
    subjectTeachingLinks: [],
    ...over,
  }) as unknown as StaffRecord;

const masters = {
  designations: [
    { id: "dP", code: "P", name: "Principal", isActive: true },
    { id: "dT", code: "TGT", name: "TGT", isActive: true },
    { id: "dR", code: "PRT", name: "PRT", isActive: true },
  ],
  classes: [
    { id: "c3", name: "III", groupCode: "PRIMARY" },
    { id: "c6", name: "VI", groupCode: "MIDDLE" },
  ],
  subjects: [{ id: "eng", code: "ENG", nameEn: "English" }],
} as unknown as MastersState;

const blank = staff({ id: "s1", fullName: "Sunita Devi", dateOfBirth: "1985-07-01" });
const full = staff({
  id: "s2",
  fullName: "Ravindra Yadav",
  gender: "M",
  casteCategory: "OBC",
  dateOfBirth: "1991-03-23",
  joiningDate: "2025-02-02",
  jobType: "confirmed",
  designationId: "dT",
  qualification: "B.A.",
  subjectsTaught: "English",
  mobile: "9876543210",
  email: "ravi@example.com",
  oasisId: "TP73446390",
  subjectTeachingLinks: [{ id: "l", classId: "c6", sectionId: null, subjectId: "eng", academicYearCode: "2026-27", periodsPerWeek: 6 }],
});
const other = staff({ id: "s3", fullName: "Other Person", mobile: "9000000001", oasisId: "TP00000001" });
const clerk = staff({ id: "s4", fullName: "Clerk Kumar", stream: "non_teaching" });

const snapshot: PortalTeacherSnapshot = normalizePortalTeacherSnapshot(
  {
    listsRead: { teaching: true, non_teaching: false },
    teachers: [
      {
        // Matched by name + DOB; the ERP is blank almost everywhere.
        staffType: "teaching",
        list: { empStaffId: 11, nationalCode: "TP11111111", staffName: "SUNITA DEVI", dateOfBirth: "01/07/1985", academicQualification: "5-Post Graduate" },
        gp: { gender: "2", socialCat: "2", qualAcad: "5", qualProf: "3", mobile: "9000000001", email: "Sunita@Example.com" },
        at: { natureOfAppt: "1", dojPs: "01/04/2015", tchType: "3", classTaught: "1", subTaught1: "41", subTaught2: "77" },
        td: {},
      },
      {
        // Matched by National Code; disagreements.
        staffType: "teaching",
        list: { empStaffId: 12, nationalCode: "TP73446390", staffName: "RAVINDRA KUMAR YADAV", dateOfBirth: "23/03/1990" },
        gp: { gender: "1", socialCat: "4", qualAcad: "5", qualProf: "3", mobile: "9876543210", email: "ravi@example.com" },
        at: { natureOfAppt: "2", dojPs: "02/02/2025", tchType: "6", classTaught: "1", subTaught1: "46", subTaught2: "41" },
        td: null,
      },
      {
        staffType: "teaching",
        list: { empStaffId: 13, nationalCode: "TP99999999", staffName: "NOBODY HERE" },
        gp: null,
        at: null,
        td: null,
      },
    ],
  },
  "Office",
  "2026-10-07T10:00:00Z",
);

const review = buildTeacherSyncReview(snapshot, [blank, full, other, clerk], masters, "2026-27", { s1: "rev1", s2: "rev2" });
const byField = (r: (typeof review.rows)[number]) => Object.fromEntries(r.items.map((i) => [i.field, i]));

/* ── Blank ERP record: what can be brought in, and what cannot ── */
{
  const r = review.rows[0]!;
  assert.equal(r.match, "matched");
  assert.equal(r.matchedBy, "name_dob");
  assert.equal(r.erpRevision, "rev1");
  const f = byField(r);
  assert.equal(f.gender!.apply!.value, "F");
  assert.equal(f.gender!.action, "bring_into_erp");
  assert.equal(f.socialCat!.apply!.value, "SC");
  assert.equal(f.qualification!.apply!.value, "Post Graduate; B.Ed");
  assert.equal(f.email!.apply!.value, "sunita@example.com");
  assert.equal(f.nationalCode!.apply!.value, "TP11111111");
  assert.equal(f.dojPs!.apply!.value, "2015-04-01", "ERP keeps ISO dates");
  assert.equal(f.mobile!.apply, null, "a number on another staff record is never moved");
  assert.match(f.mobile!.note!, /Other Person/);
  assert.equal(f.natureOfAppt!.apply, null, "Regular is Confirmed OR Probation — not guessed");
  assert.equal(f.post!.apply, null, "Assistant teacher is TGT or PRT — not guessed");
  assert.match(f.post!.note!, /TGT, PRT/);
  assert.equal(f.classTaught!.apply, null, "links are changed by hand");
  assert.equal(f.subjects!.apply, null, "subject code 77 has no known label");
  assert.ok(!("name" in f), "same name, different case is not a difference");
  assert.ok(!("dob" in f));
  assert.ok(defaultTicked(f.gender!));
  assert.ok(!defaultTicked(f.mobile!), "nothing to apply → no tick");
  assert.deepEqual(r.unread, ["Training: read, no known fields"]);
}

/* ── Filled ERP record: disagreements, default unticked ── */
{
  const r = review.rows[1]!;
  assert.equal(r.matchedBy, "national_code");
  const f = byField(r);
  assert.equal(f.name!.action, "differs");
  assert.equal(f.name!.apply!.value, "RAVINDRA KUMAR YADAV");
  assert.equal(f.dob!.apply!.value, "1990-03-23");
  assert.equal(f.qualification!.action, "differs", "B.A. (Graduate) vs Post Graduate");
  assert.equal(f.qualification!.apply!.value, "Post Graduate; B.Ed");
  assert.equal(f.natureOfAppt!.apply!.value, "contract", "Contract is one ERP value");
  assert.equal(f.post!.apply!.value, "dP", "Principal is the only designation of that post");
  assert.equal(f.classTaught!.action, "differs", "links say upper primary, portal says primary");
  assert.equal(f.subjects!.apply!.value, "English, Hindi", "adds what the ERP list lacks");
  assert.ok(!("gender" in f) && !("socialCat" in f) && !("mobile" in f) && !("email" in f) && !("nationalCode" in f) && !("dojPs" in f));
  assert.ok(r.items.every((i) => !defaultTicked(i)), "differences start unticked");
  assert.deepEqual(r.unread, ["Training: not read"]);
}

/* ── No match: nothing offered; missing only for lists that were read ── */
{
  assert.equal(review.rows[2]!.match, "none");
  assert.equal(review.rows[2]!.items.length, 0);
  assert.deepEqual(review.notOnPortal.map((x) => x.name), ["Other Person"], "the clerk's list was not read — not 'missing'");
}

/* ── Apply plan: only ticked, only if unchanged ── */
{
  const r = review.rows[1]!;
  const ok = planStaffPatch(r, [
    { staffId: "s2", field: "dob", value: "1990-03-23" },
    { staffId: "s2", field: "post", value: "dP" },
  ]);
  assert.deepEqual(ok.patch, { dateOfBirth: "1990-03-23", designationId: "dP" });
  assert.equal(ok.stale.length, 0);
  const stale = planStaffPatch(r, [{ staffId: "s2", field: "dob", value: "1999-01-01" }]);
  assert.equal(stale.stale.length, 1, "a value nobody saw is refused");
  const shown = planStaffPatch(r, [{ staffId: "s2", field: "classTaught", value: "" }]);
  assert.equal(shown.stale.length, 1, "shown-only items cannot be applied");
}

/* ── Add New Staff plan: Aadhaar only when valid ── */
{
  const withA = buildTeacherAddPlan(staff({ fullName: "Sunita Devi", dateOfBirth: "1985-07-01", aadhaarNo: "2341 2341 2346" }), masters, "2026-27");
  const v = Object.fromEntries(withA.fields.map((f) => [f.control, f.value]));
  assert.equal(v.empName, "SUNITA DEVI");
  assert.equal(v.dob, "01/07/1985");
  assert.equal(withA.aadhaarFilled, true, "234123412346 passes the Verhoeff check");
  assert.equal(v.referenceKey, "234123412346");
  const bad = buildTeacherAddPlan(staff({ fullName: "X Y", aadhaarNo: "1234" }), masters, "2026-27");
  assert.equal(bad.aadhaarFilled, false);
  assert.ok(!bad.fields.some((f) => f.control === "referenceKey"));
  assert.ok(bad.leftForYou.some((x) => /not a valid 12-digit/.test(x)));
  assert.ok(bad.leftForYou.includes("Name as per Aadhaar"), "never the ERP name");
  assert.ok(bad.leftForYou.includes("Date of birth"));
}

/* ── Board: an unsettled match or a held National Code is never queued for adding ── */
{
  const twinA = staff({ id: "t1", fullName: "Anita Singh", dateOfBirth: "1990-01-01" });
  const twinB = staff({ id: "t2", fullName: "Anita Singh", dateOfBirth: "1992-01-01" });
  const coded = staff({ id: "t3", fullName: "Coded One", oasisId: "TP55555555" });
  const fresh = staff({ id: "t4", fullName: "Fresh Teacher" });
  const b = buildTeacherBoard([twinA, twinB, coded, fresh], [pickPortalTeacher({ empStaffId: 1, nationalCode: "", staffName: "ANITA SINGH" })]);
  assert.deepEqual(b.notOnPortal.map((x) => x.name), ["Fresh Teacher"]);
  assert.deepEqual(b.maybeOnPortal.map((x) => x.staffId).sort(), ["t1", "t2", "t3"]);
}

console.log("ok");
