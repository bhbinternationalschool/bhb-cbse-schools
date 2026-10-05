/**
 * The portal's student record → the working sheet's canonical row.
 *
 * Run: npx tsx src/lib/udisePortalApi.selftest.ts
 */
import assert from "node:assert/strict";
import { pickPortalFields, portalStudentToUdiseRow, summarisePortalRows } from "@/lib/udisePortalApi";
import { mergeUdiseRecords } from "@/lib/udiseUploadStore";
import { udiseEmptyRow } from "@/lib/udiseStudentDetails";

const portal = {
  studentId: 1,
  studentName: "TEST CHILD",
  gender: 1,
  dob: "21/01/2023",
  classDesc: "Nursery/KG/PP3",
  sectionDesc: "A",
  studentCodeNat: "23263951182",
  studentCodeState: "",
  fatherName: "TEST FATHER",
  motherName: "TEST MOTHER",
  socCatId: 4,
  minorityId: 7,
  isBplYN: 2,
  aayBplYN: 9,
  ewsYN: 1,
  cwsnYN: 2,
  natIndYN: 1,
  ooscYN: 2,
  isRepeater: 2,
  disabilityCerti: 9,
  impairmentPercent: 0,
  formStatus: 2,
  uuid: "********1188",
  nameAsUuid: "TEST CHILD",
  uuidStatus: 1,
  uuidStatusDesc: "Verified From UIDAI against Name, Gender & DOB",
  apaarId: "123412341234",
  apaarIdStatusDesc: "Generated",
  mbuStatusDesc: "MBU Not Required",
  primaryMobile: "9400000011",
  pincode: 221202,
  bloodGroup: 9,
  // Not whitelisted: must never travel.
  lastModifiedBy: "someone",
  inactiveDate: "x",
};

const picked = pickPortalFields(portal);
assert.ok(!("lastModifiedBy" in picked));
const row = portalStudentToUdiseRow(picked);
assert.equal(row.gender, "Male");
assert.equal(row.socialCategory, "OBC");
assert.equal(row.minorityGroup, "7 - NA");
assert.equal(row.bpl, "NO");
assert.equal(row.ews, "YES");
assert.equal(row.aay, "", "9 = not recorded → blank, never NO");
assert.equal(row.disabilityCertificate, "");
assert.equal(row.disabilityPercent, "");
assert.equal(row.entryStatus, "In-Progress", "formStatus 2 shows In-Progress on the portal");
assert.equal(portalStudentToUdiseRow({ ...picked, formStatus: 3 }).entryStatus, "", "unknown status is not 'Completed'");
assert.equal(portalStudentToUdiseRow({ ...picked, formStatus: 0 }).entryStatus, "Not Started");
assert.equal(row.apaarId, "123412341234", "the API's full APAAR is kept");
assert.equal(row.pincode, "221202");
assert.equal(row.bloodGroup, "Under Investigation - Result will be updated soon");
assert.equal(row.aadhaarValidation, "Verified From UIDAI against Name, Gender & DOB");
assert.equal(portalStudentToUdiseRow({ ...picked, uuidStatus: 0, uuidStatusDesc: "AADHAAR not verified" }).aadhaarValidation, "Not Defined");
// A full Aadhaar never survives this channel.
assert.equal(portalStudentToUdiseRow({ ...picked, uuid: "234123412346" }).aadhaarRaw, "********2346");
assert.equal(portalStudentToUdiseRow({ ...picked, apaarId: "" }).apaarId, "");

// Merging into a sheet that holds the same child from an export: one record,
// and the full APAAR replaces the export's masked one.
const fromExport = { ...udiseEmptyRow(), fullName: "TEST CHILD", pen: "23263951182", apaarId: "********1234", dob: "21/01/2023", aay: "NO" };
const m = mergeUdiseRecords({ existing: [{ key: "pen:23263951182", ord: 0, fields: fromExport }], incoming: [row] });
assert.equal(m.records.length, 1);
assert.equal(m.records[0]!.fields.apaarId, "123412341234");
assert.equal(m.records[0]!.fields.aay, "NO", "a blank never erases what an export said");

const sum = summarisePortalRows([row, portalStudentToUdiseRow({ ...picked, studentCodeNat: "", apaarId: "", uuidStatus: 2, uuidStatusDesc: "Verification Failed From UIDAI" })]);
assert.deepEqual([sum.received, sum.withPen, sum.withApaar, sum.aadhaarVerified, sum.aadhaarFailed], [2, 1, 1, 1, 1]);

console.log("udisePortalApi selftest: ok");
