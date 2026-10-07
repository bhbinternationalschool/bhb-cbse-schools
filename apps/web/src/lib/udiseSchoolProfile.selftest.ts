/**
 * UDISE+ School Profile ↔ ERP: captures keep every year, the fill plan only
 * targets empty boxes with facts the ERP really holds (or last year's answer,
 * labelled), and 1A is compared honestly — including the 7 Oct 2026 finding
 * that 1.21 Respondent Details held the Block Resource Centre's contact.
 *
 * Run: npx tsx src/lib/udiseSchoolProfile.selftest.ts
 */
import assert from "node:assert/strict";
import {
  academicYearForDate,
  buildProfileFillPlan,
  compareProfile1A,
  erpSchoolFacts,
  isEmptyField,
  normalizeAcademicYear,
  normalizeCapture,
  normalizeProfileStore,
  respondentWarnings,
  sectionKeyFromLabel,
  SECTION_1A_KEY,
  UDISE_PROFILE_SECTIONS,
  withCapture,
  type ProfileField,
  type SectionCapture,
} from "@/lib/udiseSchoolProfile";

const fld = (p: Partial<ProfileField>): ProfileField => ({ label: "", serial: "", type: "text", value: "", text: "", ...p });
const cap = (fields: Record<string, ProfileField>, text = ""): SectionCapture => ({
  title: "",
  capturedAt: "2026-10-07T10:00:00.000Z",
  capturedBy: "Office",
  fields,
  formStatus: "Needs Updation",
  text,
});

// ── Section keys and years ─────────────────────────────────────────────
assert.equal(sectionKeyFromLabel("1.58.1 to 1.58.20"), "1.58.1-1.58.20");
assert.equal(sectionKeyFromLabel(" 2.1  to 2.6 "), "2.1-2.6");
assert.equal(sectionKeyFromLabel("Physical Facilities"), "");
for (const s of UDISE_PROFILE_SECTIONS) assert.equal(sectionKeyFromLabel(s.tab), s.key, s.tab);
assert.equal(normalizeAcademicYear("2026-27"), "2026-27");
assert.equal(normalizeAcademicYear("2026-2027"), "2026-27");
assert.equal(normalizeAcademicYear("2026-28"), "", "non-consecutive years are not a session");
assert.equal(normalizeAcademicYear("26-27"), "");
assert.equal(academicYearForDate(new Date("2026-10-07T00:00:00Z")), "2026-27");
assert.equal(academicYearForDate(new Date("2027-03-31T00:00:00Z")), "2026-27");
assert.equal(academicYearForDate(new Date("2027-04-01T00:00:00Z")), "2027-28");

// ── Emptiness: a 0 is an answer, an unticked box is not "empty" ────────
assert.equal(isEmptyField(fld({ type: "number", value: "0" })), false);
assert.equal(isEmptyField(fld({ type: "number", value: "" })), true);
assert.equal(isEmptyField(fld({ type: "checkbox", value: "false" })), false);
assert.equal(isEmptyField(fld({ type: "select", value: "0", text: "--Select--" })), true);
assert.equal(isEmptyField(fld({ type: "select", value: "0", text: "0 - None" })), false);
assert.equal(isEmptyField(fld({ type: "radio", value: "" })), true);

// ── Normalising: junk dropped, earlier years kept ──────────────────────
assert.equal(normalizeCapture({ fields: {} }), null, "no capture time → not a capture");
const store0 = normalizeProfileStore({
  "2025-26": { "2.1-2.6": cap({ noPuccaBlocks: fld({ label: "2.3 Pucca blocks", type: "number", value: "2" }) }) },
  garbage: { "2.1-2.6": cap({}) },
  "2026-27": { notASection: cap({}) },
});
assert.deepEqual(Object.keys(store0), ["2025-26"]);
const store1 = withCapture(store0, "2026-27", "2.1-2.6", cap({}));
assert.ok(store1["2025-26"]?.["2.1-2.6"], "a new year's capture keeps last year's");
assert.ok(store1["2026-27"]?.["2.1-2.6"]);

// ── ERP facts: only what the stored slices hold ────────────────────────
const facts = erpSchoolFacts({
  profile: {
    legalName: "BHB INTERNATIONAL SCHOOL",
    address: "Puari Khurd",
    city: "Varanasi",
    pincode: "221202",
    phone: "",
    mobile: "+91 94519 38805",
    email: "Office@BHBinternational.school",
    affiliationNo: "213XXXX",
  },
  classes: [
    { name: "Class 8", sortOrder: 12, isActive: true },
    { name: "Nursery", sortOrder: 1, isActive: true },
    { name: "Old", sortOrder: 0, isActive: false },
  ],
  academicYears: [{ code: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31" }],
  academicYear: "2026-27",
  principalName: "",
});
assert.equal(facts.schoolName, "BHB INTERNATIONAL SCHOOL");
assert.equal(facts.address, "Puari Khurd, Varanasi");
assert.equal(facts.email, "office@bhbinternational.school");
assert.equal(
  erpSchoolFacts({ profile: { address: "Piyamilan Chauraha, Ayar, Varanasi, Uttar Pradesh 221202", city: "Varanasi" }, academicYear: "2026-27" }).address,
  "Piyamilan Chauraha, Ayar, Varanasi, Uttar Pradesh 221202",
  "the city is not repeated",
);
assert.equal(facts.phone, undefined, "a blank landline is unknown, not empty-string fact");
assert.equal(facts.principalName, undefined, "no single principal → no name");
assert.equal(facts.lowestClass, "Nursery");
assert.equal(facts.highestClass, "Class 8");
assert.equal(facts.sessionStart, "2026-04-01");
assert.equal(facts.medium, undefined, "medium only from the office's confirmed answer");
assert.deepEqual(erpSchoolFacts({ academicYear: "2026-27" }), {}, "no stored profile → no facts (never the code defaults)");

// ── Fill plan ─────────────────────────────────────────────────────────
const lastYear = cap({
  noPuccaBlocks: fld({ label: "2.3 Pucca blocks", serial: "2.3", type: "number", value: "2" }),
  classroomPry: fld({ label: "2.4 Classrooms primary", serial: "2.4", type: "number", value: "6" }),
  boundaryWall: fld({ label: "2.6 Boundary wall", serial: "2.6", type: "select", value: "1", text: "1-Pucca" }),
  hasRamp: fld({ label: "Ramp", type: "checkbox", value: "true" }),
});
const thisYear = cap({
  noPuccaBlocks: fld({ label: "2.3 Pucca blocks", serial: "2.3", type: "number", value: "3" }),
  classroomPry: fld({ label: "2.4 Classrooms primary", serial: "2.4", type: "number", value: "" }),
  boundaryWall: fld({ label: "2.6 Boundary wall", serial: "2.6", type: "select", value: "", text: "--Select--" }),
  hasRamp: fld({ label: "Ramp", type: "checkbox", value: "false" }),
  noComputers: fld({ label: "2.24 Computers", type: "number", value: "" }),
  schoolEmail: fld({ label: "1.33 School e-mail", type: "text", value: "" }),
  hmEmail: fld({ label: "Head master e-mail", type: "text", value: "" }),
  respondentEmail: fld({ label: "1.21 Respondent Details › Email", serial: "1.21", type: "text", value: "" }),
  lockedName: fld({ label: "School name", type: "text", value: "", locked: true }),
});
let store = withCapture(withCapture({}, "2025-26", "2.1-2.6", lastYear), "2026-27", "2.1-2.6", thisYear);
const plan = buildProfileFillPlan(store, "2026-27", "2.1-2.6", facts);
const byControl = Object.fromEntries(plan.fields.map((f) => [f.control, f]));
assert.equal(plan.earlierYear, "2025-26");
assert.equal(byControl.noPuccaBlocks, undefined, "a box with this year's answer is never touched");
assert.equal(byControl.classroomPry?.value, "6");
assert.equal(byControl.classroomPry?.source, "last-year");
assert.match(byControl.classroomPry!.note, /last year's answer \(2025-26\) — check/);
assert.equal(byControl.boundaryWall?.value, "1");
assert.equal(byControl.boundaryWall?.text, "1-Pucca");
assert.equal(byControl.hasRamp, undefined, "checkboxes are never filled");
assert.equal(byControl.schoolEmail?.value, "office@bhbinternational.school");
assert.equal(byControl.schoolEmail?.source, "erp");
assert.equal(byControl.hmEmail, undefined, "the head's email is not the school's");
assert.equal(byControl.respondentEmail, undefined, "the respondent is never filled from the school's details");
assert.equal(byControl.lockedName, undefined, "a locked box is the Block's");
assert.ok(plan.leftForYou.includes("2.24 Computers"));
assert.ok(plan.leftForYou.includes("Head master e-mail"));

// No current capture → nothing to plan against (send the section first).
assert.equal(buildProfileFillPlan(store, "2026-27", "2.7-2.19", facts).basedOn, "");
assert.equal(buildProfileFillPlan(store, "2026-27", "2.7-2.19", facts).fields.length, 0);
// A LATER year is never "last year".
store = withCapture(store, "2027-28", "2.1-2.6", cap({ classroomPry: fld({ label: "x", type: "number", value: "9" }) }));
assert.equal(buildProfileFillPlan(store, "2026-27", "2.1-2.6", facts).earlierYear, "2025-26");

// ── 1A vs ERP ─────────────────────────────────────────────────────────
const oneA = cap(
  {
    schoolName: fld({ label: "1.1 School Name", type: "text", value: "BHB INTERNATIONAL SCHOOL", locked: true }),
    pincode: fld({ label: "1.6 Pincode", type: "text", value: "221 202", locked: true }),
    schEmail: fld({ label: "1.9 School Email", type: "text", value: "bhbschool@gmail.com", locked: true }),
    mgmt: fld({ label: "1.12 School Management", type: "select", value: "5", text: "Private Unaided (Recognized)" }),
    lowCls: fld({ label: "1.13 Lowest class", type: "select", value: "-1", text: "Pre-Primary" }),
    medium: fld({ label: "1.18 Medium of instruction", type: "select", value: "19", text: "19-English" }),
    rEmail: fld({ label: "1.21 Respondent Details › Email", serial: "1.21", type: "text", value: "brcharhua@gmail.com" }),
    rMobile: fld({ label: "1.21 Respondent Details › Mobile", serial: "1.21", type: "text", value: "9415012345" }),
  },
  "1.20 ... 1.21 Respondent Details Name ABC Email brcharhua@gmail.com Mobile 9415012345 1.22 Something 9999999999",
);
const diffs = Object.fromEntries(compareProfile1A(oneA, { ...facts, medium: "English" }).map((d) => [d.item, d]));
assert.equal(diffs["School name"]?.status, "same");
assert.equal(diffs["Pincode"]?.status, "same", "spaces in a pincode are not a difference");
assert.equal(diffs["School email"]?.status, "differs");
assert.equal(diffs["Management"]?.status, "erp-unknown", "the ERP holds no management type — not a difference");
assert.equal(diffs["Lowest class"]?.status, "differs");
assert.equal(diffs["Medium of instruction"]?.status, "same", "19-English vs English");
assert.equal(diffs["School mobile"], undefined, "the respondent's mobile is not the school mobile row");
assert.deepEqual(compareProfile1A(undefined, facts), []);

const warn = respondentWarnings(oneA, facts);
assert.equal(warn.length, 2, warn.join(" | "));
assert.match(warn[0]!, /brcharhua@gmail\.com.*Block Resource Centre/);
assert.match(warn[1]!, /9415012345 is not one of the school's numbers/);
assert.ok(!warn.join(" ").includes("9999999999"), "the next item's number is not the respondent's");
// The school's own respondent contact raises nothing.
const ok1A = cap({
  rEmail: fld({ label: "1.21 Respondent Details › Email", serial: "1.21", value: "office@bhbinternational.school" }),
  rMobile: fld({ label: "1.21 Respondent Details › Mobile", serial: "1.21", value: "9451938805" }),
});
assert.deepEqual(respondentWarnings(ok1A, facts), []);
assert.equal(SECTION_1A_KEY, "1.1-1.30");

console.log("udiseSchoolProfile selftest: ok");
