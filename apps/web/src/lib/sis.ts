/**
 * SIS (Students) — Phase 1 go-live roster.
 * Source of truth for enrollments; syncs a slim view into Masters for fee demos.
 */

import { activeSessionCode } from "@/lib/sessionWriteGuard";
import { assertModulePermission } from "@/lib/rbacGuard";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";
import {
  DEFAULT_AY,
  DEMO_STUDENT_CLASS_BY_NAME,
  currentAcademicYearCode,
  ensureStudentClassLinks,
  loadMasters,
  saveMasters,
  type DemoStudent,
  type FeeStudentType,
  type MastersState,
} from "@/lib/masters";
import {
  suggestFromSeriesCode,
} from "@/lib/numberSeries";
import {
  getSchoolMirrorSync,
  scheduleClientSchoolMirrorSync,
  setMirrorSlice,
} from "@/lib/schoolDataMirror";
import { deskSkipBlobPushClient } from "@/lib/deskCutover";
import {
  normalizeCurriculum,
  normalizeCurriculumRequest,
  type CurriculumRequest,
  type StudentCurriculum,
} from "@/lib/studentCurriculum";

export type { CurriculumRequest, StudentCurriculum } from "@/lib/studentCurriculum";

export type StudentStatus = "active" | "inactive";

export type PenStatus =
  | "has_pen"
  | "to_register"
  | "pending_portal"
  | "linked"
  | "";

/** Student / parent Aadhaar status for UDISE+ compliance */
export type AadhaarVerificationStatus =
  | ""
  | "missing"
  | "received"
  | "verified_udise";

export type StudentCategory = "GEN" | "OBC" | "SC" | "ST" | "EWS" | "";

export type DocStatus =
  | "missing"
  | "received"
  | "pending"
  | "verified"
  | "rejected";

export type StudentDocKey =
  | "birthCert"
  | "photo"
  | "aadhaar"
  | "addressProof"
  | "tc"
  | "casteCert"
  | "incomeCert";

/**
 * Per-doc vault entry. fileUrl is an app-internal proxy URL
 * (/api/documents/{driveFileId}) once stored in Google Drive — see
 * docs/GOOGLE_DRIVE_DOCUMENTS_PLAN.md. Older records may still hold a
 * data: URL from before that cutover.
 */
export type StudentDocFile = {
  status: DocStatus;
  fileName: string;
  mimeType: string;
  size: number;
  fileUrl: string;
  /** Set once the file is in Drive; empty for legacy/unmigrated records. */
  driveFileId?: string;
  uploadedAt: string;
  /** Parent/guardian who submitted for verification */
  submittedBy?: string;
  submittedAt?: string;
  /** Class teacher / office / principal decision */
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
};

export type StudentDocs = Record<StudentDocKey, StudentDocFile>;

export const DOC_ACCEPT =
  "image/jpeg,image/png,image/webp,application/pdf";
/** Soft cap for browser demo storage (data URLs). */
export const DOC_MAX_BYTES = 1_200_000;

export type Household = {
  id: string;
  code: string;
  guardianName: string;
  mobile: string;
  /**
   * WhatsApp number for all school communications (fee reminders, receipts, notices).
   * Defaults to guardian mobile when empty / legacy rows.
   */
  whatsappMobile: string;
  email: string;
  address: string;
  /** Area / mohalla — helps map to transport stops later */
  locality: string;
  /** Nearby landmark for pickup guidance */
  landmark: string;
  city: string;
  state: string;
  pincode: string;
  altMobile: string;
  /** Guardian / parent photo (data URL or https) */
  guardianPhotoUrl: string;
  /** Google Maps geocode — shared by siblings on this household */
  geoLat?: number;
  geoLng?: number;
  geoPlaceId?: string;
  geoFormattedAddress?: string;
  geoGeocodedAt?: string;
  geoSource?: "geocode" | "places" | "gps" | "manual";
  geoConfidence?: "high" | "low" | "failed";
  /** Fingerprint of address fields when geo was set */
  geoAddressKey?: string;
  /** Optimistic-locking token — see SisStudent.revisionAt. Server-owned. */
  revisionAt: string;
};

export type SisStudent = {
  id: string;
  admissionNo: string;
  /**
   * Old ERP admission number — set only when imported from a legacy list.
   * Manual entry students leave this blank; use `admissionNo` as the system id.
   */
  legacyErpAdmissionNo: string;
  /** Import mapped legacy ERP no → system no still awaiting office verification. */
  systemAdmissionPending: boolean;
  /** True when row came from legacy ERP CSV import (not manual add). */
  importedViaLegacyList: boolean;
  fullName: string;
  gender: "M" | "F" | "O" | "";
  dob: string;
  status: StudentStatus;
  campusId: string;
  classId: string;
  sectionId: string;
  rollNo: string;
  academicYearCode: string;
  studentType: FeeStudentType;
  feeGroupId: string | null;
  /** Date student joined this session (YYYY-MM-DD) — mid-year billing uses Masters policy */
  joinedOn: string;
  fatherName: string;
  motherName: string;
  fatherMobile: string;
  motherMobile: string;
  /** Last 4 only — same rule as student Aadhaar */
  fatherAadhaarLast4: string;
  motherAadhaarLast4: string;
  fatherPan: string;
  motherPan: string;
  guardianRelation: string;
  emergencyName: string;
  emergencyMobile: string;
  householdId: string;
  /** Identity extras */
  bloodGroup: string;
  religion: string;
  category: StudentCategory;
  nationality: string;
  motherTongue: string;
  placeOfBirth: string;
  aadhaarLast4: string;
  /**
   * Full 12-digit Aadhaar while not yet verified on UDISE+.
   * After `aadhaarVerification === "verified_udise"`, UI shows last 4 only.
   */
  aadhaarNumber: string;
  /** UDISE+ Aadhaar validation */
  aadhaarVerification: AadhaarVerificationStatus;
  /** Compliance IDs */
  pen: string;
  penStatus: PenStatus;
  apaarId: string;
  srn: string;
  previousSchool: string;
  previousTcNo: string;
  previousUdise: string;
  /** Father / mother full Aadhaar (needed for APAAR) — masked after verified */
  fatherAadhaarNumber: string;
  motherAadhaarNumber: string;
  fatherAadhaarVerification: AadhaarVerificationStatus;
  motherAadhaarVerification: AadhaarVerificationStatus;
  /** Last UDISE compliance WhatsApp reminder (ISO date) */
  udiseComplianceRemindedAt: string;
  /** Last sync from UDISE+ Students_Details */
  udiseAadhaarValidationStatus: string;
  udiseMbuStatus: string;
  /** Portal class label (informational — never overwrites SIS class) */
  udisePortalClassHint: string;
  /**
   * MBU Pending (Age …) from portal — age below / biometric update pending
   * for the class as per govt rules.
   */
  udiseAgeBelowClassAlert: boolean;
  /**
   * Office entered PEN at admission (transfer) — student not yet on our UDISE+
   * list. Action: import from Drop Box or ask previous school to release.
   * Cleared when Students_Details re-import matches this student.
   */
  udiseInboundTransferPending: boolean;
  /**
   * Hold this student back from next-session promotion (e.g. under-age for the
   * class per UDISE MBU rule — repeat the same class next session). Blocks
   * upward class moves until unlocked.
   */
  promotionLocked: boolean;
  /** Why promotion is locked (shown as a clear suggestion in the UI). */
  promotionLockReason: string;
  /** Extended profile fields (legacy ERP / full-register parity) */
  caste: string;
  /** Class at first admission (may differ from current class) */
  admissionClass: string;
  admissionFormNo: string;
  registrationNo: string;
  /** TC number issued by this school when the student leaves */
  tcNo: string;
  previousSchoolClass: string;
  previousSchoolYear: string;
  /** Permanent / native address — correspondence address stays on Household */
  permanentAddress: string;
  permanentCity: string;
  permanentState: string;
  permanentPincode: string;
  /** Transport route name (informational; Transport module owns routing) */
  transportRoute: string;
  /** Health record */
  heightCm: string;
  weightKg: string;
  /** Children With Special Needs (a.k.a. divyang / handicapped) */
  isCwsn: boolean;
  disabilityDetails: string;
  medicalNotes: string;
  /** Parent socio-economic — needed for EWS / RTE and DBT */
  fatherOccupation: string;
  motherOccupation: string;
  fatherQualification: string;
  motherQualification: string;
  /** Combined family income per year (₹) */
  annualIncome: string;
  /** Student bank account for scholarships / DBT */
  bankName: string;
  bankAccountNo: string;
  bankIfsc: string;
  /** Elective languages (CBSE) and interests */
  secondLanguage: string;
  thirdLanguage: string;
  hobbies: string;
  docs: StudentDocs;
  notes: string;
  /** Optional photo (https URL or data:image for demo upload) */
  photoUrl: string;
  /** Father / mother photos for ID cards & bulk parent image upload */
  fatherPhotoUrl: string;
  motherPhotoUrl: string;
  /** Attendance / gate RFID card number */
  rfidNo: string;
  /** Biometric device enrolment id */
  biometricId: string;
  /** Portal login username (defaults to admission no when empty) */
  loginUsername: string;
  /** Portal login password (office-set; demo plain storage) */
  loginPassword: string;
  /** Confirmed subjects/stream for the academic year */
  curriculum: StudentCurriculum | null;
  /** Assigned student tag ids (shown before name across the ERP) */
  tagIds: string[];
  /**
   * Optimistic-locking token — the `updated_at` this record carried when it
   * was last read from the database. Server-owned: never set or edited by
   * feature code. On push the server compares it against the stored value
   * and refuses the write if another user has saved in the meantime, which
   * is what stops two staff overwriting each other. Empty means "no known
   * base version" (a record created locally and not yet synced).
   */
  revisionAt: string;
};

/** School-defined labels (RTE cohort, sports, staff ward, etc.) */
export type StudentTag = {
  id: string;
  code: string;
  name: string;
  color: string;
  isActive: boolean;
  createdAt: string;
};

/** Post-admission move to another class / section / student type */
export type ClassUpgradeRecord = {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  fromClassId: string;
  fromSectionId: string;
  toClassId: string;
  toSectionId: string;
  fromFeeGroupId: string | null;
  toFeeGroupId: string | null;
  /** Fee student type before (NEW / PROMOTE / …) */
  fromStudentType: string;
  /** Fee student type after */
  toStudentType: string;
  reason: string;
  effectiveOn: string;
  createdAt: string;
  createdBy: string;
};

export type SisState = {
  version: 1;
  households: Household[];
  students: SisStudent[];
  curriculumRequests: CurriculumRequest[];
  tags: StudentTag[];
  /** Post-admission class upgrades (history) */
  classUpgrades: ClassUpgradeRecord[];
};

export const DOC_LABELS: { key: StudentDocKey; label: string }[] = [
  { key: "birthCert", label: "Birth certificate" },
  { key: "photo", label: "Passport photo" },
  { key: "aadhaar", label: "Aadhaar (masked copy)" },
  { key: "addressProof", label: "Address proof" },
  { key: "tc", label: "Transfer certificate (if any)" },
  { key: "casteCert", label: "Caste / category certificate" },
  { key: "incomeCert", label: "Income certificate (EWS/RTE)" },
];

export const PEN_STATUSES: { value: PenStatus; label: string }[] = [
  { value: "", label: "—" },
  { value: "has_pen", label: "Has PEN" },
  { value: "to_register", label: "To register (fresh UDISE)" },
  { value: "pending_portal", label: "Pending on portal" },
  { value: "linked", label: "Linked" },
];

export const STUDENT_CATEGORIES: { value: StudentCategory; label: string }[] = [
  { value: "", label: "—" },
  { value: "GEN", label: "General" },
  { value: "OBC", label: "OBC" },
  { value: "SC", label: "SC" },
  { value: "ST", label: "ST" },
  { value: "EWS", label: "EWS" },
];

export const BLOOD_GROUPS = [
  "",
  "A+",
  "A-",
  "B+",
  "B-",
  "AB+",
  "AB-",
  "O+",
  "O-",
];

export function emptyDocFile(status: DocStatus = "missing"): StudentDocFile {
  return {
    status,
    fileName: "",
    mimeType: "",
    size: 0,
    fileUrl: "",
    driveFileId: "",
    uploadedAt: "",
    submittedBy: "",
    submittedAt: "",
    reviewedBy: "",
    reviewedAt: "",
    reviewNote: "",
  };
}

export function docStatusLabel(status: DocStatus): string {
  switch (status) {
    case "pending":
      return "Pending verification";
    case "verified":
      return "Verified";
    case "rejected":
      return "Rejected — re-upload";
    case "received":
      return "Received (office)";
    default:
      return "Missing";
  }
}

export function emptyStudentDocs(): StudentDocs {
  return {
    birthCert: emptyDocFile(),
    photo: emptyDocFile(),
    aadhaar: emptyDocFile(),
    addressProof: emptyDocFile(),
    tc: emptyDocFile(),
    casteCert: emptyDocFile(),
    incomeCert: emptyDocFile(),
  };
}

function parseDocStatus(raw: unknown): DocStatus {
  if (
    raw === "received" ||
    raw === "verified" ||
    raw === "missing" ||
    raw === "pending" ||
    raw === "rejected"
  ) {
    return raw;
  }
  return "missing";
}

export function normalizeDocFile(raw: unknown): StudentDocFile {
  if (typeof raw === "string") {
    return emptyDocFile(parseDocStatus(raw));
  }
  if (!raw || typeof raw !== "object") return emptyDocFile();
  const o = raw as Partial<StudentDocFile> & { status?: string };
  const status = parseDocStatus(o.status);
  const fileUrl = typeof o.fileUrl === "string" ? o.fileUrl : "";
  return {
    status: fileUrl && status === "missing" ? "received" : status,
    fileName: typeof o.fileName === "string" ? o.fileName : "",
    mimeType: typeof o.mimeType === "string" ? o.mimeType : "",
    size: typeof o.size === "number" ? o.size : 0,
    fileUrl,
    driveFileId: typeof o.driveFileId === "string" ? o.driveFileId : "",
    uploadedAt: typeof o.uploadedAt === "string" ? o.uploadedAt : "",
    submittedBy: typeof o.submittedBy === "string" ? o.submittedBy : "",
    submittedAt: typeof o.submittedAt === "string" ? o.submittedAt : "",
    reviewedBy: typeof o.reviewedBy === "string" ? o.reviewedBy : "",
    reviewedAt: typeof o.reviewedAt === "string" ? o.reviewedAt : "",
    reviewNote: typeof o.reviewNote === "string" ? o.reviewNote : "",
  };
}

export function normalizeStudentDocs(
  raw: Partial<Record<StudentDocKey, unknown>> | undefined,
): StudentDocs {
  const base = emptyStudentDocs();
  if (!raw) return base;
  for (const { key } of DOC_LABELS) {
    if (raw[key] !== undefined) base[key] = normalizeDocFile(raw[key]);
  }
  return base;
}

export function docHasFile(doc: StudentDocFile): boolean {
  return !!doc.fileUrl;
}

export function countDocsWithFiles(docs: StudentDocs): number {
  return DOC_LABELS.filter((d) => docHasFile(docs[d.key])).length;
}

/** Keep passport photo field and docs.photo in sync. */
export function syncPhotoDoc(
  docs: StudentDocs,
  photoUrl: string,
): StudentDocs {
  const photo = { ...docs.photo };
  if (photoUrl) {
    photo.fileUrl = photoUrl;
    if (!photo.fileName) photo.fileName = "passport-photo.jpg";
    if (!photo.mimeType) photo.mimeType = "image/jpeg";
    if (!photo.uploadedAt) photo.uploadedAt = new Date().toISOString();
    if (photo.status === "missing") photo.status = "received";
  } else if (photo.mimeType.startsWith("image/") || !photo.mimeType) {
    // Clearing profile photo clears the photo doc file unless it's a PDF (unlikely).
    photo.fileUrl = "";
    photo.fileName = "";
    photo.mimeType = "";
    photo.size = 0;
    photo.uploadedAt = "";
    if (photo.status !== "verified") photo.status = "missing";
  }
  return { ...docs, photo };
}

export function emptyHouseholdFields(): Pick<
  Household,
  "locality" | "landmark" | "city" | "state" | "pincode" | "altMobile"
> {
  return {
    locality: "",
    landmark: "",
    city: "Varanasi",
    state: "Uttar Pradesh",
    pincode: "",
    altMobile: "",
  };
}

/** Indian PAN: ABCDE1234F */
export function normalizePan(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10);
}

/** Keep 12-digit Aadhaar; if only last4 known, leave full empty. */
export function normalizeAadhaarFull(value: string, last4Fallback = ""): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 12) return digits;
  if (digits.length > 12) return digits.slice(0, 12);
  return "";
}

export function normalizeAadhaarVerification(
  raw: unknown,
  hasAnyAadhaar?: string,
): AadhaarVerificationStatus {
  const v = String(raw || "");
  if (
    v === "missing" ||
    v === "received" ||
    v === "verified_udise"
  ) {
    return v;
  }
  if (hasAnyAadhaar && String(hasAnyAadhaar).replace(/\D/g, "").length >= 4) {
    return "received";
  }
  return "missing";
}

/**
 * Display Aadhaar: full 12 digits until UDISE+ verified; then ********XXXX only.
 */
export function displayAadhaar(input: {
  number?: string;
  last4?: string;
  verification?: AadhaarVerificationStatus;
}): string {
  const last4 =
    (input.last4 || "").replace(/\D/g, "").slice(-4) ||
    (input.number || "").replace(/\D/g, "").slice(-4);
  if (input.verification === "verified_udise") {
    return last4 ? `********${last4}` : "—";
  }
  const full = (input.number || "").replace(/\D/g, "");
  if (full.length === 12) return full.replace(/(\d{4})(?=\d)/g, "$1 ");
  if (last4) return `********${last4}`;
  return "—";
}

export function hasStoredAadhaar(input: {
  number?: string;
  last4?: string;
}): boolean {
  const full = (input.number || "").replace(/\D/g, "");
  const last4 = (input.last4 || "").replace(/\D/g, "");
  return full.length === 12 || last4.length === 4;
}

/** After UDISE verify: keep last4, clear full number from display store. */
export function applyAadhaarUdiseVerified(input: {
  number?: string;
  last4?: string;
}): {
  aadhaarNumber: string;
  aadhaarLast4: string;
  aadhaarVerification: AadhaarVerificationStatus;
} {
  const last4 =
    (input.last4 || "").replace(/\D/g, "").slice(-4) ||
    (input.number || "").replace(/\D/g, "").slice(-4);
  return {
    aadhaarNumber: "",
    aadhaarLast4: last4,
    aadhaarVerification: "verified_udise",
  };
}

export function isValidPan(value: string): boolean {
  if (!value) return true;
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(value);
}

/** Normalize legacy / partial student rows after load. */
export function normalizeStudent(s: Partial<SisStudent> & { id: string }): SisStudent {
  let docs = normalizeStudentDocs(s.docs as Partial<Record<StudentDocKey, unknown>>);
  const photoUrl = s.photoUrl ?? "";
  if (photoUrl && !docs.photo.fileUrl) {
    docs = syncPhotoDoc(docs, photoUrl);
  }
  return {
    id: s.id,
    admissionNo: s.admissionNo ?? "",
    legacyErpAdmissionNo: s.legacyErpAdmissionNo ?? "",
    systemAdmissionPending: !!s.systemAdmissionPending,
    importedViaLegacyList: !!s.importedViaLegacyList,
    fullName: cleanRepeatedName(s.fullName ?? ""),
    gender: s.gender ?? "",
    dob: s.dob ?? "",
    status: s.status === "inactive" ? "inactive" : "active",
    campusId: s.campusId ?? "",
    classId: s.classId ?? "",
    sectionId: s.sectionId ?? "",
    rollNo: s.rollNo ?? "",
    academicYearCode: s.academicYearCode ?? DEFAULT_AY,
    studentType: s.studentType ?? "NEW",
    feeGroupId: s.feeGroupId ?? null,
    joinedOn: s.joinedOn ?? "",
    fatherName: cleanRepeatedName(s.fatherName ?? ""),
    motherName: cleanRepeatedName(s.motherName ?? ""),
    fatherMobile: normalizeMobile(s.fatherMobile ?? ""),
    motherMobile: normalizeMobile(s.motherMobile ?? ""),
    fatherAadhaarLast4: (() => {
      const l4 = (s.fatherAadhaarLast4 ?? "").replace(/\D/g, "").slice(0, 4);
      const full = normalizeAadhaarFull(s.fatherAadhaarNumber ?? "", l4);
      return l4 || full.slice(-4);
    })(),
    motherAadhaarLast4: (() => {
      const l4 = (s.motherAadhaarLast4 ?? "").replace(/\D/g, "").slice(0, 4);
      const full = normalizeAadhaarFull(s.motherAadhaarNumber ?? "", l4);
      return l4 || full.slice(-4);
    })(),
    fatherAadhaarNumber:
      String(s.fatherAadhaarVerification) === "verified_udise"
        ? ""
        : normalizeAadhaarFull(
            s.fatherAadhaarNumber ?? "",
            (s.fatherAadhaarLast4 ?? "").replace(/\D/g, "").slice(0, 4),
          ),
    motherAadhaarNumber:
      String(s.motherAadhaarVerification) === "verified_udise"
        ? ""
        : normalizeAadhaarFull(
            s.motherAadhaarNumber ?? "",
            (s.motherAadhaarLast4 ?? "").replace(/\D/g, "").slice(0, 4),
          ),
    fatherAadhaarVerification: normalizeAadhaarVerification(
      s.fatherAadhaarVerification,
      s.fatherAadhaarNumber || s.fatherAadhaarLast4,
    ),
    motherAadhaarVerification: normalizeAadhaarVerification(
      s.motherAadhaarVerification,
      s.motherAadhaarNumber || s.motherAadhaarLast4,
    ),
    fatherPan: normalizePan(s.fatherPan ?? ""),
    motherPan: normalizePan(s.motherPan ?? ""),
    guardianRelation: s.guardianRelation ?? "Father",
    emergencyName: s.emergencyName ?? "",
    emergencyMobile: normalizeMobile(s.emergencyMobile ?? ""),
    householdId: s.householdId ?? "",
    bloodGroup: s.bloodGroup ?? "",
    religion: s.religion ?? "",
    category: s.category ?? "",
    nationality: s.nationality ?? "Indian",
    motherTongue: s.motherTongue ?? "",
    placeOfBirth: s.placeOfBirth ?? "",
    aadhaarLast4: (() => {
      const l4 = (s.aadhaarLast4 ?? "").replace(/\D/g, "").slice(0, 4);
      const full = normalizeAadhaarFull(s.aadhaarNumber ?? "", l4);
      return l4 || full.slice(-4);
    })(),
    aadhaarNumber:
      String(s.aadhaarVerification) === "verified_udise"
        ? ""
        : normalizeAadhaarFull(
            s.aadhaarNumber ?? "",
            (s.aadhaarLast4 ?? "").replace(/\D/g, "").slice(0, 4),
          ),
    aadhaarVerification: normalizeAadhaarVerification(
      s.aadhaarVerification,
      s.aadhaarNumber || s.aadhaarLast4,
    ),
    pen: s.pen ?? "",
    penStatus: s.penStatus ?? (s.pen ? "has_pen" : ""),
    apaarId: s.apaarId ?? "",
    srn: s.srn ?? "",
    previousSchool: s.previousSchool ?? "",
    previousTcNo: s.previousTcNo ?? "",
    previousUdise: s.previousUdise ?? "",
    udiseComplianceRemindedAt: s.udiseComplianceRemindedAt ?? "",
    udiseAadhaarValidationStatus: s.udiseAadhaarValidationStatus ?? "",
    udiseMbuStatus: s.udiseMbuStatus ?? "",
    udisePortalClassHint: s.udisePortalClassHint ?? "",
    udiseAgeBelowClassAlert: !!s.udiseAgeBelowClassAlert,
    udiseInboundTransferPending: !!s.udiseInboundTransferPending,
    promotionLocked: !!s.promotionLocked,
    promotionLockReason: String(s.promotionLockReason ?? "").trim(),
    caste: s.caste ?? "",
    admissionClass: s.admissionClass ?? "",
    admissionFormNo: s.admissionFormNo ?? "",
    registrationNo: s.registrationNo ?? "",
    tcNo: s.tcNo ?? "",
    previousSchoolClass: s.previousSchoolClass ?? "",
    previousSchoolYear: s.previousSchoolYear ?? "",
    permanentAddress: s.permanentAddress ?? "",
    permanentCity: s.permanentCity ?? "",
    permanentState: s.permanentState ?? "",
    permanentPincode: (s.permanentPincode ?? "").replace(/\D/g, "").slice(0, 6),
    transportRoute: s.transportRoute ?? "",
    heightCm: s.heightCm ?? "",
    weightKg: s.weightKg ?? "",
    isCwsn: !!s.isCwsn,
    disabilityDetails: s.disabilityDetails ?? "",
    medicalNotes: s.medicalNotes ?? "",
    fatherOccupation: s.fatherOccupation ?? "",
    motherOccupation: s.motherOccupation ?? "",
    fatherQualification: s.fatherQualification ?? "",
    motherQualification: s.motherQualification ?? "",
    annualIncome: s.annualIncome ?? "",
    bankName: s.bankName ?? "",
    bankAccountNo: s.bankAccountNo ?? "",
    bankIfsc: (s.bankIfsc ?? "").toUpperCase().trim(),
    secondLanguage: s.secondLanguage ?? "",
    thirdLanguage: s.thirdLanguage ?? "",
    hobbies: s.hobbies ?? "",
    docs,
    notes: s.notes ?? "",
    photoUrl: photoUrl || docs.photo.fileUrl || "",
    fatherPhotoUrl: typeof s.fatherPhotoUrl === "string" ? s.fatherPhotoUrl : "",
    motherPhotoUrl: typeof s.motherPhotoUrl === "string" ? s.motherPhotoUrl : "",
    rfidNo: (s.rfidNo ?? "").trim(),
    biometricId: (s.biometricId ?? "").trim(),
    loginUsername: (s.loginUsername ?? "").trim(),
    loginPassword: typeof s.loginPassword === "string" ? s.loginPassword : "",
    curriculum: normalizeCurriculum(
      s.curriculum,
      s.academicYearCode ?? DEFAULT_AY,
    ),
    tagIds: Array.isArray(s.tagIds)
      ? [...new Set(s.tagIds.filter((id): id is string => typeof id === "string"))]
      : [],
    revisionAt: typeof s.revisionAt === "string" ? s.revisionAt : "",
  };
}

export function normalizeStudentTag(
  t: Partial<StudentTag> & { id?: string },
): StudentTag {
  return {
    id: t.id || `stag_${Math.random().toString(36).slice(2, 10)}`,
    code: (t.code || t.name || "TAG")
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, "_")
      .slice(0, 12) || "TAG",
    name: t.name || t.code || "Tag",
    color: t.color || "#1565c0",
    isActive: t.isActive !== false,
    createdAt: t.createdAt || new Date().toISOString(),
  };
}

function householdAddressKey(
  h: Pick<
    Household,
    "address" | "locality" | "landmark" | "pincode" | "city" | "state"
  >,
): string {
  return [h.address, h.locality, h.landmark, h.pincode, h.city, h.state]
    .map((s) => String(s || "").trim().toLowerCase())
    .filter(Boolean)
    .join("|");
}

export function cleanRepeatedName(rawName: string): string {
  if (!rawName) return "";
  const parts = rawName.split(/[,/|]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return rawName.trim();
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const part of parts) {
    const key = part.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(part);
    }
  }
  return unique.join(" / ");
}

export function normalizeHousehold(h: Partial<Household> & { id: string }): Household {
  const mobile = normalizeMobile(h.mobile ?? "");
  const whatsappRaw = normalizeMobile(h.whatsappMobile ?? "");
  const addressKey = householdAddressKey({
    address: h.address ?? "",
    locality: h.locality ?? "",
    landmark: h.landmark ?? "",
    pincode: (h.pincode ?? "").replace(/\D/g, "").slice(0, 6),
    city: h.city ?? "",
    state: h.state ?? "Uttar Pradesh",
  });
  const geoStale = Boolean(h.geoAddressKey && h.geoAddressKey !== addressKey);
  const keepGeo =
    !geoStale &&
    typeof h.geoLat === "number" &&
    typeof h.geoLng === "number" &&
    h.geoConfidence !== "failed";

  return {
    id: h.id,
    code: h.code ?? "",
    guardianName: cleanRepeatedName(h.guardianName ?? ""),
    mobile,
    /** Legacy households without WhatsApp inherit guardian mobile */
    whatsappMobile: whatsappRaw || mobile,
    email: h.email ?? "",
    address: h.address ?? "",
    locality: h.locality ?? "",
    landmark: h.landmark ?? "",
    city: h.city ?? "",
    state: h.state ?? "Uttar Pradesh",
    pincode: (h.pincode ?? "").replace(/\D/g, "").slice(0, 6),
    altMobile: normalizeMobile(h.altMobile ?? ""),
    guardianPhotoUrl:
      typeof h.guardianPhotoUrl === "string" ? h.guardianPhotoUrl : "",
    revisionAt: typeof h.revisionAt === "string" ? h.revisionAt : "",
    ...(keepGeo
      ? {
          geoLat: h.geoLat,
          geoLng: h.geoLng,
          geoPlaceId: h.geoPlaceId,
          geoFormattedAddress: h.geoFormattedAddress,
          geoGeocodedAt: h.geoGeocodedAt,
          geoSource: h.geoSource,
          geoConfidence: h.geoConfidence,
          geoAddressKey: h.geoAddressKey,
        }
      : {}),
  };
}

/** Canonical WhatsApp number for fee reminders, receipts, and all parent messaging. */
export function householdWhatsApp(hh?: Household | null): string {
  if (!hh) return "";
  return normalizeMobile(hh.whatsappMobile || hh.mobile || "");
}

/**
 * Update household WhatsApp used for every communication channel.
 * When WhatsApp previously matched guardian mobile (or `alsoUpdateMobile`),
 * guardian mobile is updated too and sibling father/mother mobiles stay aligned.
 */
export function updateHouseholdWhatsApp(
  householdId: string,
  whatsappMobile: string,
  options?: { alsoUpdateMobile?: boolean },
): { ok: true; household: Household } | { ok: false; error: string } {
  const digits = normalizeMobile(whatsappMobile);
  if (!isValidMobile(digits)) {
    return { ok: false, error: "WhatsApp number must be exactly 10 digits" };
  }
  const sis = loadSis();
  const existing = sis.households.find((h) => h.id === householdId);
  if (!existing) return { ok: false, error: "Household not found" };

  const prevWa = normalizeMobile(
    existing.whatsappMobile || existing.mobile || "",
  );
  const prevMobile = normalizeMobile(existing.mobile);
  const syncMobile =
    options?.alsoUpdateMobile === true ||
    (options?.alsoUpdateMobile === undefined &&
      (!prevWa || prevWa === prevMobile));

  const household: Household = {
    ...existing,
    whatsappMobile: digits,
    ...(syncMobile ? { mobile: digits } : {}),
  };

  let students = sis.students;
  if (syncMobile) {
    students = sis.students.map((s) => {
      if (s.householdId !== householdId) return s;
      const relation = (s.guardianRelation || "Father").trim().toLowerCase();
      if (relation === "mother") {
        return normalizeStudent({ ...s, motherMobile: digits });
      }
      return normalizeStudent({ ...s, fatherMobile: digits });
    });
  }

  const next: SisState = {
    ...sis,
    households: sis.households.map((h) =>
      h.id === householdId ? household : h,
    ),
    students,
  };
  saveSis(next);
  return { ok: true, household };
}

/** Rough completeness for profile snapshot (0–100). */
export function profileCompleteness(student: SisStudent, hh?: Household): number {
  const checks: boolean[] = [
    !!student.fullName,
    !!student.admissionNo,
    !!student.dob,
    !!student.gender,
    !!student.classId && !!student.sectionId,
    !!student.fatherName,
    !!student.motherName,
    !!hh?.mobile && isValidMobile(hh.mobile),
    !!hh?.address,
    !!student.pen || student.penStatus === "to_register",
    !!student.photoUrl || docHasFile(student.docs.photo),
    docHasFile(student.docs.birthCert) ||
      student.docs.birthCert.status !== "missing",
    docHasFile(student.docs.aadhaar) ||
      student.docs.aadhaar.status !== "missing",
    !!student.bloodGroup,
    !!student.category,
  ];
  const done = checks.filter(Boolean).length;
  return Math.round((done / checks.length) * 100);
}

const STORAGE_KEY = "bhb_sis_v1";

/**
 * The roster, held in memory, independent of localStorage.
 *
 * SIS is 2.46 MB. With admissions and ~35 other module desks the origin sits
 * past the ~5 MB mobile cap, so caching it can simply fail — and on
 * 2026-08-10 it did: the server returned 200 with 2,457,504 bytes, the cache
 * write threw QuotaExceededError inside writeSisLocalRaw, hydration aborted,
 * and the phone showed 0 students against a database holding 711.
 *
 * loadSis() reads from localStorage, so a dropped cache read as "no
 * students". That is the same failure as everything else today: an absent
 * value standing in for a known one. The data was never missing — only
 * unstorable.
 *
 * This is the record for the session; localStorage is a best-effort copy for
 * the next page load. Under the no-offline decision the database is the real
 * source, and a browser that cannot cache must still be able to work.
 */
let memorySisState: SisState | null = null;

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function newSisId(prefix: string) {
  return id(prefix);
}

/** Digits only, capped at 10 (Indian mobile). */
export function normalizeMobile(value: string): string {
  return value.replace(/\D/g, "").slice(0, 10);
}

export function isValidMobile(value: string): boolean {
  return /^\d{10}$/.test(value.trim());
}

export function studentInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

/** Short badge: N = New, P = Promote, M = Mid-year, R = RTE */
export function studentTypeShort(type: FeeStudentType): {
  code: string;
  label: string;
} {
  switch (type) {
    case "NEW":
      return { code: "N", label: "New admission" };
    case "PROMOTE":
      return { code: "P", label: "Promoted" };
    case "MID_YEAR":
      return { code: "M", label: "Mid-year join" };
    case "RTE":
      return { code: "R", label: "RTE / EWS" };
    default:
      return { code: "?", label: type };
  }
}

/** Stable avatar background from name (navy family). */
export function avatarTone(fullName: string): string {
  let h = 0;
  for (let i = 0; i < fullName.length; i++) {
    h = (h * 31 + fullName.charCodeAt(i)) >>> 0;
  }
  const tones = ["#203050", "#2a3d66", "#334a70", "#3d5578", "#1a2740"];
  return tones[h % tones.length]!;
}


export function emptySisState(): SisState {
  return {
    version: 1,
    households: [],
    students: [],
    curriculumRequests: [],
    tags: [],
    classUpgrades: [],
  };
}

/**
 * True when roster looks like the old built-in demo (safe one-time wipe).
 */
export function isLikelyDemoRoster(sis: SisState): boolean {
  if (sis.students.length === 0) return false;
  const demoNames = new Set(Object.keys(DEMO_STUDENT_CLASS_BY_NAME));
  const demoAdm = sis.students.filter((s) =>
    /^BHB-2025-10[1-9]$|^BHB-2025-11[0]$/i.test(s.admissionNo.trim()),
  );
  const named = sis.students.filter((s) => demoNames.has(s.fullName));
  if (sis.students.length <= 12 && named.length >= Math.min(2, sis.students.length)) {
    return named.length === sis.students.length || demoAdm.length === sis.students.length;
  }
  return (
    sis.students.length <= 12 &&
    demoAdm.length === sis.students.length &&
    named.length >= 1
  );
}

/**
 * Guarantee at least one household with 2 active siblings for Fee Take / SIS demos.
 * Disabled for live — kept as no-op so callers do not re-inject Rahul/Ananya.
 */
export function ensureSiblingDemo(
  sis: SisState,
  _masters: MastersState,
): SisState {
  return sis;
}

/** Staff-ward demo tagging — disabled for live (no-op). */
export function ensureStaffWardDemo(sis: SisState): SisState {
  return sis;
}

/** Push slim roster into Masters so special fees / concessions stay in sync. */
function demoStudentsEqual(a: DemoStudent[], b: DemoStudent[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(b.map((s) => [s.id, s]));
  for (const x of a) {
    const y = byId.get(x.id);
    if (!y) return false;
    if (
      x.admissionNo !== y.admissionNo ||
      x.fullName !== y.fullName ||
      x.classId !== y.classId ||
      x.sectionId !== y.sectionId ||
      x.status !== y.status
    ) {
      return false;
    }
  }
  return true;
}

function demoStudentLinksValid(validSections: Set<string>, s: DemoStudent): boolean {
  return validSections.has(`${s.classId}:${s.sectionId}`);
}

export function syncSisIntoMasters(
  sis: SisState,
  masters?: MastersState,
  academicYearCode?: string,
) {
  const m = masters ?? loadMasters();
  // Prefer explicit / header-selected session so pickers match the workspace.
  const ay = normalizeAyCode(
    academicYearCode ||
      activeSessionCode() ||
      currentAcademicYearCode(m),
  );
  const scoped = sis.students.filter(
    (s) => normalizeAyCode(s.academicYearCode) === ay,
  );
  const source = scoped.length ? scoped : sis.students;
  const validSections = new Set(m.sections.map((sec) => `${sec.classId}:${sec.id}`));
  const demo: DemoStudent[] = source
    .map((s) => ({
      id: s.id,
      admissionNo: s.admissionNo,
      fullName: s.fullName,
      classId: s.classId,
      sectionId: s.sectionId,
      status: s.status,
    }))
    .filter((s) => demoStudentLinksValid(validSections, s));
  const current = m.students ?? [];
  if (demoStudentsEqual(current, demo)) return;
  saveMasters({ ...m, students: demo });
}

/** Align SIS students to current masters class/section ids. */
export function alignSisToMasters(
  sis: SisState,
  masters: MastersState,
): SisState {
  const classById = new Map(masters.classes.map((c) => [c.id, c]));
  const sectionById = new Map(masters.sections.map((s) => [s.id, s]));
  const classByName = new Map(
    masters.classes.map((c) => [c.name.toLowerCase(), c]),
  );
  const demoByName = new Map(
    (masters.students ?? []).map((d) => [d.fullName.toLowerCase(), d]),
  );
  const demoByAdm = new Map(
    (masters.students ?? []).map((d) => [d.admissionNo.toUpperCase(), d]),
  );

  function sectionForClass(classId: string, preferSectionId?: string) {
    if (preferSectionId) {
      const hit = sectionById.get(preferSectionId);
      if (hit && hit.classId === classId) return hit;
    }
    return masters.sections.find((x) => x.classId === classId);
  }

  let changed = false;
  const students = sis.students.map((s) => {
    const secOk = sectionById.get(s.sectionId);
    const classOk = classById.get(s.classId);
    if (classOk && secOk && secOk.classId === s.classId) return s;

    // Section still valid → take its class
    if (secOk && classById.has(secOk.classId)) {
      changed = true;
      return { ...s, classId: secOk.classId };
    }

    // Class valid → first section
    if (classOk) {
      const firstSec = sectionForClass(s.classId, s.sectionId);
      if (firstSec) {
        changed = true;
        return { ...s, sectionId: firstSec.id };
      }
    }

    // Match masters roster mirror (same admission / name) for id remaps after re-seed
    const demo =
      demoByAdm.get(s.admissionNo.toUpperCase()) ??
      demoByName.get(s.fullName.toLowerCase());
    if (demo && classById.has(demo.classId) && sectionById.has(demo.sectionId)) {
      changed = true;
      return { ...s, classId: demo.classId, sectionId: demo.sectionId };
    }

    // Known demo name → class label
    const classLabel = DEMO_STUDENT_CLASS_BY_NAME[s.fullName];
    if (classLabel) {
      const cls = classByName.get(classLabel.toLowerCase());
      const firstSec = cls ? sectionForClass(cls.id) : undefined;
      if (cls && firstSec) {
        changed = true;
        return { ...s, classId: cls.id, sectionId: firstSec.id };
      }
    }

    return s;
  });

  const validClass = new Set(masters.classes.map((c) => c.id));
  const orphanN = students.filter((s) => !validClass.has(s.classId)).length;
  if (sis.students.length > 0 && orphanN === sis.students.length) {
    // Total drift — keep rows but do not invent demo people
    return { ...sis, students };
  }

  if (!changed) return sis;
  return { ...sis, students };
}

const DEMO_CLEARED_KEY = "bhb_demo_roster_cleared_v1";

export function loadSis(): SisState {
  const masters = ensureStudentClassLinks(loadMasters());
  if (typeof window === "undefined") {
    const mirrored = getSchoolMirrorSync().sis as SisState | null;
    if (mirrored && Array.isArray(mirrored.households)) {
      return mirrored;
    }
    return emptySisState();
  }
  // A cache that could not be written must not read as "no students".
  // See memorySisState.
  const cachedRaw = localStorage.getItem(STORAGE_KEY);
  if (!cachedRaw && memorySisState) return memorySisState;

  try {
    const raw = cachedRaw;
    if (raw) {
      const parsed = JSON.parse(raw) as SisState;
      let next: SisState = {
        version: 1,
        households: (parsed.households ?? []).map((h) =>
          normalizeHousehold(h),
        ),
        students: (parsed.students ?? []).map((s) => normalizeStudent(s)),
        curriculumRequests: (parsed.curriculumRequests ?? []).map((r) =>
          normalizeCurriculumRequest({
            ...r,
            id: r.id || `creq_${Math.random().toString(36).slice(2, 9)}`,
            studentId: r.studentId || "",
          }),
        ),
        tags: (parsed.tags ?? []).map((t) => normalizeStudentTag(t)),
        classUpgrades: Array.isArray(parsed.classUpgrades)
          ? parsed.classUpgrades.map((u) => ({
              ...u,
              fromStudentType: u.fromStudentType ?? "",
              toStudentType: u.toStudentType ?? u.fromStudentType ?? "",
            }))
          : [],
      };
      // One-time wipe of built-in demo people so live testing starts clean
      if (
        !localStorage.getItem(DEMO_CLEARED_KEY) &&
        isLikelyDemoRoster(next)
      ) {
        next = emptySisState();
        localStorage.setItem(DEMO_CLEARED_KEY, "1");
      } else if (!localStorage.getItem(DEMO_CLEARED_KEY)) {
        localStorage.setItem(DEMO_CLEARED_KEY, "1");
      }
      if (next.students.length > 0) {
        next = alignSisToMasters(next, masters);
      }
      writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(next));
      syncSisIntoMasters(next, masters);
      if (next.students.length > 0) {
        void import("@/lib/feeDiscountImportHydrate").then(
          ({ mergeAndPersistFeeDiscountSeed }) => {
            mergeAndPersistFeeDiscountSeed(masters, next);
          },
        );
      }
      return next;
    }
    const empty = emptySisState();
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(empty));
    localStorage.setItem(DEMO_CLEARED_KEY, "1");
    syncSisIntoMasters(empty, masters);
    return empty;
  } catch {
    return emptySisState();
  }
}

/**
 * Clear all students + unused households (live start / wipe before import).
 * Does not remove fee vouchers — clear those separately if needed.
 */
export function clearAllStudents(options?: {
  keepHouseholds?: boolean;
}): SisState {
  const prev = loadSis();
  const next: SisState = {
    version: 1,
    households: options?.keepHouseholds ? prev.households : [],
    students: [],
    curriculumRequests: [],
    tags: prev.tags ?? [],
    classUpgrades: prev.classUpgrades ?? [],
  };
  if (typeof window !== "undefined") {
    localStorage.setItem(DEMO_CLEARED_KEY, "1");
  }
  saveSis(next);
  return next;
}

export function saveSis(state: SisState) {
  if (!assertModulePermission("students", "edit", "saveSis")) return;

  if (typeof window === "undefined") {
    setMirrorSlice("sis", state);
    void import("@/lib/sisPersistence").then(({ scheduleSisSync }) => {
      scheduleSisSync(state);
    });
    return;
  }
  memorySisState = state;
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(state));
  syncSisIntoMasters(state);
  if (!deskSkipBlobPushClient("sis")) {
    scheduleClientSchoolMirrorSync({ sis: state });
  }
  // Dual-mode: push full roster + curriculum when Supabase is configured
  void import("@/lib/sisPersistence").then(({ scheduleSisSync }) => {
    scheduleSisSync(state);
  });
  void import("@/lib/curriculumPersistence").then(({ scheduleCurriculumSync }) => {
    scheduleCurriculumSync(state);
  });
}

const SIS_MIRROR_META = "bhb_sis_mirror_meta_v1";

function readSisMirrorMeta(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(SIS_MIRROR_META);
    if (!raw) return "";
    return String((JSON.parse(raw) as { updatedAt?: string }).updatedAt || "");
  } catch {
    return "";
  }
}

function writeSisMirrorMeta(iso: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SIS_MIRROR_META, JSON.stringify({ updatedAt: iso }));
}

export function sisMirrorIsEmpty(state: SisState): boolean {
  return (state.students?.length ?? 0) === 0 && (state.households?.length ?? 0) === 0;
}

export function writeSisLocalRaw(state: SisState) {
  const next: SisState = {
    version: 1,
    households: (state.households ?? []).map((h) => normalizeHousehold(h)),
    students: (state.students ?? []).map((s) => normalizeStudent(s)),
    curriculumRequests: (state.curriculumRequests ?? []).map((r) =>
      normalizeCurriculumRequest({
        ...r,
        id: r.id || `creq_${Math.random().toString(36).slice(2, 9)}`,
        studentId: r.studentId || "",
      }),
    ),
    tags: (state.tags ?? []).map((t) => normalizeStudentTag(t)),
    classUpgrades: Array.isArray(state.classUpgrades) ? state.classUpgrades : [],
  };
  if (typeof window === "undefined") {
    setMirrorSlice("sis", next);
    return;
  }
  // Memory first, and unconditionally: this must survive a cache that cannot
  // hold 2.46 MB. writeCacheOrInvalidate never throws for a full disk, so
  // hydration can no longer be aborted by one.
  memorySisState = next;
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(next));
  syncSisIntoMasters(next, loadMasters());
}

export function hydrateSisFromMirror(
  raw: unknown,
  remoteAt: string,
  remoteIsNewer: boolean,
): boolean {
  if (!raw || typeof raw !== "object") return false;
  const local = loadSis();
  const localAt = readSisMirrorMeta();
  const takeRemote =
    remoteIsNewer ||
    sisMirrorIsEmpty(local) ||
    !localAt ||
    (remoteAt && remoteAt > localAt);
  if (!takeRemote) return false;
  writeSisLocalRaw(raw as SisState);
  writeSisMirrorMeta(remoteAt || new Date().toISOString());
  if (!deskSkipBlobPushClient("sis")) {
    scheduleClientSchoolMirrorSync({ sis: raw });
  }
  return true;
}

export type SisRemovalCheck = {
  canRemove: boolean;
  blockers: string[];
  suggestion: string;
  confirmMessage: string;
};

export function checkStudentRemoval(
  student: SisStudent,
): SisRemovalCheck {
  if (student.status === "active") {
    return {
      canRemove: false,
      blockers: ["active status"],
      suggestion:
        "Active students cannot be removed. Inactivate first (or issue TC later).",
      confirmMessage: `Remove “${student.fullName}”?`,
    };
  }
  return {
    canRemove: true,
    blockers: [],
    suggestion:
      "Prefer keeping inactive on record for fees/audit. Removal cannot be undone.",
    confirmMessage: `Remove “${student.fullName}” (${student.admissionNo})?`,
  };
}

export function removeStudent(
  state: SisState,
  studentId: string,
): { ok: true; state: SisState } | { ok: false; reason: string } {
  const student = state.students.find((s) => s.id === studentId);
  if (!student) return { ok: false, reason: "Student not found" };
  const check = checkStudentRemoval(student);
  if (!check.canRemove) return { ok: false, reason: check.suggestion };

  const nextStudents = state.students.filter((s) => s.id !== studentId);
  const hhStillUsed = nextStudents.some(
    (s) => s.householdId === student.householdId,
  );
  return {
    ok: true,
    state: {
      ...state,
      students: nextStudents,
      households: hhStillUsed
        ? state.households
        : state.households.filter((h) => h.id !== student.householdId),
    },
  };
}

export function suggestAdmissionNo(
  students: SisStudent[],
  masters?: Pick<MastersState, "numberSeries"> | null,
  ayCode?: string,
): string {
  const m =
    masters ??
    (typeof window !== "undefined" ? loadMasters() : null);
  const ay = ayCode ?? activeSessionCode() ?? DEFAULT_AY;
  const fromSeries = suggestFromSeriesCode(
    m?.numberSeries,
    "ADMISSION",
    ay,
    students.map((s) => s.admissionNo),
  );
  if (fromSeries) return fromSeries;

  const year = ay.split("-")[0] ?? "2025";
  let max = 100;
  for (const s of students) {
    const m = s.admissionNo.match(/(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `BHB-${year}-${max + 1}`;
}

/** Next Scholar Register Number (SRN) for Students SIS */
export function suggestSrn(
  students: SisStudent[],
  masters?: Pick<MastersState, "numberSeries"> | null,
  ayCode?: string,
): string {
  const m =
    masters ??
    (typeof window !== "undefined" ? loadMasters() : null);
  const ay = ayCode ?? activeSessionCode() ?? DEFAULT_AY;
  const fromSeries = suggestFromSeriesCode(
    m?.numberSeries,
    "SRN",
    ay,
    students.map((s) => s.srn || ""),
  );
  if (fromSeries) return fromSeries;

  let max = 0;
  for (const s of students) {
    const match = (s.srn || "").match(/(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `SRN-${String(max + 1).padStart(5, "0")}`;
}

/** Registration number for admissions / SIS */
export function suggestRegistrationNo(
  students: SisStudent[],
  masters?: Pick<MastersState, "numberSeries"> | null,
  ayCode?: string,
): string {
  const m =
    masters ??
    (typeof window !== "undefined" ? loadMasters() : null);
  const ay = ayCode ?? activeSessionCode() ?? DEFAULT_AY;
  return (
    suggestFromSeriesCode(
      m?.numberSeries,
      "REGISTRATION",
      ay,
      students.map((s) => s.registrationNo || ""),
    ) ?? ""
  );
}

export function householdOf(
  state: SisState,
  householdId: string,
): Household | undefined {
  return state.households.find((h) => h.id === householdId);
}

/**
 * Count active unique families/households for active enrolled students.
 * Filters out unassigned/orphaned households and inactive students.
 */
export function countActiveHouseholds(
  state: SisState,
  academicYearCode?: string,
): number {
  if (!state || !Array.isArray(state.students)) return 0;
  const targetAy =
    academicYearCode && academicYearCode !== "all"
      ? normalizeAyCode(academicYearCode)
      : "";

  const activeStudents = state.students.filter((s) => {
    if (s.status !== "active") return false;
    if (targetAy) {
      return normalizeAyCode(s.academicYearCode || "") === targetAy;
    }
    return true;
  });

  const householdIds = new Set<string>();
  for (const s of activeStudents) {
    if (s.householdId) {
      householdIds.add(s.householdId);
    } else {
      const mob = s.fatherMobile || s.motherMobile || s.admissionNo;
      if (mob) householdIds.add(`unlinked_${mob}`);
    }
  }
  return householdIds.size;
}

/** `2023-2024` / `2023–24` → `2023-24` for cross-record comparison. */
function normalizeAyCode(code: string): string {
  const t = (code || "").trim().replace(/\s+/g, "").replace(/–/g, "-");
  const full = t.match(/^(20\d{2})-(20\d{2})$/);
  if (full) return `${full[1]}-${full[2]!.slice(2)}`;
  return t;
}

export function siblingsOf(
  state: SisState,
  student: SisStudent,
): SisStudent[] {
  const ay = normalizeAyCode(student.academicYearCode);
  const selfAdm = student.admissionNo.trim().toUpperCase();
  const selfName = (student.fullName || "").trim().toLowerCase();
  return state.students.filter(
    (s) =>
      s.householdId === student.householdId &&
      s.id !== student.id &&
      // Same academic year only — never show a prior/next-year record as a sibling
      normalizeAyCode(s.academicYearCode) === ay &&
      // Exclude the same child (via admission no or name match)
      (selfAdm ? s.admissionNo.trim().toUpperCase() !== selfAdm : true) &&
      (s.fullName || "").trim().toLowerCase() !== selfName,
  );
}

/** Family / emergency fields that must stay identical for siblings on one household. */
export type SharedFamilyContacts = {
  fatherName: string;
  motherName: string;
  fatherMobile: string;
  motherMobile: string;
  fatherAadhaarLast4: string;
  motherAadhaarLast4: string;
  fatherPan: string;
  motherPan: string;
  guardianRelation: string;
  emergencyName: string;
  emergencyMobile: string;
};

export function sharedFamilyContactsOf(
  student: Pick<
    SisStudent,
    | "fatherName"
    | "motherName"
    | "fatherMobile"
    | "motherMobile"
    | "fatherAadhaarLast4"
    | "motherAadhaarLast4"
    | "fatherPan"
    | "motherPan"
    | "guardianRelation"
    | "emergencyName"
    | "emergencyMobile"
  >,
): SharedFamilyContacts {
  return {
    fatherName: student.fatherName,
    motherName: student.motherName,
    fatherMobile: normalizeMobile(student.fatherMobile),
    motherMobile: normalizeMobile(student.motherMobile),
    fatherAadhaarLast4: student.fatherAadhaarLast4,
    motherAadhaarLast4: student.motherAadhaarLast4,
    fatherPan: student.fatherPan,
    motherPan: student.motherPan,
    guardianRelation: student.guardianRelation || "Father",
    emergencyName: student.emergencyName,
    emergencyMobile: normalizeMobile(student.emergencyMobile),
  };
}

/**
 * Align guardian household mobile with the primary parent contact, and keep
 * WhatsApp linked when it previously matched the old guardian mobile.
 * Prefers the field the user actually changed (parent vs household mobile).
 */
export function alignHouseholdMobiles(input: {
  relation: string;
  fatherMobile: string;
  motherMobile: string;
  householdMobile: string;
  whatsappMobile: string;
  previousHousehold?: Pick<Household, "mobile" | "whatsappMobile"> | null;
  previousFatherMobile?: string;
  previousMotherMobile?: string;
}): {
  fatherMobile: string;
  motherMobile: string;
  householdMobile: string;
  whatsappMobile: string;
} {
  const relation = input.relation.trim().toLowerCase();
  let fatherMobile = normalizeMobile(input.fatherMobile);
  let motherMobile = normalizeMobile(input.motherMobile);
  let householdMobile = normalizeMobile(input.householdMobile);
  let whatsappMobile =
    normalizeMobile(input.whatsappMobile) || householdMobile;

  const prevMobile = normalizeMobile(input.previousHousehold?.mobile ?? "");
  const prevFather = normalizeMobile(input.previousFatherMobile ?? "");
  const prevMother = normalizeMobile(input.previousMotherMobile ?? "");
  const fatherChanged = fatherMobile !== prevFather;
  const motherChanged = motherMobile !== prevMother;
  const hhChanged = householdMobile !== prevMobile;

  if (relation === "mother") {
    if (motherChanged && motherMobile) householdMobile = motherMobile;
    else if (hhChanged && householdMobile) motherMobile = householdMobile;
    else if (motherMobile) householdMobile = motherMobile;
    else if (householdMobile) motherMobile = householdMobile;
  } else {
    if (fatherChanged && fatherMobile) householdMobile = fatherMobile;
    else if (hhChanged && householdMobile) fatherMobile = householdMobile;
    else if (fatherMobile) householdMobile = fatherMobile;
    else if (householdMobile) fatherMobile = householdMobile;
  }

  const prevWa = normalizeMobile(
    input.previousHousehold?.whatsappMobile ||
      input.previousHousehold?.mobile ||
      "",
  );
  const waWasLinked = !prevWa || prevWa === prevMobile;
  if (waWasLinked) {
    whatsappMobile = householdMobile;
  } else if (!whatsappMobile) {
    whatsappMobile = householdMobile;
  }

  return { fatherMobile, motherMobile, householdMobile, whatsappMobile };
}

/**
 * Copy shared family contacts onto every student on the household
 * (siblings stay in lockstep with the student being edited).
 */
export function applySharedFamilyToHousehold(
  students: SisStudent[],
  householdId: string,
  shared: SharedFamilyContacts,
  primary?: SisStudent,
): SisStudent[] {
  if (!householdId) {
    return primary
      ? students.map((s) => (s.id === primary.id ? primary : s))
      : students;
  }
  return students.map((s) => {
    if (primary && s.id === primary.id) return primary;
    if (s.householdId !== householdId) return s;
    return normalizeStudent({
      ...s,
      ...shared,
      householdId,
    });
  });
}

function newCurriculumRequestId() {
  return `creq_${Math.random().toString(36).slice(2, 9)}`;
}

export function pendingCurriculumRequests(
  sis?: SisState,
  studentId?: string,
): CurriculumRequest[] {
  const state = sis ?? loadSis();
  return (state.curriculumRequests ?? []).filter(
    (r) =>
      r.status === "pending" &&
      (!studentId || r.studentId === studentId),
  );
}

export function submitCurriculumRequest(input: {
  studentId: string;
  academicYearCode: string;
  proposedStreamId: string | null;
  proposedChosenSubjectIds: string[];
  note?: string;
}): { ok: true; request: CurriculumRequest } | { ok: false; error: string } {
  const sis = loadSis();
  const student = sis.students.find((s) => s.id === input.studentId);
  if (!student) return { ok: false, error: "Student not found" };
  const existing = pendingCurriculumRequests(sis, input.studentId);
  if (existing.length > 0) {
    return {
      ok: false,
      error: "A subject change request is already pending office review",
    };
  }
  const request = normalizeCurriculumRequest({
    id: newCurriculumRequestId(),
    studentId: input.studentId,
    academicYearCode: input.academicYearCode || student.academicYearCode,
    proposedStreamId: input.proposedStreamId,
    proposedChosenSubjectIds: input.proposedChosenSubjectIds,
    note: input.note ?? "",
    status: "pending",
    requestedAt: new Date().toISOString(),
  });
  saveSis({
    ...sis,
    curriculumRequests: [...(sis.curriculumRequests ?? []), request],
  });
  return { ok: true, request };
}

export function reviewCurriculumRequest(input: {
  requestId: string;
  decision: "approved" | "rejected";
  reviewNote?: string;
}): { ok: true } | { ok: false; error: string } {
  const sis = loadSis();
  const req = (sis.curriculumRequests ?? []).find(
    (r) => r.id === input.requestId,
  );
  if (!req || req.status !== "pending") {
    return { ok: false, error: "Pending request not found" };
  }
  const reviewedAt = new Date().toISOString();
  let students = sis.students;
  if (input.decision === "approved") {
    const student = students.find((s) => s.id === req.studentId);
    if (!student) return { ok: false, error: "Student not found" };
    students = students.map((s) =>
      s.id === req.studentId
        ? normalizeStudent({
            ...s,
            curriculum: {
              academicYearCode: req.academicYearCode,
              seniorStreamId: req.proposedStreamId,
              chosenSubjectIds: req.proposedChosenSubjectIds,
              confirmedAt: reviewedAt,
              confirmedBy: "office",
            },
          })
        : s,
    );
  }
  saveSis({
    ...sis,
    students,
    curriculumRequests: (sis.curriculumRequests ?? []).map((r) =>
      r.id === input.requestId
        ? {
            ...r,
            status: input.decision,
            reviewedAt,
            reviewNote: input.reviewNote ?? "",
          }
        : r,
    ),
  });
  return { ok: true };
}
