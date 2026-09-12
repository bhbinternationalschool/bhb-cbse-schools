/**
 * The office typed three different numbers and one Aadhaar, and the system
 * flattened them. Pinned here so it cannot happen again.
 *
 * Reported 2026-09-12: "we have entered father mobile, mother mobile and
 * whatsapp numbers different but system pick mother's number and pasted every
 * where", and "father and mother aadhar number and other details like
 * education occupation etc. all vanishes".
 *
 * Three separate mechanisms, one test file:
 *
 *  1. alignHouseholdMobiles filled a blank father's mobile from the household
 *     mobile whenever guardianRelation read "Father" — the dropdown's DEFAULT,
 *     not an answer anyone gave — so a family's one number (often the
 *     mother's) was recorded as the father's. 186 of 717 production rows carry
 *     the same number for both parents, and it is the household number in
 *     every one.
 *  2. It also forced WhatsApp to the guardian mobile whenever the stored
 *     WhatsApp equalled the stored mobile, which normalizeHousehold makes true
 *     for every household that never had a separate one (175 of 200). A
 *     different WhatsApp number could be typed, saved, and was gone on reopen.
 *  3. normalizeStudent blanked the father's and mother's full Aadhaar the
 *     moment verification read "verified_udise" — removed for the student's
 *     own number on 2026-09-06 and missed for the parents'.
 *
 * The database half of the same report (sis_students.profile never written on
 * update) is fixed in migration 20260912100000 and rehearsed against a real
 * Postgres; what this file can check is that the client still carries the
 * fields at all.
 *
 * Run: npx tsx src/lib/sisContacts.selftest.ts
 */
import assert from "node:assert/strict";
import {
  alignHouseholdMobiles,
  normalizeStudent,
  studentProfileExtras,
  studentProfileFromRow,
  type Household,
} from "./sis";

console.log("sisContacts.selftest.ts");

const hh = (mobile: string, whatsappMobile: string) =>
  ({ mobile, whatsappMobile }) as Pick<Household, "mobile" | "whatsappMobile">;

// ── 1. A separate WhatsApp number survives the save ───────────────────
{
  const r = alignHouseholdMobiles({
    relation: "Father",
    fatherMobile: "9111111111",
    motherMobile: "9222222222",
    householdMobile: "9111111111",
    whatsappMobile: "9333333333",
    // The common case: the household never had its own WhatsApp number, so
    // normalizeHousehold copied the mobile into it. That must not be read as
    // "WhatsApp follows the mobile".
    previousHousehold: hh("9111111111", "9111111111"),
    previousFatherMobile: "9111111111",
    previousMotherMobile: "9222222222",
  });
  assert.equal(r.whatsappMobile, "9333333333", "the typed WhatsApp number is kept");
  assert.equal(r.householdMobile, "9111111111", "guardian mobile untouched");
  assert.equal(r.fatherMobile, "9111111111", "father untouched");
  assert.equal(r.motherMobile, "9222222222", "mother untouched");
  console.log("  ok  a WhatsApp number different from the guardian mobile is kept");
}

// ── 2. One known number is never asserted as the father's ─────────────
{
  // A new admission where the family gave one number — the mother's — and
  // nobody touched the guardian-relation dropdown (so it reads "Father").
  const r = alignHouseholdMobiles({
    relation: "Father",
    fatherMobile: "",
    motherMobile: "9222222222",
    householdMobile: "9222222222",
    whatsappMobile: "",
    previousHousehold: null,
  });
  assert.equal(r.fatherMobile, "", "an unknown father's mobile stays unknown");
  assert.equal(r.motherMobile, "9222222222", "the mother's number stays hers");
  assert.equal(r.householdMobile, "9222222222", "the family's number is the household's");
  assert.equal(r.whatsappMobile, "9222222222", "and WhatsApp falls back to it");
  console.log("  ok  the one number given is not copied into the father's field");
}

// ── 3. Editing the guardian parent still updates the household ────────
{
  const r = alignHouseholdMobiles({
    relation: "Father",
    fatherMobile: "9555555555", // corrected by the office
    motherMobile: "9222222222",
    householdMobile: "9111111111", // still the old one on screen
    whatsappMobile: "9111111111",
    previousHousehold: hh("9111111111", "9111111111"),
    previousFatherMobile: "9111111111",
    previousMotherMobile: "9222222222",
  });
  assert.equal(r.householdMobile, "9555555555", "household follows the guardian's new number");
  assert.equal(r.motherMobile, "9222222222", "the other parent is never written to");
  console.log("  ok  correcting the guardian parent's mobile moves the household mobile");
}

// ── 4. Correcting the household mobile follows the guardian only when
//       the two were already the same number ─────────────────────────
{
  const inStep = alignHouseholdMobiles({
    relation: "Mother",
    fatherMobile: "9111111111",
    motherMobile: "9222222222",
    householdMobile: "9666666666", // corrected here
    whatsappMobile: "",
    previousHousehold: hh("9222222222", "9222222222"),
    previousFatherMobile: "9111111111",
    previousMotherMobile: "9222222222",
  });
  assert.equal(inStep.motherMobile, "9666666666", "guardian parent follows the one correction");
  assert.equal(inStep.fatherMobile, "9111111111", "the father is left alone");

  const notInStep = alignHouseholdMobiles({
    relation: "Father",
    fatherMobile: "9111111111", // the father's own phone
    motherMobile: "",
    householdMobile: "9777777777", // a different number the school reaches them on
    whatsappMobile: "",
    previousHousehold: hh("9888888888", ""),
    previousFatherMobile: "9111111111",
    previousMotherMobile: "",
  });
  assert.equal(
    notInStep.fatherMobile,
    "9111111111",
    "a household mobile that was never the father's does not overwrite his",
  );
  assert.equal(notInStep.householdMobile, "9777777777", "and the household keeps its own");
  console.log("  ok  a household correction reaches the guardian only when they matched");
}

// ── 5. Parents' full Aadhaar survives UDISE+ verification ─────────────
{
  const s = normalizeStudent({
    id: "stu_1",
    fullName: "Aarush Patel",
    aadhaarNumber: "111122223333",
    aadhaarVerification: "verified_udise",
    fatherAadhaarNumber: "4444 5555 7141",
    fatherAadhaarVerification: "verified_udise",
    motherAadhaarNumber: "666677777639",
    motherAadhaarVerification: "verified_udise",
  });
  assert.equal(s.aadhaarNumber, "111122223333", "the student's own number is kept");
  assert.equal(s.fatherAadhaarNumber, "444455557141", "the father's full number is kept");
  assert.equal(s.motherAadhaarNumber, "666677777639", "the mother's full number is kept");
  assert.equal(s.fatherAadhaarLast4, "7141", "last four still derived");
  assert.equal(s.motherAadhaarLast4, "7639", "last four still derived");

  // Re-normalizing happens on every load, merge and save.
  const again = normalizeStudent(s);
  assert.equal(again.fatherAadhaarNumber, "444455557141", "and survives re-normalizing");
  console.log("  ok  father/mother Aadhaar is not blanked on UDISE+ verification");
}

// ── 6. The fields the office types reach the profile bag and come back ─
{
  const s = normalizeStudent({
    id: "stu_2",
    fullName: "Aarush Patel",
    aadhaarNumber: "111122223333",
    fatherAadhaarNumber: "444455557141",
    motherAadhaarNumber: "666677777639",
    fatherOccupation: "Farmer",
    motherOccupation: "Homemaker",
    fatherQualification: "Intermediate",
    motherQualification: "Graduate",
    annualIncome: "120000",
    caste: "Patel",
    permanentAddress: "Ayar, Varanasi",
    bankAccountNo: "123456789012",
  });
  const bag = studentProfileExtras(s);
  for (const key of [
    "aadhaarNumber",
    "fatherAadhaarNumber",
    "motherAadhaarNumber",
    "fatherOccupation",
    "motherOccupation",
    "fatherQualification",
    "motherQualification",
    "annualIncome",
    "caste",
    "permanentAddress",
    "bankAccountNo",
  ] as const) {
    assert.ok(key in bag, `${key} must travel in sis_students.profile`);
  }

  // …and the read side puts them back on the student.
  const back = normalizeStudent({ id: "stu_2", ...studentProfileFromRow(bag) });
  assert.equal(back.fatherAadhaarNumber, "444455557141", "father Aadhaar round trips");
  assert.equal(back.motherQualification, "Graduate", "mother's education round trips");
  assert.equal(back.fatherOccupation, "Farmer", "father's occupation round trips");
  console.log("  ok  Aadhaar, occupation, education, income round trip through profile");
}

console.log("sisContacts.selftest: all assertions passed");
