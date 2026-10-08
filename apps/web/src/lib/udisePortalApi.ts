/**
 * What the UDISE+ Student module (sdms.udiseplus.gov.in) hands its own
 * screens, read by the UDISE robot extension in the office's logged-in tab,
 * and turned into the same canonical record (`UdiseStudentRow`) that an
 * uploaded portal export becomes. From there it is the working sheet's
 * ordinary merge → match → review → Apply; the robot only saves the office
 * the download-and-upload.
 *
 * Source: GET /p1/api/cy/students/all/{schoolId} — every child on the
 * current year, one object each (studied 2026-10-06 against the school's own
 * login). It is richer than either Excel export: the APAAR ID arrives in
 * full where both exports mask it to the last four digits. The Aadhaar
 * arrives masked (********1234) and is never anything else here.
 *
 * Codes, as the portal uses them (checked against its own dashboard: the
 * nine children with isRepeater = 1 are its "Repeaters: 9"):
 *   yes/no fields  1 = YES, 2 = NO, 9 = not recorded → blank
 *   gender         1 Male, 2 Female, 3 Transgender
 *   socCatId       1 GENERAL, 2 SC, 3 ST, 4 OBC, 0 = not recorded
 *   formStatus     0 Not Started; 1 and 2 both show "In-Progress" on the
 *                  portal's list. Any other value is left blank rather than
 *                  guessed as "Completed".
 *
 * Unknown must not become fact: a code this file does not know becomes "",
 * and the merge never lets a blank erase what an export already said.
 */

import { udiseEmptyRow, type UdiseStudentRow } from "@/lib/udiseStudentDetails";

/** The fields the extension sends. Nothing else leaves the portal tab. */
export const UDISE_PORTAL_FIELDS = [
  "studentId",
  "studentName",
  "gender",
  "dob",
  "classId",
  "classDesc",
  "sectionDesc",
  "studentCodeNat",
  "studentCodeState",
  "fatherName",
  "motherName",
  "guardianName",
  "socCatId",
  "minorityId",
  "isBplYN",
  "aayBplYN",
  "ewsYN",
  "cwsnYN",
  "natIndYN",
  "ooscYN",
  "isRepeater",
  "disabilityCerti",
  "impairmentPercent",
  "formStatus",
  "uuid",
  "nameAsUuid",
  "uuidStatus",
  "uuidStatusDesc",
  "apaarId",
  "apaarIdStatusDesc",
  "mbuStatusDesc",
  "primaryMobile",
  "secondaryMobile",
  "email",
  "address",
  "pincode",
  "motherTongueDesc",
  "bloodGroup",
  "admnNumber",
] as const;

export type UdisePortalStudent = Partial<Record<(typeof UDISE_PORTAL_FIELDS)[number], unknown>>;

function text(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function yesNo(v: unknown): string {
  const n = num(v);
  if (n === 1) return "YES";
  if (n === 2) return "NO";
  return "";
}

const GENDER: Record<number, string> = { 1: "Male", 2: "Female", 3: "Transgender" };
const SOCIAL: Record<number, string> = { 1: "GENERAL", 2: "SC", 3: "ST", 4: "OBC" };
const MINORITY: Record<number, string> = {
  1: "1 - Muslim",
  2: "2 - Christian",
  3: "3 - Sikh",
  4: "4 - Buddhist",
  5: "5 - Parsi",
  6: "6 - Jain",
  7: "7 - NA",
};
const BLOOD: Record<number, string> = {
  1: "A+",
  2: "A-",
  3: "B+",
  4: "B-",
  5: "O+",
  6: "O-",
  7: "AB+",
  8: "AB-",
  9: "Under Investigation - Result will be updated soon",
};

function entryStatus(v: unknown): string {
  const n = num(v);
  if (n === 0) return "Not Started";
  if (n === 1 || n === 2) return "In-Progress";
  return "";
}

/** Only digits survive into an id field; a masked Aadhaar keeps its mask. */
function maskedAadhaar(v: unknown): string {
  const s = text(v);
  if (!s) return "";
  // Never accept a full number from this channel, whatever the portal does
  // tomorrow: keep the last four behind the portal's own mask.
  const digits = s.replace(/\D/g, "");
  if (digits.length < 4) return "";
  return `********${digits.slice(-4)}`;
}

export function portalStudentToUdiseRow(p: UdisePortalStudent): UdiseStudentRow {
  const row = udiseEmptyRow();
  row.fullName = text(p.studentName);
  row.gender = GENDER[num(p.gender) ?? -1] ?? "";
  row.dob = text(p.dob);
  row.classHint = text(p.classDesc);
  row.sectionHint = text(p.sectionDesc);
  row.pen = text(p.studentCodeNat).replace(/\D/g, "");
  row.stateCode = text(p.studentCodeState);
  row.fatherName = text(p.fatherName);
  row.motherName = text(p.motherName);
  row.guardianName = text(p.guardianName);
  row.socialCategory = SOCIAL[num(p.socCatId) ?? -1] ?? "";
  row.minorityGroup = MINORITY[num(p.minorityId) ?? -1] ?? "";
  row.bpl = yesNo(p.isBplYN);
  row.aay = yesNo(p.aayBplYN);
  row.ews = yesNo(p.ewsYN);
  row.cwsn = yesNo(p.cwsnYN);
  row.isIndianNational = yesNo(p.natIndYN);
  row.outOfSchoolChild = yesNo(p.ooscYN);
  row.isRepeater = yesNo(p.isRepeater);
  row.disabilityCertificate = yesNo(p.disabilityCerti);
  {
    const pct = num(p.impairmentPercent);
    row.disabilityPercent = pct && pct > 0 ? String(pct) : "";
  }
  row.entryStatus = entryStatus(p.formStatus);
  row.aadhaarRaw = maskedAadhaar(p.uuid);
  row.aadhaarName = text(p.nameAsUuid);
  // uuidStatus 0 is "never validated"; the export calls that "Not Defined".
  row.aadhaarValidation = num(p.uuidStatus) === 0 ? "Not Defined" : text(p.uuidStatusDesc);
  {
    const apaar = text(p.apaarId).replace(/\D/g, "");
    row.apaarId = apaar.length === 12 ? apaar : "";
  }
  row.apaarStatus = text(p.apaarIdStatusDesc);
  row.mbuStatus = text(p.mbuStatusDesc);
  row.mobile = text(p.primaryMobile).replace(/\D/g, "");
  row.altMobile = text(p.secondaryMobile).replace(/\D/g, "");
  row.email = text(p.email);
  row.address = text(p.address);
  {
    const pin = text(p.pincode).replace(/\D/g, "");
    row.pincode = pin.length === 6 ? pin : "";
  }
  row.motherTongue = text(p.motherTongueDesc);
  row.bloodGroup = BLOOD[num(p.bloodGroup) ?? -1] ?? "";
  row.admissionNo = text(p.admnNumber);
  return row;
}

/** Keep only the whitelisted fields of each record (the server re-checks). */
export function pickPortalFields(raw: Record<string, unknown>): UdisePortalStudent {
  const out: UdisePortalStudent = {};
  for (const k of UDISE_PORTAL_FIELDS) if (k in raw) out[k] = raw[k];
  return out;
}

export type UdisePortalSyncSummary = {
  received: number;
  withPen: number;
  withApaar: number;
  aadhaarVerified: number;
  aadhaarFailed: number;
  entryNotStarted: number;
  entryInProgress: number;
};

export function summarisePortalRows(rows: UdiseStudentRow[]): UdisePortalSyncSummary {
  return {
    received: rows.length,
    withPen: rows.filter((r) => !!r.pen).length,
    withApaar: rows.filter((r) => !!r.apaarId).length,
    aadhaarVerified: rows.filter((r) => /^verified/i.test(r.aadhaarValidation) && !/fail/i.test(r.aadhaarValidation)).length,
    aadhaarFailed: rows.filter((r) => /fail/i.test(r.aadhaarValidation)).length,
    entryNotStarted: rows.filter((r) => r.entryStatus === "Not Started").length,
    entryInProgress: rows.filter((r) => r.entryStatus === "In-Progress").length,
  };
}
