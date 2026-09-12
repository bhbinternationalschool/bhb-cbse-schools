/**
 * Every field of a student and a household must survive the trip to the
 * database and back. Not a sample of fields — all of them, mechanically, so a
 * field added tomorrow is checked the day it is added.
 *
 * Why this exists. `studentToRow` silently dropped 52 SisStudent fields until
 * 2026-09-06 (every full Aadhaar number, the parents' occupation and
 * qualification, caste, permanent address, bank, health, the UDISE+ flags) and
 * `householdToRow` dropped all eight geocode fields until 2026-09-11. Nothing
 * errored either time: the value was simply absent from the row, and with
 * SIS_READ_FROM_DB on, the next hydrate replaced the office's copy with what
 * had been stored. Both were found by a person noticing missing data weeks
 * later — the office asking "why does no student show a full Aadhaar number",
 * and a nearest-stop feature that had never once had a pin to read.
 *
 * The test fills every field with a distinct, recognisable value, converts to
 * a row, converts back, and compares. A dropped field fails here and names
 * itself. It cannot check the SQL half (see supabase/tests/sis_push_guarded.
 * test.sql) but it pins everything up to the row.
 *
 * Run: npx tsx src/lib/sisRoundTrip.selftest.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  normalizeHousehold,
  normalizeStudent,
  STUDENT_PROFILE_KEYS,
  type Household,
  type SisStudent,
} from "./sis";
import {
  householdToRow,
  rowToHousehold,
  rowToStudent,
  studentToRow,
  type HouseholdRow,
  type StudentRow,
} from "./sisNormalized.server";

console.log("sisRoundTrip.selftest.ts");

const TENANT = "11111111-1111-1111-1111-111111111111";
const NOW = "2026-09-12T10:00:00.000Z";

/* ── Student ───────────────────────────────────────────────────────────
 * Distinct values per field. Anything that is not free text (dates, enums,
 * the doc bag, curriculum) gets a value its own normalizer accepts, because a
 * value the normalizer rejects would pass this test for the wrong reason.
 */
const student: SisStudent = normalizeStudent({
  id: "stu_rt",
  admissionNo: "BHB-RT-1",
  legacyErpAdmissionNo: "OLD-7",
  systemAdmissionPending: true,
  importedViaLegacyList: true,
  fullName: "Round Trip",
  gender: "F",
  dob: "2016-04-01",
  status: "inactive",
  campusId: "cam_1",
  classId: "cls_1",
  sectionId: "sec_1",
  rollNo: "11",
  academicYearCode: "2026-27",
  studentType: "MID_YEAR",
  feeGroupId: "fg_1",
  joinedOn: "2026-07-01",
  fatherName: "Father Name",
  motherName: "Mother Name",
  fatherMobile: "9000000001",
  motherMobile: "9000000002",
  fatherAadhaarLast4: "1111",
  motherAadhaarLast4: "2222",
  fatherPan: "ABCDE1234F",
  motherPan: "BCDEF2345G",
  guardianRelation: "Mother",
  emergencyName: "Emergency Name",
  emergencyMobile: "9000000003",
  householdId: "hh_rt",
  bloodGroup: "B+",
  religion: "Hindu",
  category: "OBC",
  nationality: "Indian",
  motherTongue: "Bhojpuri",
  placeOfBirth: "Varanasi",
  aadhaarLast4: "3333",
  aadhaarNumber: "111111113333",
  aadhaarVerification: "verified_udise",
  pen: "PEN-1",
  penStatus: "has_pen",
  apaarId: "APAAR-1",
  srn: "SRN-1",
  previousSchool: "Previous School",
  previousTcNo: "TC-OLD-1",
  previousUdise: "09123456789",
  fatherAadhaarNumber: "222222221111",
  motherAadhaarNumber: "333333332222",
  fatherAadhaarVerification: "verified_udise",
  motherAadhaarVerification: "received",
  udiseComplianceRemindedAt: "2026-09-01",
  udiseAadhaarValidationStatus: "Validated",
  udiseMbuStatus: "MBU Pending",
  udisePortalClassHint: "Class 1",
  udiseAgeBelowClassAlert: true,
  udiseInboundTransferPending: true,
  promotionLocked: true,
  promotionLockReason: "Under age for the class",
  caste: "Patel",
  admissionClass: "Nursery",
  admissionFormNo: "FORM-9",
  registrationNo: "REG-9",
  tcNo: "TC-9",
  previousSchoolClass: "UKG",
  previousSchoolYear: "2025-26",
  permanentAddress: "Ayar",
  permanentCity: "Varanasi",
  permanentState: "Uttar Pradesh",
  permanentPincode: "221204",
  transportRoute: "Route A",
  heightCm: "120",
  weightKg: "22",
  isCwsn: true,
  disabilityDetails: "Low vision",
  medicalNotes: "Asthma inhaler",
  fatherOccupation: "Farmer",
  motherOccupation: "Homemaker",
  fatherQualification: "Intermediate",
  motherQualification: "B.A.",
  annualIncome: "120000",
  bankName: "Union Bank of India",
  bankAccountNo: "123456789012",
  bankIfsc: "UBIN0560014",
  secondLanguage: "Hindi",
  thirdLanguage: "Sanskrit",
  hobbies: "Cricket",
  notes: "A note",
  photoUrl: "https://example.test/p.jpg",
  fatherPhotoUrl: "https://example.test/f.jpg",
  motherPhotoUrl: "https://example.test/m.jpg",
  rfidNo: "RFID-9",
  biometricId: "BIO-9",
  loginUsername: "roundtrip",
  loginPassword: "secret",
  tagIds: ["stag_a", "stag_b"],
});

/** Fields that deliberately do not travel on the student row, with the reason. */
const STUDENT_NOT_ON_ROW: Record<string, string> = {
  // Synced by curriculumPersistence to its own table, and rowToStudent
  // returns null so the client's own copy is kept (mergeSisRemoteIntoState).
  curriculum: "own table (curriculumPersistence)",
  // The row's updated_at IS the revision; rowToStudent sets it from there.
  revisionAt: "updated_at",
};

/**
 * Every key of SisStudent, as a value the compiler checks. Object.keys of a
 * normalized student is NOT enough: a field the normalizer itself drops never
 * appears there, so the loop would skip exactly the fields most at risk. That
 * is not hypothetical — Household.photoConsent was dropped by
 * normalizeHousehold and the omission survived until 2026-09-12 because every
 * check started from a normalized object. `Record<keyof Required<T>, true>`
 * fails to compile the day a field is added to the type without being listed.
 */
const STUDENT_FIELDS: Record<keyof Required<SisStudent>, true> = {
  id: true, admissionNo: true, legacyErpAdmissionNo: true,
  systemAdmissionPending: true, importedViaLegacyList: true, fullName: true,
  gender: true, dob: true, status: true, campusId: true, classId: true,
  sectionId: true, rollNo: true, academicYearCode: true, studentType: true,
  feeGroupId: true, joinedOn: true, fatherName: true, motherName: true,
  fatherMobile: true, motherMobile: true, fatherAadhaarLast4: true,
  motherAadhaarLast4: true, fatherPan: true, motherPan: true,
  guardianRelation: true, emergencyName: true, emergencyMobile: true,
  householdId: true, bloodGroup: true, religion: true, category: true,
  nationality: true, motherTongue: true, placeOfBirth: true, aadhaarLast4: true,
  aadhaarNumber: true, aadhaarVerification: true, pen: true, penStatus: true,
  apaarId: true, srn: true, previousSchool: true, previousTcNo: true,
  previousUdise: true, fatherAadhaarNumber: true, motherAadhaarNumber: true,
  fatherAadhaarVerification: true, motherAadhaarVerification: true,
  udiseComplianceRemindedAt: true, udiseAadhaarValidationStatus: true,
  udiseMbuStatus: true, udisePortalClassHint: true, udiseAgeBelowClassAlert: true,
  udiseInboundTransferPending: true, promotionLocked: true,
  promotionLockReason: true, caste: true, admissionClass: true,
  admissionFormNo: true, registrationNo: true, tcNo: true,
  previousSchoolClass: true, previousSchoolYear: true, permanentAddress: true,
  permanentCity: true, permanentState: true, permanentPincode: true,
  transportRoute: true, heightCm: true, weightKg: true, isCwsn: true,
  disabilityDetails: true, medicalNotes: true, fatherOccupation: true,
  motherOccupation: true, fatherQualification: true, motherQualification: true,
  annualIncome: true, bankName: true, bankAccountNo: true, bankIfsc: true,
  secondLanguage: true, thirdLanguage: true, hobbies: true, docs: true,
  notes: true, photoUrl: true, fatherPhotoUrl: true, motherPhotoUrl: true,
  rfidNo: true, biometricId: true, loginUsername: true, loginPassword: true,
  curriculum: true, tagIds: true, revisionAt: true,
};

{
  const row = studentToRow(student, TENANT, NOW) as unknown as StudentRow;
  const back = rowToStudent(row);

  const missing: string[] = [];
  for (const key of Object.keys(STUDENT_FIELDS) as (keyof SisStudent)[]) {
    if (key in STUDENT_NOT_ON_ROW) continue;
    const before = JSON.stringify(student[key]);
    const after = JSON.stringify(back[key]);
    if (before !== after) missing.push(`${key}: sent ${before}, got ${after}`);
  }
  assert.deepEqual(
    missing,
    [],
    `every SisStudent field must survive studentToRow -> rowToStudent:\n  ${missing.join("\n  ")}`,
  );

  // The two exceptions are exceptions, not silent losses.
  assert.equal(back.revisionAt, NOW, "revisionAt comes back as the row version");
  assert.equal(back.curriculum, null, "curriculum is left to its own persistence");

  console.log(
    `  ok  all ${Object.keys(STUDENT_FIELDS).length - Object.keys(STUDENT_NOT_ON_ROW).length} student fields round trip (${STUDENT_PROFILE_KEYS.length} via profile)`,
  );
}

/* ── Household ─────────────────────────────────────────────────────── */
const household: Household = normalizeHousehold({
  id: "hh_rt",
  code: "HH-RT",
  guardianName: "Guardian Name",
  mobile: "9000000001",
  whatsappMobile: "9000000009",
  email: "family@example.test",
  address: "Ayar",
  locality: "Ayar Bazar",
  landmark: "Near the temple",
  city: "Varanasi",
  state: "Uttar Pradesh",
  pincode: "221204",
  altMobile: "9000000004",
  guardianPhotoUrl: "https://example.test/g.jpg",
  photoConsent: "granted",
  preferredLanguage: "hi",
  channelPreference: "whatsapp",
  quietHoursStart: "21:00",
  quietHoursEnd: "07:00",
  geoLat: 25.2138,
  geoLng: 82.9012,
  geoPlaceId: "place_1",
  geoFormattedAddress: "Ayar, Varanasi",
  geoGeocodedAt: "2026-09-12",
  geoSource: "places",
  geoConfidence: "high",
  // normalizeHousehold drops a pin whose fingerprint no longer matches the
  // address, so the key has to be the one it computes for this address.
  geoAddressKey: "",
});

/** Same contract for the household — see STUDENT_FIELDS above. */
const HOUSEHOLD_FIELDS: Record<keyof Required<Household>, true> = {
  id: true, code: true, guardianName: true, mobile: true, whatsappMobile: true,
  email: true, address: true, locality: true, landmark: true, city: true,
  state: true, pincode: true, altMobile: true, guardianPhotoUrl: true,
  preferredLanguage: true, channelPreference: true, photoConsent: true,
  quietHoursStart: true, quietHoursEnd: true, geoLat: true, geoLng: true,
  geoPlaceId: true, geoFormattedAddress: true, geoGeocodedAt: true,
  geoSource: true, geoConfidence: true, geoAddressKey: true, revisionAt: true,
};

const HOUSEHOLD_NOT_ON_ROW: Record<string, string> = {
  revisionAt: "updated_at",
};

{
  // Re-normalize so geoAddressKey holds whatever this address fingerprints to,
  // rather than a value invented here.
  const hh = normalizeHousehold({
    ...household,
    geoAddressKey: undefined,
    geoLat: 25.2138,
    geoLng: 82.9012,
  });
  const row = householdToRow(hh, TENANT, NOW) as unknown as HouseholdRow;
  const back = rowToHousehold({ ...row, updated_at: NOW } as HouseholdRow);

  const missing: string[] = [];
  for (const key of Object.keys(HOUSEHOLD_FIELDS) as (keyof Household)[]) {
    if (key in HOUSEHOLD_NOT_ON_ROW) continue;
    const before = JSON.stringify(hh[key]);
    const after = JSON.stringify(back[key]);
    if (before !== after) missing.push(`${key}: sent ${before}, got ${after}`);
  }
  assert.deepEqual(
    missing,
    [],
    `every Household field must survive householdToRow -> rowToHousehold:\n  ${missing.join("\n  ")}`,
  );
  assert.equal(back.geoLat, 25.2138, "the geocode is on the row");
  assert.equal(back.whatsappMobile, "9000000009", "a separate WhatsApp number is on the row");
  assert.equal(back.photoConsent, "granted", "the family's photo answer is on the row");
  assert.equal(
    back.guardianPhotoUrl,
    "https://example.test/g.jpg",
    "the guardian photograph is on the row",
  );
  console.log(
    `  ok  all ${Object.keys(HOUSEHOLD_FIELDS).length - Object.keys(HOUSEHOLD_NOT_ON_ROW).length} household fields round trip`,
  );
}

/* ── The two writers that edit an existing student ─────────────────────
 *
 * A round trip through the database is not enough on its own: a save path can
 * lose a field before the row is ever built, by constructing the student from
 * only the fields it knows about. Both of these did.
 *
 * The student form edits 88 of the 97 fields and rebuilt the whole record from
 * those, so every save reset the other nine — the parents' photographs, the
 * RFID and biometric ids, the login, the promotion lock and its reason, and
 * revisionAt, whose loss made every form save "unversioned" and therefore
 * unable to conflict with another clerk's edit. The CSV import in update mode
 * carried 77 and reset 20, including the full Aadhaar numbers and all six
 * UDISE+ flags.
 *
 * Both now start from the record as it stands. This is a source check because
 * the fix is structural — there is no value to assert, only the spread that
 * must stay at the top of the literal.
 */
{
  const strip = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const after = (file: string, anchor: string) => {
    const src = fs.readFileSync(file, "utf8");
    const i = src.indexOf(anchor);
    assert.ok(i >= 0, `${anchor} not found in ${file}`);
    return strip(src.slice(i + anchor.length, i + anchor.length + 2000)).trim();
  };

  assert.ok(
    after(
      "src/components/students/StudentForm.tsx",
      "const payload = normalizeStudent({",
    ).startsWith("...(previousStudent ?? {})"),
    "the student form's save must start from the record it is editing, or it resets every field the form does not show",
  );

  assert.ok(
    after(
      "src/lib/studentImport.ts",
      "const patch: Partial<SisStudent> & { id: string } = {",
    ).startsWith("...(existing ?? identitySource ?? {})"),
    "the CSV import must start from the row it is updating, or it resets every field the sheet does not carry",
  );

  console.log("  ok  the form save and the CSV import both start from the stored record");
}

console.log("sisRoundTrip.selftest: all assertions passed");
