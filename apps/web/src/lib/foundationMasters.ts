/**
 * Foundation masters — institution, academic, subjects, holidays, staff, series.
 * Stored inside MastersState (localStorage demo).
 */

import type { MastersState, SchoolClass } from "@/lib/masters";
import type { LanguageSubtype, NcfTagId } from "@/lib/cbseSubjectGroups";
import {
  defaultLanguageSubtype,
  defaultNcfTagForCode,
  normalizeNcfTagId,
} from "@/lib/cbseSubjectGroups";
import { TENANT } from "@/lib/types";
import {
  defaultSchoolTimingConfig,
  normalizeSchoolTimingConfig,
  type SchoolTimingConfig,
} from "@/lib/schoolTiming";

const FOUNDATION_DEFAULT_AY = "2025-26";

export type BoardMode = "UP_STATE" | "CBSE" | "DUAL";

export type SchoolProfile = {
  legalName: string;
  displayName: string;
  shortName: string;
  tagline: string;
  udiseCode: string;
  boardMode: BoardMode;
  affiliationNo: string;
  schoolCode: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  /** Landline / office phone */
  phone: string;
  mobile: string;
  whatsapp: string;
  email: string;
  website: string;
  facebook: string;
  instagram: string;
  /** Google Business / Maps / review link */
  google: string;
  youtube: string;
  logoUrl: string;
  /** Browser tab icon (falls back to logo) */
  faviconUrl: string;
  /** Center watermark on letters / certificates */
  watermarkUrl: string;
  /** Full-page tiled background image for documents */
  pageBackgroundUrl: string;
  /** Tile school display name across page when no background image */
  pageBackgroundSchoolNameRepeat: boolean;
  /** Director signature for govt submissions */
  directorSignatureUrl: string;
  /** Principal stamp + signature composite (PNG, transparent) */
  principalStampSignatureUrl: string;
  /** Director stamp + signature composite (PNG, transparent; blue tint in previews) */
  directorStampSignatureUrl: string;
  /** School merchant UPI VPA for collections (registration / fees) */
  collectionsUpiVpa: string;
};

/** One slab in a late-payment damages table (EPF 14B-style / ESIC equivalent). */
export type StatutoryPenaltySlab = {
  /** Slab applies while days overdue <= this. Last slab should use a large number as "and above". */
  maxDelayDays: number;
  ratePctPerAnnum: number;
};

/**
 * Establishment-level EPF/ESIC identity + rates. Penalty rates are configurable,
 * not hardcoded, because EPFO/ESIC revise them by circular — a stored slab table
 * beats a constant that silently goes stale.
 */
export type StatutoryEstablishmentConfig = {
  epfEstablishmentId: string;
  epfLin: string;
  epfContributionRatePct: number;
  applyEpfWageCeiling: boolean;
  epfWageCeiling: number;
  esicEmployerCode: string;
  esicWageCeiling: number;
  /**
   * Low-wage exemption: staff whose monthly wages are up to this amount pay
   * no employee ESIC share (ESI Act — daily wage up to ₹176 ≈ ₹5,000/month);
   * the employer share is still payable. 0 = no exemption.
   */
  esicEmployeeExemptWageLimit: number;
  esicEmployeeRatePct: number;
  esicEmployerRatePct: number;
  penalty: {
    interestRatePctPerAnnum: number;
    damageSlabs: StatutoryPenaltySlab[];
    esicInterestRatePctPerAnnum: number;
    esicDamageSlabs: StatutoryPenaltySlab[];
    /** Free-text reference, e.g. "As per EPFO circular dated ..." — rates are estimates, not the authority's final levy. */
    circularNote: string;
  };
};

export type AyStatus = "current" | "closed" | "upcoming";

export type AcademicYearMaster = {
  id: string;
  code: string;
  label: string;
  startsOn: string;
  endsOn: string;
  status: AyStatus;
  isActive: boolean;
};

export type AcademicTerm = {
  id: string;
  academicYearCode: string;
  code: string;
  label: string;
  startsOn: string;
  endsOn: string;
  sortOrder: number;
};

export type SubjectCategory = "scholastic" | "co_scholastic";

/**
 * Subject or assessment component.
 * - `parentId` null = standalone / group head (e.g. English)
 * - `parentId` set = component under that group (e.g. English-Oral)
 */
export type Subject = {
  id: string;
  code: string;
  nameEn: string;
  category: SubjectCategory;
  /** Work Education / Art / HPE / Discipline — for co-scholastic */
  coScholasticArea: string;
  /** Parent group subject id, or null for top-level */
  parentId: string | null;
  isElective: boolean;
  isActive: boolean;
  sortOrder: number;
  /**
   * NCF tag A/B/C/D (legacy G1–G4 mapped on load).
   * Alias field `cbseGroupId` kept for older rows.
   */
  ncfTagId: NcfTagId;
  /** @deprecated Prefer ncfTagId — synced on normalize */
  cbseGroupId: NcfTagId | null;
  /** Only for Tag A languages */
  languageSubtype: LanguageSubtype;
};

export function normalizeSubject(
  s: Partial<Subject> & Pick<Subject, "id" | "code" | "nameEn">,
): Subject {
  const category =
    s.category === "co_scholastic" ? "co_scholastic" : "scholastic";
  const tag =
    normalizeNcfTagId(s.ncfTagId) ??
    normalizeNcfTagId(s.cbseGroupId) ??
    defaultNcfTagForCode(s.code, category);
  const langDefault = defaultLanguageSubtype(s.code);
  const languageSubtype: LanguageSubtype =
    tag === "A"
      ? s.languageSubtype === "native" ||
        s.languageSubtype === "regional" ||
        s.languageSubtype === "foreign"
        ? s.languageSubtype
        : langDefault || "foreign"
      : "";
  return {
    id: s.id,
    code: s.code,
    nameEn: s.nameEn,
    category,
    coScholasticArea: s.coScholasticArea ?? "",
    parentId: s.parentId ?? null,
    isElective: s.isElective ?? false,
    isActive: s.isActive ?? true,
    sortOrder: s.sortOrder ?? 0,
    ncfTagId: tag,
    cbseGroupId: tag,
    languageSubtype,
  };
}

/** Top-level subjects first; each followed by its children. */
export function subjectsInDisplayOrder(subjects: Subject[]): Subject[] {
  const list = subjects.map(normalizeSubject);
  const roots = list
    .filter((s) => !s.parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  const out: Subject[] = [];
  for (const root of roots) {
    out.push(root);
    const kids = list
      .filter((s) => s.parentId === root.id)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
    out.push(...kids);
  }
  // Orphans (parent missing) at end
  const seen = new Set(out.map((s) => s.id));
  for (const s of list) {
    if (!seen.has(s.id)) out.push(s);
  }
  return out;
}

export function subjectChildren(
  subjects: Subject[],
  parentId: string,
): Subject[] {
  return subjects
    .filter((s) => s.parentId === parentId && s.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function isSubjectGroup(subjects: Subject[], id: string): boolean {
  return subjects.some((s) => s.parentId === id);
}

export type ClassSubjectLink = {
  id: string;
  classId: string;
  subjectId: string;
  periodsPerWeek: number;
  isActive: boolean;
  /** Student may choose this subject (elective / optional 6th). */
  isOptional?: boolean;
};

export type NumberSeries = {
  id: string;
  code: string;
  label: string;
  prefix: string;
  nextNumber: number;
  padWidth: number;
  /** When true, counter resets per academic year via countersByAy. */
  resetOnAy: boolean;
  /** Insert academic session code into the prefix (e.g. BHB-2025-26-). */
  includeSessionInPrefix: boolean;
  /** Per-AY counters when resetOnAy is enabled. */
  countersByAy?: Record<string, number>;
};

export function normalizeNumberSeries(raw: Partial<NumberSeries> & Pick<NumberSeries, "id" | "code" | "label">): NumberSeries {
  return {
    id: raw.id,
    code: raw.code,
    label: raw.label,
    prefix: raw.prefix ?? "",
    nextNumber: Math.max(1, raw.nextNumber ?? 1),
    padWidth: Math.max(1, raw.padWidth ?? 4),
    resetOnAy: raw.resetOnAy ?? false,
    includeSessionInPrefix: raw.includeSessionInPrefix ?? false,
    countersByAy: raw.countersByAy,
  };
}

/** Merge saved series with seed defaults — backfill missing codes and new fields. */
export function mergeNumberSeries(
  partial: NumberSeries[] | undefined,
  seed: NumberSeries[],
): NumberSeries[] {
  const seedByCode = new Map(
    seed.map((s) => [s.code, normalizeNumberSeries(s)]),
  );
  const merged: NumberSeries[] = [];
  const seen = new Set<string>();

  for (const s of partial ?? []) {
    const norm = normalizeNumberSeries(s);
    seen.add(norm.code);
    merged.push(norm);
  }

  for (const seedItem of seed) {
    if (!seen.has(seedItem.code)) {
      merged.push(seedByCode.get(seedItem.code) ?? normalizeNumberSeries(seedItem));
    }
  }

  return merged;
}

export type HolidayKind =
  | "gazetted"
  | "restricted"
  | "national"
  | "school"
  | "exam"
  | "emergency"
  | "other";

export type HolidayScope = "school" | "class_group" | "class";
export type HolidayDayType = "full" | "half";
export type HolidayMode = "one_off" | "weekly";

/** Who the holiday day off applies to (students and/or staff streams). */
export type HolidayAppliesTo =
  | "everyone"
  | "students"
  | "staff_all"
  | "staff_teaching"
  | "staff_non_teaching"
  | "students_and_teaching"
  | "students_and_non_teaching";

export type Holiday = {
  id: string;
  academicYearCode: string;
  title: string;
  /** One-off range start, or weekly rule effective-from */
  startsOn: string;
  /** One-off range end, or weekly rule effective-to */
  endsOn: string;
  kind: HolidayKind;
  /** Academic scope: school / class group / class (for students) */
  scope: HolidayScope;
  /** When scope = class_group */
  groupCode: string;
  /** When scope = class */
  classIds: string[];
  /** Students / teaching / non-teaching / combinations */
  appliesTo: HolidayAppliesTo;
  mode: HolidayMode;
  /** 0=Sun … 6=Sat when mode = weekly */
  weekday: number | null;
  dayType: HolidayDayType;
  /** Paid holiday for staff payroll when staff are included */
  paidForStaff: boolean;
  /** Dates where a weekly rule is suspended */
  exceptionDates: string[];
  /** Force working day (overrides weekly / other holidays for audience) */
  workingOverride: boolean;
  isPublished: boolean;
  publishedAt: string | null;
  publishedBy: string;
  note: string;
};

const APPLIES_TO_SET = new Set<HolidayAppliesTo>([
  "everyone",
  "students",
  "staff_all",
  "staff_teaching",
  "staff_non_teaching",
  "students_and_teaching",
  "students_and_non_teaching",
]);

export function normalizeHoliday(
  h: Partial<Holiday> &
    Pick<Holiday, "id" | "title" | "startsOn" | "academicYearCode">,
): Holiday {
  const kindRaw = (h.kind || "school") as string;
  const kind: HolidayKind =
    kindRaw === "gazetted" ||
    kindRaw === "restricted" ||
    kindRaw === "national" ||
    kindRaw === "school" ||
    kindRaw === "exam" ||
    kindRaw === "emergency" ||
    kindRaw === "other"
      ? kindRaw
      : "other";
  const scope: HolidayScope =
    h.scope === "class_group" || h.scope === "class" ? h.scope : "school";
  const mode: HolidayMode = h.mode === "weekly" ? "weekly" : "one_off";
  const dayType: HolidayDayType = h.dayType === "half" ? "half" : "full";
  const weekday =
    mode === "weekly" && typeof h.weekday === "number" && h.weekday >= 0 && h.weekday <= 6
      ? h.weekday
      : mode === "weekly"
        ? 6
        : null;
  const appliesRaw = (h.appliesTo || "everyone") as string;
  const appliesTo: HolidayAppliesTo = APPLIES_TO_SET.has(
    appliesRaw as HolidayAppliesTo,
  )
    ? (appliesRaw as HolidayAppliesTo)
    : "everyone";
  const includesStaff =
    appliesTo === "everyone" ||
    appliesTo === "staff_all" ||
    appliesTo === "staff_teaching" ||
    appliesTo === "staff_non_teaching" ||
    appliesTo === "students_and_teaching" ||
    appliesTo === "students_and_non_teaching";
  return {
    id: h.id,
    academicYearCode: h.academicYearCode,
    title: h.title.trim() || "Holiday",
    startsOn: (h.startsOn || "").slice(0, 10),
    endsOn: (h.endsOn || h.startsOn || "").slice(0, 10),
    kind,
    scope,
    groupCode: scope === "class_group" ? String(h.groupCode || "") : "",
    classIds:
      scope === "class" && Array.isArray(h.classIds)
        ? h.classIds.filter(Boolean)
        : [],
    appliesTo,
    mode,
    weekday,
    dayType,
    paidForStaff: includesStaff ? h.paidForStaff !== false : false,
    exceptionDates: Array.isArray(h.exceptionDates)
      ? h.exceptionDates.map((d) => String(d).slice(0, 10)).filter(Boolean)
      : [],
    workingOverride: !!h.workingOverride,
    isPublished: !!h.isPublished,
    publishedAt: h.publishedAt ?? null,
    publishedBy: h.publishedBy ?? "",
    note: h.note ?? "",
  };
}

export type Department = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

export type Designation = {
  id: string;
  code: string;
  name: string;
  departmentId: string | null;
  isActive: boolean;
};

export type StaffStream = "teaching" | "non_teaching";
export type StaffCategory = "permanent" | "contract" | "part_time";
export type StaffJobType =
  | ""
  | "confirmed"
  | "probation"
  | "temporary"
  | "contract";
export type StaffGender = "M" | "F" | "O" | "";
export type StaffCasteCategory =
  | "GENERAL"
  | "OBC"
  | "SC"
  | "ST"
  | "OTHER"
  | "";
export type StaffMaritalStatus = "" | "single" | "married" | "widowed" | "other";

export type StaffRecord = {
  id: string;
  empCode: string;
  fullName: string;
  stream: StaffStream;
  category: StaffCategory;
  /** Vendor job type: Confirmed / Probation / Temporary / Contract */
  jobType: StaffJobType;
  departmentId: string | null;
  designationId: string | null;
  campusId: string | null;
  /** Branch / campus label from vendor exports when not linked to campusId */
  branchName: string;
  mobile: string;
  altMobile: string;
  email: string;
  status: "active" | "inactive";
  gender: StaffGender;
  religion: string;
  casteCategory: StaffCasteCategory;
  dateOfBirth: string;
  joiningDate: string;
  leavingDate: string;
  /** When the staff row was first added in the source system */
  staffAddedOn: string;
  bloodGroup: string;
  maritalStatus: StaffMaritalStatus;
  fatherName: string;
  spouseName: string;
  nationality: string;
  aadhaarNo: string;
  panNo: string;
  voterId: string;
  addressCurrent: string;
  addressPermanent: string;
  city: string;
  state: string;
  pincode: string;
  emergencyContactName: string;
  emergencyContactMobile: string;
  emergencyRelation: string;
  qualification: string;
  experienceYears: string;
  /** Free-text experience summary from vendor (e.g. "1year 3month") */
  experienceDetail: string;
  /** Longer experience / role description */
  experienceDescription: string;
  subjectsTaught: string;
  biometricId: string;
  rfidNo: string;
  /** OASIS / UDISE staff portal ID */
  oasisId: string;
  /** Basic pay in INR (whole rupees as entered) */
  basicPay: string;
  photoUrl: string;
  signatureUrl: string;
  /** Payload encoded in staff ID QR (emp code + id). */
  qrPayload: string;
  loginUsername: string;
  loginPassword: string;
  loginEnabled: boolean;
  bankName: string;
  bankBranch: string;
  bankAccountNo: string;
  bankIfsc: string;
  bankAccountName: string;
  upiId: string;
  pfNumber: string;
  uanNumber: string;
  pfJoiningDate: string;
  esicNumber: string;
  esicDispensary: string;
  remarks: string;
  docs: StaffDocs;
  classTeacherLinks: StaffClassTeacherLink[];
  subjectTeachingLinks: StaffSubjectTeachingLink[];
  vehicleLinks: StaffVehicleLink[];
  dutyLinks: StaffDutyLink[];
};

export type StaffDocKey =
  | "photo"
  | "aadhaar"
  | "pan"
  | "addressProof"
  | "educationCert"
  | "experienceCert"
  | "medicalCert"
  | "policeVerification"
  | "joiningLetter"
  | "contract"
  | "drivingLicense"
  | "other";

export type StaffDocStatus =
  | "missing"
  | "received"
  | "pending"
  | "verified"
  | "rejected";

export type StaffDocFile = {
  status: StaffDocStatus;
  fileName: string;
  mimeType: string;
  size: number;
  fileUrl: string;
  /** Set once the file is in Drive; empty for legacy/unmigrated records. */
  driveFileId?: string;
  uploadedAt: string;
  submittedBy?: string;
  submittedAt?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
};

export type StaffDocs = Record<StaffDocKey, StaffDocFile>;

export const STAFF_DOC_LABELS: { key: StaffDocKey; label: string }[] = [
  { key: "photo", label: "Passport photo" },
  { key: "aadhaar", label: "Aadhaar" },
  { key: "pan", label: "PAN card" },
  { key: "addressProof", label: "Address proof" },
  { key: "educationCert", label: "Education certificates" },
  { key: "experienceCert", label: "Experience / relieving" },
  { key: "medicalCert", label: "Medical fitness" },
  { key: "policeVerification", label: "Police verification" },
  { key: "joiningLetter", label: "Joining letter" },
  { key: "contract", label: "Appointment / contract" },
  { key: "drivingLicense", label: "Driving licence (drivers)" },
  { key: "other", label: "Other document" },
];

export function emptyStaffDocFile(
  status: StaffDocStatus = "missing",
): StaffDocFile {
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

export function staffDocStatusLabel(status: StaffDocStatus): string {
  switch (status) {
    case "pending":
      return "Pending verification";
    case "verified":
      return "Verified";
    case "rejected":
      return "Rejected — re-upload";
    case "received":
      return "Received (HR)";
    default:
      return "Missing";
  }
}

export function emptyStaffDocs(): StaffDocs {
  return {
    photo: emptyStaffDocFile(),
    aadhaar: emptyStaffDocFile(),
    pan: emptyStaffDocFile(),
    addressProof: emptyStaffDocFile(),
    educationCert: emptyStaffDocFile(),
    experienceCert: emptyStaffDocFile(),
    medicalCert: emptyStaffDocFile(),
    policeVerification: emptyStaffDocFile(),
    joiningLetter: emptyStaffDocFile(),
    contract: emptyStaffDocFile(),
    drivingLicense: emptyStaffDocFile(),
    other: emptyStaffDocFile(),
  };
}

function normalizeStaffDocFile(raw: unknown): StaffDocFile {
  if (!raw || typeof raw !== "object") return emptyStaffDocFile();
  const o = raw as Partial<StaffDocFile>;
  const status: StaffDocStatus =
    o.status === "received" ||
    o.status === "verified" ||
    o.status === "missing" ||
    o.status === "pending" ||
    o.status === "rejected"
      ? o.status
      : "missing";
  return {
    status,
    fileName: str(o.fileName),
    mimeType: str(o.mimeType),
    size: typeof o.size === "number" ? o.size : 0,
    fileUrl: typeof o.fileUrl === "string" ? o.fileUrl : "",
    driveFileId: typeof o.driveFileId === "string" ? o.driveFileId : "",
    uploadedAt: str(o.uploadedAt),
    submittedBy: str(o.submittedBy),
    submittedAt: str(o.submittedAt),
    reviewedBy: str(o.reviewedBy),
    reviewedAt: str(o.reviewedAt),
    reviewNote: str(o.reviewNote),
  };
}

export function normalizeStaffDocs(raw: unknown): StaffDocs {
  const base = emptyStaffDocs();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Partial<Record<StaffDocKey, unknown>>;
  for (const { key } of STAFF_DOC_LABELS) {
    base[key] = normalizeStaffDocFile(o[key]);
  }
  return base;
}

export type StaffClassTeacherLink = {
  id: string;
  classId: string;
  sectionId: string;
  academicYearCode: string;
  isPrimary: boolean;
};

export type StaffSubjectTeachingLink = {
  id: string;
  classId: string;
  sectionId: string | null;
  subjectId: string;
  academicYearCode: string;
  periodsPerWeek: number;
};

export type StaffVehicleRole =
  | "driver"
  | "attendant"
  | "conductor"
  | "helper";

export type StaffVehicleLink = {
  id: string;
  routeId: string;
  role: StaffVehicleRole;
  academicYearCode: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type StaffDutyRole =
  | "lab_incharge"
  | "library_incharge"
  | "hostel_warden"
  | "exam_incharge"
  | "sports_incharge"
  | "discipline_incharge"
  | "nurse_incharge"
  | "other";

export type StaffDutyLink = {
  id: string;
  role: StaffDutyRole;
  label: string;
  academicYearCode: string;
  notes: string;
};

export const STAFF_VEHICLE_ROLES: {
  value: StaffVehicleRole;
  label: string;
}[] = [
  { value: "driver", label: "Driver" },
  { value: "attendant", label: "Attendant" },
  { value: "conductor", label: "Conductor" },
  { value: "helper", label: "Helper" },
];

export const STAFF_DUTY_ROLES: { value: StaffDutyRole; label: string }[] = [
  { value: "lab_incharge", label: "Lab in-charge" },
  { value: "library_incharge", label: "Library in-charge" },
  { value: "hostel_warden", label: "Hostel warden" },
  { value: "exam_incharge", label: "Exam in-charge" },
  { value: "sports_incharge", label: "Sports in-charge" },
  { value: "discipline_incharge", label: "Discipline in-charge" },
  { value: "nurse_incharge", label: "Nurse / medical in-charge" },
  { value: "other", label: "Other duty" },
];

/** Which duty mapping UIs apply for this staff (by stream + designation). */
export type StaffDutyCapabilities = {
  classTeacher: boolean;
  subjectTeaching: boolean;
  vehicle: boolean;
  otherDuties: boolean;
  /** Suggested vehicle role when opening vehicle mapping */
  preferredVehicleRole: StaffVehicleRole;
  label: string;
};

function haystack(...parts: (string | null | undefined)[]) {
  return parts
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[_-]+/g, " ");
}

export function staffDutyCapabilities(
  staff: Pick<
    StaffRecord,
    "stream" | "designationId" | "departmentId"
  >,
  masters: {
    designations: Designation[];
    departments: Department[];
  },
): StaffDutyCapabilities {
  const des = masters.designations.find((d) => d.id === staff.designationId);
  const dep = masters.departments.find((d) => d.id === staff.departmentId);
  const text = haystack(des?.code, des?.name, dep?.code, dep?.name);

  const isDriver =
    /\b(drv|driver|bus driver)\b/.test(text) || /\bdriver\b/.test(text);
  const isAttendant =
    /\b(att|attendant|ayah|vehicle attendant|bus attendant)\b/.test(text) &&
    !isDriver;
  const isConductorOrHelper =
    /\b(conductor|bus helper)\b/.test(text) && !isDriver && !isAttendant;
  const isTransportDept = /\b(transport|trans)\b/.test(text);
  const isTransportStaff =
    isDriver ||
    isAttendant ||
    isConductorOrHelper ||
    (isTransportDept && staff.stream === "non_teaching");

  const isTeacherLike =
    staff.stream === "teaching" ||
    /\b(tgt|pgt|prt|pprt|teacher|lecturer|faculty|educator|hm|head.?master|principal|vice.?principal)\b/.test(
      text,
    );

  const isOfficeOrSupport =
    /\b(clerk|admin|accountant|accounts|office|computer operator|co|peon)\b/.test(
      text,
    );

  let preferredVehicleRole: StaffVehicleRole = "driver";
  if (isAttendant) preferredVehicleRole = "attendant";
  else if (/\bconductor\b/.test(text)) preferredVehicleRole = "conductor";
  else if (/\bhelper\b/.test(text)) preferredVehicleRole = "helper";
  else if (isDriver) preferredVehicleRole = "driver";
  else if (isTransportDept) preferredVehicleRole = "attendant";

  // Transport crew: vehicle mapping only (plus other duties if office titles overlap)
  if (isTransportStaff && !isTeacherLike) {
    return {
      classTeacher: false,
      subjectTeaching: false,
      vehicle: true,
      otherDuties: isOfficeOrSupport,
      preferredVehicleRole,
      label: isDriver
        ? "Driver — vehicle / route mapping"
        : isAttendant
          ? "Attendant — vehicle / route mapping"
          : "Transport staff — vehicle / route mapping",
    };
  }

  // Teachers / academic: class + subject
  if (isTeacherLike) {
    return {
      classTeacher: true,
      subjectTeaching: true,
      vehicle: false,
      otherDuties: true,
      preferredVehicleRole: "driver",
      label: "Teaching staff — class teacher & subject mapping",
    };
  }

  // Everyone else: other school duties
  return {
    classTeacher: false,
    subjectTeaching: false,
    vehicle: false,
    otherDuties: true,
    preferredVehicleRole: "driver",
    label: "Staff duties — lab, library, hostel, and other roles",
  };
}

function nidStaff(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeClassTeacherLink(
  raw: Partial<StaffClassTeacherLink>,
): StaffClassTeacherLink | null {
  if (!raw.classId || !raw.sectionId) return null;
  return {
    id: str(raw.id) || nidStaff("sct"),
    classId: str(raw.classId),
    sectionId: str(raw.sectionId),
    academicYearCode: str(raw.academicYearCode),
    isPrimary: raw.isPrimary !== false,
  };
}

function normalizeSubjectTeachingLink(
  raw: Partial<StaffSubjectTeachingLink>,
): StaffSubjectTeachingLink | null {
  if (!raw.classId || !raw.subjectId) return null;
  return {
    id: str(raw.id) || nidStaff("sst"),
    classId: str(raw.classId),
    sectionId: raw.sectionId ? str(raw.sectionId) : null,
    subjectId: str(raw.subjectId),
    academicYearCode: str(raw.academicYearCode),
    periodsPerWeek:
      typeof raw.periodsPerWeek === "number" && raw.periodsPerWeek >= 0
        ? raw.periodsPerWeek
        : 0,
  };
}

function normalizeVehicleLink(
  raw: Partial<StaffVehicleLink>,
): StaffVehicleLink | null {
  if (!raw.routeId) return null;
  const role: StaffVehicleRole =
    raw.role === "attendant" ||
    raw.role === "conductor" ||
    raw.role === "helper"
      ? raw.role
      : "driver";
  return {
    id: str(raw.id) || nidStaff("svh"),
    routeId: str(raw.routeId),
    role,
    academicYearCode: str(raw.academicYearCode),
    effectiveFrom: str(raw.effectiveFrom),
    effectiveTo: raw.effectiveTo ? str(raw.effectiveTo) : null,
  };
}

function normalizeDutyLink(
  raw: Partial<StaffDutyLink>,
): StaffDutyLink | null {
  const role: StaffDutyRole =
    STAFF_DUTY_ROLES.some((r) => r.value === raw.role) && raw.role
      ? (raw.role as StaffDutyRole)
      : "other";
  return {
    id: str(raw.id) || nidStaff("sdy"),
    role,
    label: str(raw.label),
    academicYearCode: str(raw.academicYearCode),
    notes: str(raw.notes),
  };
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

export function staffQrPayload(empCode: string, id: string): string {
  return JSON.stringify({
    type: "bhb_staff",
    empCode: empCode.trim().toUpperCase(),
    id,
  });
}

/** Treat missing/legacy status as active (only explicit inactive is excluded). */
export function isStaffActive(s: Pick<StaffRecord, "status">): boolean {
  return s.status !== "inactive";
}

/** Re-normalize roster rows loaded from localStorage / mirror (fixes legacy status gaps). */
export function normalizeMastersStaffRoster(
  state: MastersState & Partial<FoundationSlice>,
): MastersState & Partial<FoundationSlice> {
  if (!Array.isArray(state.staff) || state.staff.length === 0) return state;
  const needsNorm = state.staff.some(
    (s) => s.status !== "active" && s.status !== "inactive",
  );
  if (!needsNorm) return state;
  return {
    ...state,
    staff: state.staff.map((s) =>
      normalizeStaffRecord({
        ...s,
        id: s.id,
        empCode: s.empCode || "STAFF",
        fullName: s.fullName || s.empCode || "Staff",
      }),
    ),
  };
}

export function normalizeStaffRecord(
  s: Partial<StaffRecord> &
    Pick<StaffRecord, "id" | "empCode" | "fullName">,
): StaffRecord {
  const stream: StaffStream =
    s.stream === "non_teaching" ? "non_teaching" : "teaching";
  const category: StaffCategory =
    s.category === "contract" || s.category === "part_time"
      ? s.category
      : "permanent";
  const gender: StaffGender =
    s.gender === "M" || s.gender === "F" || s.gender === "O" ? s.gender : "";
  const casteRaw = str(s.casteCategory).toUpperCase();
  const casteCategory: StaffCasteCategory =
    casteRaw === "GENERAL" ||
    casteRaw === "OBC" ||
    casteRaw === "SC" ||
    casteRaw === "ST" ||
    casteRaw === "OTHER"
      ? casteRaw
      : "";
  const maritalRaw = str(s.maritalStatus).toLowerCase();
  const maritalStatus: StaffMaritalStatus =
    maritalRaw === "single" ||
    maritalRaw === "married" ||
    maritalRaw === "widowed" ||
    maritalRaw === "other"
      ? maritalRaw
      : "";
  const jobRaw = str(s.jobType).toLowerCase().replace(/[\s-]+/g, "_");
  const jobType: StaffJobType =
    jobRaw === "confirmed" ||
    jobRaw === "probation" ||
    jobRaw === "temporary" ||
    jobRaw === "contract"
      ? jobRaw
      : "";
  const empCode = str(s.empCode).toUpperCase();
  return {
    id: s.id,
    empCode,
    fullName: str(s.fullName),
    stream,
    category,
    jobType,
    departmentId: s.departmentId ?? null,
    designationId: s.designationId ?? null,
    campusId: s.campusId ?? null,
    branchName: str(s.branchName),
    mobile: str(s.mobile),
    altMobile: str(s.altMobile),
    email: str(s.email),
    status: s.status === "inactive" ? "inactive" : "active",
    gender,
    religion: str(s.religion),
    casteCategory,
    dateOfBirth: str(s.dateOfBirth),
    joiningDate: str(s.joiningDate),
    leavingDate: str(s.leavingDate),
    staffAddedOn: str(s.staffAddedOn),
    bloodGroup: str(s.bloodGroup),
    maritalStatus,
    fatherName: str(s.fatherName),
    spouseName: str(s.spouseName),
    nationality: str(s.nationality) || "Indian",
    aadhaarNo: str(s.aadhaarNo),
    panNo: str(s.panNo).toUpperCase(),
    voterId: str(s.voterId).toUpperCase(),
    addressCurrent: str(s.addressCurrent),
    addressPermanent: str(s.addressPermanent),
    city: str(s.city),
    state: str(s.state),
    pincode: str(s.pincode),
    emergencyContactName: str(s.emergencyContactName),
    emergencyContactMobile: str(s.emergencyContactMobile),
    emergencyRelation: str(s.emergencyRelation),
    qualification: str(s.qualification),
    experienceYears: str(s.experienceYears),
    experienceDetail: str(s.experienceDetail),
    experienceDescription: str(s.experienceDescription),
    subjectsTaught: str(s.subjectsTaught),
    biometricId: str(s.biometricId),
    rfidNo: str(s.rfidNo),
    oasisId: str(s.oasisId),
    basicPay: str(s.basicPay),
    photoUrl: typeof s.photoUrl === "string" ? s.photoUrl : "",
    signatureUrl: typeof s.signatureUrl === "string" ? s.signatureUrl : "",
    qrPayload: str(s.qrPayload) || staffQrPayload(empCode, s.id),
    loginUsername: str(s.loginUsername),
    loginPassword: typeof s.loginPassword === "string" ? s.loginPassword : "",
    loginEnabled: s.loginEnabled !== false,
    bankName: str(s.bankName),
    bankBranch: str(s.bankBranch),
    bankAccountNo: str(s.bankAccountNo),
    bankIfsc: str(s.bankIfsc).toUpperCase(),
    bankAccountName: str(s.bankAccountName),
    upiId: str(s.upiId),
    pfNumber: str(s.pfNumber),
    uanNumber: str(s.uanNumber),
    pfJoiningDate: str(s.pfJoiningDate),
    esicNumber: str(s.esicNumber),
    esicDispensary: str(s.esicDispensary),
    remarks: str(s.remarks),
    docs: (() => {
      const docs = normalizeStaffDocs(s.docs);
      if (
        typeof s.photoUrl === "string" &&
        s.photoUrl &&
        !docs.photo.fileUrl
      ) {
        docs.photo = {
          ...emptyStaffDocFile("received"),
          fileUrl: s.photoUrl,
          mimeType: "image/jpeg",
          fileName: "photo.jpg",
          uploadedAt: new Date().toISOString(),
        };
      }
      return docs;
    })(),
    classTeacherLinks: Array.isArray(s.classTeacherLinks)
      ? s.classTeacherLinks
          .map((x) => normalizeClassTeacherLink(x))
          .filter((x): x is StaffClassTeacherLink => !!x)
      : [],
    subjectTeachingLinks: Array.isArray(s.subjectTeachingLinks)
      ? s.subjectTeachingLinks
          .map((x) => normalizeSubjectTeachingLink(x))
          .filter((x): x is StaffSubjectTeachingLink => !!x)
      : [],
    vehicleLinks: Array.isArray(s.vehicleLinks)
      ? s.vehicleLinks
          .map((x) => normalizeVehicleLink(x))
          .filter((x): x is StaffVehicleLink => !!x)
      : [],
    dutyLinks: Array.isArray(s.dutyLinks)
      ? s.dutyLinks
          .map((x) => normalizeDutyLink(x))
          .filter((x): x is StaffDutyLink => !!x)
      : [],
  };
}

export function emptyStaffDraft(
  partial?: Partial<StaffRecord> & { id?: string },
): StaffRecord {
  const id = partial?.id ?? newFoundationId("stf");
  return normalizeStaffRecord({
    id,
    empCode: "",
    fullName: "",
    ...partial,
  });
}

export type CompletenessItem = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  tab?: string;
};

export type FoundationSlice = {
  schoolProfile: SchoolProfile;
  statutoryConfig: StatutoryEstablishmentConfig;
  /** Shared school day hours — default + class-group / class overrides */
  schoolTiming: SchoolTimingConfig;
  academicYears: AcademicYearMaster[];
  academicTerms: AcademicTerm[];
  subjects: Subject[];
  classSubjects: ClassSubjectLink[];
  /** XI–XII stream packages (Science / Commerce / Humanities / NEP flexible) */
  seniorStreams: SeniorStream[];
  numberSeries: NumberSeries[];
  holidays: Holiday[];
  departments: Department[];
  designations: Designation[];
  staff: StaffRecord[];
};

/** Higher secondary stream / pathway (Grades XI–XII). */
export type SeniorStream = {
  id: string;
  code: string;
  nameEn: string;
  /** Traditional label shown to parents (Science / Commerce / Arts) */
  traditionalLabel: string;
  /** NEP/NCF note — choice across groups, not hard walls */
  nepNote: string;
  grades: ("XI" | "XII")[];
  /** Subject codes typically in this package */
  coreCodes: string[];
  electiveCodes: string[];
  isActive: boolean;
  sortOrder: number;
};

export function normalizeSeniorStream(
  s: Partial<SeniorStream> & Pick<SeniorStream, "id" | "code" | "nameEn">,
): SeniorStream {
  return {
    id: s.id,
    code: s.code,
    nameEn: s.nameEn,
    traditionalLabel: s.traditionalLabel ?? s.nameEn,
    nepNote: s.nepNote ?? "",
    grades: s.grades?.length ? s.grades : ["XI", "XII"],
    coreCodes: s.coreCodes ?? [],
    electiveCodes: s.electiveCodes ?? [],
    isActive: s.isActive ?? true,
    sortOrder: s.sortOrder ?? 0,
  };
}

export function defaultSeniorStreams(): SeniorStream[] {
  return [
    {
      id: nid("stm"),
      code: "SCI_PCM",
      nameEn: "Science — PCM",
      traditionalLabel: "Science",
      nepNote:
        "NCF Group 4 emphasis (Science, Maths, CT). Students may still add Art / PE / Vocational / Humanities electives.",
      grades: ["XI", "XII"],
      coreCodes: ["ENG", "PHY", "CHE", "MAT"],
      electiveCodes: ["CT", "PEW", "VOC", "ART"],
      isActive: true,
      sortOrder: 1,
    },
    {
      id: nid("stm"),
      code: "SCI_PCB",
      nameEn: "Science — PCB",
      traditionalLabel: "Science",
      nepNote:
        "Physics, Chemistry, Biology pathway. Keep multidisciplinary electives open per NEP.",
      grades: ["XI", "XII"],
      coreCodes: ["ENG", "PHY", "CHE", "BIO"],
      electiveCodes: ["MAT", "CT", "PEW", "VOC", "PSY"],
      isActive: true,
      sortOrder: 2,
    },
    {
      id: nid("stm"),
      code: "COMM",
      nameEn: "Commerce",
      traditionalLabel: "Commerce",
      nepNote:
        "Accountancy, Business Studies, Economics — may mix with Maths / CT / Humanities under NEP choice.",
      grades: ["XI", "XII"],
      coreCodes: ["ENG", "ACC", "BST", "ECO"],
      electiveCodes: ["MAT", "APP-MAT", "CT", "PEW", "ART", "VOC"],
      isActive: true,
      sortOrder: 3,
    },
    {
      id: nid("stm"),
      code: "HUM",
      nameEn: "Humanities / Arts",
      traditionalLabel: "Arts / Humanities",
      nepNote:
        "NCF Group 3 (Social Science, Humanities, Interdisciplinary). Can combine with Science / Maths electives.",
      grades: ["XI", "XII"],
      coreCodes: ["ENG", "HIS", "GEO", "POL"],
      electiveCodes: ["ECO", "PSY", "SOC", "ART", "PEW", "VOC", "HIN", "SKT"],
      isActive: true,
      sortOrder: 4,
    },
    {
      id: nid("stm"),
      code: "MULTI",
      nameEn: "Multidisciplinary (optional)",
      traditionalLabel: "Flexible / NEP",
      nepNote:
        "Optional pathway — only if the school allows free choice across groups. Most CBSE schools still enrol students in Science / Commerce / Humanities packages below.",
      grades: ["XI", "XII"],
      coreCodes: ["ENG", "HIN"],
      electiveCodes: [
        "PHY",
        "CHE",
        "BIO",
        "MAT",
        "APP-MAT",
        "CT",
        "HIS",
        "GEO",
        "POL",
        "ECO",
        "ACC",
        "BST",
        "PSY",
        "SOC",
        "ART",
        "PEW",
        "VOC",
        "SKT",
      ],
      isActive: false,
      sortOrder: 5,
    },
  ];
}

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function defaultSchoolProfile(): SchoolProfile {
  return {
    legalName: TENANT.name,
    displayName: TENANT.nameDisplay,
    shortName: TENANT.shortName,
    tagline: TENANT.tagline,
    udiseCode: "",
    boardMode: (TENANT.boardMode as BoardMode) || "DUAL",
    affiliationNo: TENANT.affiliationNo,
    schoolCode: TENANT.schoolCode,
    address: TENANT.schoolAddress,
    city: TENANT.city,
    state: TENANT.state,
    pincode: "221202",
    phone: "",
    mobile: "",
    whatsapp: "",
    email: `office@${TENANT.domain.replace(/^erp\./, "")}`,
    website: `https://${TENANT.domain.replace(/^erp\./, "")}`,
    facebook: "",
    instagram: "",
    google: "",
    youtube: "",
    logoUrl: TENANT.logoUrl,
    faviconUrl: "",
    watermarkUrl: "",
    pageBackgroundUrl: "",
    pageBackgroundSchoolNameRepeat: false,
    directorSignatureUrl: "",
    principalStampSignatureUrl: "",
    directorStampSignatureUrl: "",
    collectionsUpiVpa: "bhbschool@upi",
  };
}

export function defaultStatutoryConfig(): StatutoryEstablishmentConfig {
  return {
    epfEstablishmentId: "",
    epfLin: "",
    epfContributionRatePct: 12,
    applyEpfWageCeiling: true,
    epfWageCeiling: 15000,
    esicEmployerCode: "",
    esicWageCeiling: 21000,
    esicEmployeeExemptWageLimit: 5000,
    esicEmployeeRatePct: 0.75,
    esicEmployerRatePct: 3.25,
    penalty: {
      interestRatePctPerAnnum: 12,
      damageSlabs: [
        { maxDelayDays: 60, ratePctPerAnnum: 5 },
        { maxDelayDays: 120, ratePctPerAnnum: 10 },
        { maxDelayDays: 180, ratePctPerAnnum: 15 },
        { maxDelayDays: 999999, ratePctPerAnnum: 25 },
      ],
      esicInterestRatePctPerAnnum: 12,
      esicDamageSlabs: [
        { maxDelayDays: 60, ratePctPerAnnum: 5 },
        { maxDelayDays: 120, ratePctPerAnnum: 10 },
        { maxDelayDays: 180, ratePctPerAnnum: 15 },
        { maxDelayDays: 999999, ratePctPerAnnum: 25 },
      ],
      circularNote:
        "Default slabs — confirm current rates against the latest EPFO/ESIC circular before relying on the estimate.",
    },
  };
}

export function defaultFoundationSlice(classes: SchoolClass[]): FoundationSlice {
  const ayId = nid("ay");
  const academicYears: AcademicYearMaster[] = [
    {
      id: ayId,
      code: "2025-26",
      label: "2025-26",
      startsOn: "2025-04-01",
      endsOn: "2026-03-31",
      status: "current",
      isActive: true,
    },
    {
      id: nid("ay"),
      code: "2024-25",
      label: "2024-25",
      startsOn: "2024-04-01",
      endsOn: "2025-03-31",
      status: "closed",
      isActive: true,
    },
  ];

  const academicTerms: AcademicTerm[] = [
    {
      id: nid("trm"),
      academicYearCode: "2025-26",
      code: "T1",
      label: "Term 1 / Half-yearly",
      startsOn: "2025-04-01",
      endsOn: "2025-09-30",
      sortOrder: 1,
    },
    {
      id: nid("trm"),
      academicYearCode: "2025-26",
      code: "T2",
      label: "Term 2 / Final",
      startsOn: "2025-10-01",
      endsOn: "2026-03-31",
      sortOrder: 2,
    },
  ];

  const engId = nid("sub");
  const hinId = nid("sub");
  const subjects: Subject[] = [
    {
      id: engId,
      code: "ENG",
      nameEn: "English",
      category: "scholastic",
      coScholasticArea: "",
      parentId: null,
      isElective: false,
      isActive: true,
      sortOrder: 1,
    },
    {
      id: nid("sub"),
      code: "ENG-ORAL",
      nameEn: "English — Oral",
      category: "scholastic",
      coScholasticArea: "",
      parentId: engId,
      isElective: false,
      isActive: true,
      sortOrder: 1,
    },
    {
      id: nid("sub"),
      code: "ENG-WRIT",
      nameEn: "English — Written",
      category: "scholastic",
      coScholasticArea: "",
      parentId: engId,
      isElective: false,
      isActive: true,
      sortOrder: 2,
    },
    {
      id: hinId,
      code: "HIN",
      nameEn: "Hindi",
      category: "scholastic",
      coScholasticArea: "",
      parentId: null,
      isElective: false,
      isActive: true,
      sortOrder: 2,
    },
    {
      id: nid("sub"),
      code: "HIN-ORAL",
      nameEn: "Hindi — Oral",
      category: "scholastic",
      coScholasticArea: "",
      parentId: hinId,
      isElective: false,
      isActive: true,
      sortOrder: 1,
    },
    {
      id: nid("sub"),
      code: "HIN-WRIT",
      nameEn: "Hindi — Written",
      category: "scholastic",
      coScholasticArea: "",
      parentId: hinId,
      isElective: false,
      isActive: true,
      sortOrder: 2,
    },
    {
      id: nid("sub"),
      code: "MAT",
      nameEn: "Mathematics",
      category: "scholastic",
      coScholasticArea: "",
      parentId: null,
      isElective: false,
      isActive: true,
      sortOrder: 3,
    },
    {
      id: nid("sub"),
      code: "SCI",
      nameEn: "Science",
      category: "scholastic",
      coScholasticArea: "",
      parentId: null,
      isElective: false,
      isActive: true,
      sortOrder: 4,
    },
    {
      id: nid("sub"),
      code: "SST",
      nameEn: "Social Science",
      category: "scholastic",
      coScholasticArea: "",
      parentId: null,
      isElective: false,
      isActive: true,
      sortOrder: 5,
    },
    {
      id: nid("sub"),
      code: "WE",
      nameEn: "Work Education",
      category: "co_scholastic",
      coScholasticArea: "Work Education",
      parentId: null,
      isElective: false,
      isActive: true,
      sortOrder: 10,
    },
    {
      id: nid("sub"),
      code: "ART",
      nameEn: "Art Education",
      category: "co_scholastic",
      coScholasticArea: "Art Education",
      parentId: null,
      isElective: false,
      isActive: true,
      sortOrder: 11,
    },
    {
      id: nid("sub"),
      code: "HPE",
      nameEn: "Health & Physical Education",
      category: "co_scholastic",
      coScholasticArea: "HPE",
      parentId: null,
      isElective: false,
      isActive: true,
      sortOrder: 12,
    },
  ].map((s) =>
    normalizeSubject({
      ...s,
      category: s.category as SubjectCategory,
    }),
  );

  const mid = classes.filter((c) =>
    ["VI", "VII", "VIII"].includes(c.name),
  );
  const classSubjects: ClassSubjectLink[] = [];
  const mapSubjects = subjects.filter((s) => {
    if (s.category !== "scholastic" || !s.isActive) return false;
    // Prefer components + standalone; skip group heads that have children
    const hasKids = subjects.some((c) => c.parentId === s.id);
    return s.parentId != null || !hasKids;
  });
  for (const cls of mid.length ? mid : classes.slice(0, 3)) {
    for (const sub of mapSubjects) {
      classSubjects.push({
        id: nid("csub"),
        classId: cls.id,
        subjectId: sub.id,
        periodsPerWeek:
          sub.code.startsWith("ENG") || sub.code.startsWith("MAT") ? 6 : 5,
        isActive: true,
      });
    }
  }

  const numberSeries: NumberSeries[] = [
    {
      id: nid("ns"),
      code: "ADMISSION",
      label: "Admission number",
      prefix: "BHB-",
      nextNumber: 1001,
      padWidth: 4,
      resetOnAy: false,
      includeSessionInPrefix: false,
    },
    {
      id: nid("ns"),
      code: "REGISTRATION",
      label: "Registration number",
      prefix: "REG-",
      nextNumber: 1,
      padWidth: 4,
      resetOnAy: false,
      includeSessionInPrefix: false,
    },
    {
      id: nid("ns"),
      code: "RECEIPT",
      label: "Fee receipt",
      prefix: "RCV-",
      nextNumber: 1,
      padWidth: 5,
      resetOnAy: false,
      includeSessionInPrefix: false,
    },
    {
      id: nid("ns"),
      code: "SRN",
      label: "Scholar register (SRN)",
      prefix: "SRN-",
      nextNumber: 1,
      padWidth: 5,
      resetOnAy: false,
      includeSessionInPrefix: false,
    },
    {
      id: nid("ns"),
      code: "TC",
      label: "Transfer certificate",
      prefix: "TC-",
      nextNumber: 1,
      padWidth: 4,
      resetOnAy: false,
      includeSessionInPrefix: false,
    },
    {
      id: nid("ns"),
      code: "CERT_BONAFIDE",
      label: "Bonafide certificate",
      prefix: "BNF-",
      nextNumber: 1,
      padWidth: 4,
      resetOnAy: false,
      includeSessionInPrefix: false,
    },
    {
      id: nid("ns"),
      code: "CERT_CHARACTER",
      label: "Character certificate",
      prefix: "CHR-",
      nextNumber: 1,
      padWidth: 4,
      resetOnAy: false,
      includeSessionInPrefix: false,
    },
    {
      id: nid("ns"),
      code: "CERT_CLEARANCE",
      label: "Fee clearance / no-dues",
      prefix: "ND-",
      nextNumber: 1,
      padWidth: 4,
      resetOnAy: false,
      includeSessionInPrefix: false,
    },
    {
      id: nid("ns"),
      code: "CERT_FEES_PAID",
      label: "Fees paid certificate",
      prefix: "FEE-",
      nextNumber: 1,
      padWidth: 4,
      resetOnAy: false,
      includeSessionInPrefix: false,
    },
    {
      id: nid("ns"),
      code: "STAFF_AGREEMENT",
      label: "Staff employment agreement",
      prefix: "AGR-",
      nextNumber: 1,
      padWidth: 4,
      resetOnAy: false,
      includeSessionInPrefix: false,
    },
    {
      id: nid("ns"),
      code: "STAFF_ID",
      label: "Staff ID",
      prefix: "EMP-",
      nextNumber: 1,
      padWidth: 4,
      resetOnAy: false,
      includeSessionInPrefix: false,
    },
    {
      id: nid("ns"),
      code: "EXPENSE_VOUCHER",
      label: "Expense voucher",
      prefix: "EXP-",
      nextNumber: 1,
      padWidth: 5,
      resetOnAy: false,
      includeSessionInPrefix: false,
    },
  ];

  const holidays: Holiday[] = [
    normalizeHoliday({
      id: nid("hol"),
      academicYearCode: FOUNDATION_DEFAULT_AY,
      title: "Independence Day",
      startsOn: "2025-08-15",
      endsOn: "2025-08-15",
      kind: "gazetted",
      scope: "school",
      mode: "one_off",
      dayType: "full",
      paidForStaff: true,
      isPublished: true,
      publishedAt: new Date().toISOString(),
      publishedBy: "System",
      note: "",
    }),
    normalizeHoliday({
      id: nid("hol"),
      academicYearCode: FOUNDATION_DEFAULT_AY,
      title: "Diwali break",
      startsOn: "2025-10-20",
      endsOn: "2025-10-24",
      kind: "school",
      scope: "school",
      mode: "one_off",
      dayType: "full",
      paidForStaff: true,
      isPublished: false,
      publishedAt: null,
      publishedBy: "",
      note: "Draft — publish when confirmed",
    }),
    normalizeHoliday({
      id: nid("hol"),
      academicYearCode: FOUNDATION_DEFAULT_AY,
      title: "Primary Saturday off",
      startsOn: "2025-04-01",
      endsOn: "2026-03-31",
      kind: "school",
      scope: "class_group",
      groupCode: "PRIMARY",
      appliesTo: "students",
      mode: "weekly",
      weekday: 6,
      dayType: "full",
      paidForStaff: false,
      isPublished: false,
      publishedAt: null,
      publishedBy: "",
      note: "Draft weekly rule — publish when confirmed",
    }),
  ];

  const departments: Department[] = [
    { id: nid("dep"), code: "TEACH", name: "Teaching", isActive: true },
    { id: nid("dep"), code: "ACAD", name: "Academic", isActive: true },
    { id: nid("dep"), code: "ADMIN", name: "Admin", isActive: true },
    { id: nid("dep"), code: "MGMT", name: "Management", isActive: true },
    { id: nid("dep"), code: "SPORT", name: "Sports", isActive: true },
    { id: nid("dep"), code: "TRANS", name: "Transport", isActive: true },
  ];

  const designations: Designation[] = [
    {
      id: nid("des"),
      code: "PRIN",
      name: "Principal",
      departmentId: departments[3]!.id,
      isActive: true,
    },
    {
      id: nid("des"),
      code: "TGT",
      name: "TGT",
      departmentId: departments[0]!.id,
      isActive: true,
    },
    {
      id: nid("des"),
      code: "PGT",
      name: "PGT",
      departmentId: departments[0]!.id,
      isActive: true,
    },
    {
      id: nid("des"),
      code: "PRT",
      name: "PRT",
      departmentId: departments[1]!.id,
      isActive: true,
    },
    {
      id: nid("des"),
      code: "CLK",
      name: "Clerk",
      departmentId: departments[2]!.id,
      isActive: true,
    },
    {
      id: nid("des"),
      code: "PEON",
      name: "Peon",
      departmentId: departments[2]!.id,
      isActive: true,
    },
    {
      id: nid("des"),
      code: "DRV",
      name: "Driver",
      departmentId: departments[5]!.id,
      isActive: true,
    },
    {
      id: nid("des"),
      code: "CO",
      name: "Computer Operator",
      departmentId: departments[2]!.id,
      isActive: true,
    },
  ];

  const staff: StaffRecord[] = [
    normalizeStaffRecord({
      id: nid("stf"),
      empCode: "EMP-001",
      fullName: "Priya Sharma",
      stream: "non_teaching",
      category: "permanent",
      departmentId: departments[2]!.id,
      designationId: designations[4]!.id,
      mobile: "9800000001",
      status: "active",
      gender: "F",
      religion: "Hindu",
      casteCategory: "GENERAL",
      email: "priya.sharma@school.in",
      joiningDate: "2019-04-01",
      loginUsername: "priya.sharma",
    }),
    normalizeStaffRecord({
      id: nid("stf"),
      empCode: "EMP-002",
      fullName: "Anil Kumar",
      stream: "teaching",
      category: "permanent",
      departmentId: departments[0]!.id,
      designationId: designations[1]!.id,
      mobile: "9800000002",
      status: "active",
      gender: "M",
      religion: "Hindu",
      casteCategory: "OBC",
      email: "anil.kumar@school.in",
      joiningDate: "2018-07-15",
      subjectsTaught: "Mathematics, Science",
      loginUsername: "anil.kumar",
    }),
    normalizeStaffRecord({
      id: nid("stf"),
      empCode: "EMP-003",
      fullName: "Sunita Verma",
      stream: "teaching",
      category: "permanent",
      departmentId: departments[0]!.id,
      designationId: designations[2]!.id,
      mobile: "9800000003",
      status: "active",
      gender: "F",
      religion: "Hindu",
      casteCategory: "GENERAL",
      joiningDate: "2020-04-01",
      subjectsTaught: "English, SST",
    }),
    normalizeStaffRecord({
      id: nid("stf"),
      empCode: "EMP-004",
      fullName: "Rakesh Yadav",
      stream: "non_teaching",
      category: "permanent",
      departmentId: departments[5]!.id,
      designationId: designations[6]!.id,
      mobile: "9800000004",
      status: "active",
      gender: "M",
      religion: "Hindu",
      casteCategory: "OBC",
    }),
    normalizeStaffRecord({
      id: nid("stf"),
      empCode: "EMP-005",
      fullName: "Meena Gupta",
      stream: "teaching",
      category: "contract",
      departmentId: departments[1]!.id,
      designationId: designations[3]!.id,
      mobile: "9800000005",
      status: "active",
      gender: "F",
      religion: "Hindu",
      casteCategory: "GENERAL",
    }),
    normalizeStaffRecord({
      id: nid("stf"),
      empCode: "EMP-006",
      fullName: "Imran Ali",
      stream: "teaching",
      category: "permanent",
      departmentId: departments[0]!.id,
      designationId: designations[1]!.id,
      mobile: "9800000006",
      status: "inactive",
      gender: "M",
      religion: "Muslim",
      casteCategory: "GENERAL",
    }),
    normalizeStaffRecord({
      id: nid("stf"),
      empCode: "EMP-007",
      fullName: "Suresh Das",
      stream: "non_teaching",
      category: "permanent",
      departmentId: departments[2]!.id,
      designationId: designations[5]!.id,
      mobile: "9800000007",
      status: "active",
      gender: "M",
      religion: "Hindu",
      casteCategory: "SC",
    }),
    normalizeStaffRecord({
      id: nid("stf"),
      empCode: "EMP-008",
      fullName: "Neha Singh",
      stream: "teaching",
      category: "permanent",
      departmentId: departments[4]!.id,
      designationId: designations[1]!.id,
      mobile: "9800000008",
      status: "active",
      gender: "F",
      religion: "Sikh",
      casteCategory: "GENERAL",
    }),
    normalizeStaffRecord({
      id: nid("stf"),
      empCode: "EMP-009",
      fullName: "Vikram Joshi",
      stream: "non_teaching",
      category: "permanent",
      departmentId: departments[3]!.id,
      designationId: designations[0]!.id,
      mobile: "9800000009",
      status: "active",
      gender: "M",
      religion: "Hindu",
      casteCategory: "GENERAL",
    }),
    normalizeStaffRecord({
      id: nid("stf"),
      empCode: "EMP-010",
      fullName: "Kavita Devi",
      stream: "non_teaching",
      category: "part_time",
      departmentId: departments[2]!.id,
      designationId: designations[7]!.id,
      mobile: "9800000010",
      status: "inactive",
      gender: "F",
      religion: "Hindu",
      casteCategory: "ST",
    }),
  ];

  return {
    schoolProfile: defaultSchoolProfile(),
    statutoryConfig: defaultStatutoryConfig(),
    schoolTiming: defaultSchoolTimingConfig(),
    academicYears,
    academicTerms,
    subjects,
    classSubjects,
    seniorStreams: defaultSeniorStreams(),
    numberSeries,
    holidays,
    departments,
    designations,
    staff,
  };
}

export function normalizeSchoolProfile(
  p?: Partial<SchoolProfile> | null,
): SchoolProfile {
  const d = defaultSchoolProfile();
  return {
    legalName: p?.legalName ?? d.legalName,
    displayName: p?.displayName ?? d.displayName,
    shortName: p?.shortName ?? d.shortName,
    tagline: p?.tagline ?? d.tagline,
    udiseCode: p?.udiseCode ?? "",
    boardMode: (p?.boardMode as BoardMode) || d.boardMode,
    affiliationNo: p?.affiliationNo ?? d.affiliationNo,
    schoolCode: p?.schoolCode ?? d.schoolCode,
    address: p?.address ?? d.address,
    city: p?.city ?? d.city,
    state: p?.state ?? d.state,
    pincode: p?.pincode ?? d.pincode,
    phone: p?.phone ?? "",
    mobile: p?.mobile ?? "",
    whatsapp: p?.whatsapp ?? "",
    email: p?.email ?? d.email,
    website: p?.website ?? d.website,
    facebook: p?.facebook ?? "",
    instagram: p?.instagram ?? "",
    google: p?.google ?? "",
    youtube: p?.youtube ?? "",
    logoUrl: p?.logoUrl ?? d.logoUrl,
    faviconUrl: p?.faviconUrl ?? "",
    watermarkUrl: p?.watermarkUrl ?? "",
    pageBackgroundUrl: p?.pageBackgroundUrl ?? "",
    pageBackgroundSchoolNameRepeat: p?.pageBackgroundSchoolNameRepeat ?? false,
    directorSignatureUrl: p?.directorSignatureUrl ?? "",
    principalStampSignatureUrl: p?.principalStampSignatureUrl ?? "",
    directorStampSignatureUrl: p?.directorStampSignatureUrl ?? "",
    collectionsUpiVpa: (p?.collectionsUpiVpa || d.collectionsUpiVpa || "bhbschool@upi")
      .trim()
      .toLowerCase(),
  };
}

function normalizePenaltySlabs(
  raw: unknown,
  fallback: StatutoryPenaltySlab[],
): StatutoryPenaltySlab[] {
  if (!Array.isArray(raw) || raw.length === 0) return fallback;
  return raw
    .map((s) => ({
      maxDelayDays: Number((s as StatutoryPenaltySlab)?.maxDelayDays) || 0,
      ratePctPerAnnum: Number((s as StatutoryPenaltySlab)?.ratePctPerAnnum) || 0,
    }))
    .filter((s) => s.maxDelayDays > 0);
}

export function normalizeStatutoryConfig(
  p?: Partial<StatutoryEstablishmentConfig> | null,
): StatutoryEstablishmentConfig {
  const d = defaultStatutoryConfig();
  return {
    epfEstablishmentId: (p?.epfEstablishmentId ?? "").trim(),
    epfLin: (p?.epfLin ?? "").trim(),
    epfContributionRatePct:
      Number(p?.epfContributionRatePct) || d.epfContributionRatePct,
    applyEpfWageCeiling: p?.applyEpfWageCeiling ?? d.applyEpfWageCeiling,
    epfWageCeiling: Number(p?.epfWageCeiling) || d.epfWageCeiling,
    esicEmployerCode: (p?.esicEmployerCode ?? "").trim(),
    esicWageCeiling: Number(p?.esicWageCeiling) || d.esicWageCeiling,
    esicEmployeeExemptWageLimit:
      p?.esicEmployeeExemptWageLimit === undefined || p?.esicEmployeeExemptWageLimit === null
        ? d.esicEmployeeExemptWageLimit
        : Math.max(0, Number(p.esicEmployeeExemptWageLimit) || 0),
    esicEmployeeRatePct:
      Number(p?.esicEmployeeRatePct) || d.esicEmployeeRatePct,
    esicEmployerRatePct:
      Number(p?.esicEmployerRatePct) || d.esicEmployerRatePct,
    penalty: {
      interestRatePctPerAnnum:
        Number(p?.penalty?.interestRatePctPerAnnum) ||
        d.penalty.interestRatePctPerAnnum,
      damageSlabs: normalizePenaltySlabs(
        p?.penalty?.damageSlabs,
        d.penalty.damageSlabs,
      ),
      esicInterestRatePctPerAnnum:
        Number(p?.penalty?.esicInterestRatePctPerAnnum) ||
        d.penalty.esicInterestRatePctPerAnnum,
      esicDamageSlabs: normalizePenaltySlabs(
        p?.penalty?.esicDamageSlabs,
        d.penalty.esicDamageSlabs,
      ),
      circularNote: p?.penalty?.circularNote ?? d.penalty.circularNote,
    },
  };
}

export function ensureFoundationOnMasters(state: MastersState): MastersState {
  const seed = defaultFoundationSlice(state.classes ?? []);
  const partial = state as MastersState & Partial<FoundationSlice>;
  const classIds = new Set((state.classes ?? []).map((c) => c.id));
  const classSubjects = (
    partial.classSubjects?.length ? partial.classSubjects : seed.classSubjects
  ).filter((l) => classIds.has(l.classId));
  return {
    ...state,
    schoolProfile: normalizeSchoolProfile(partial.schoolProfile),
    statutoryConfig: normalizeStatutoryConfig(partial.statutoryConfig),
    schoolTiming: normalizeSchoolTimingConfig(partial.schoolTiming),
    academicYears: partial.academicYears?.length
      ? partial.academicYears
      : seed.academicYears,
    academicTerms: partial.academicTerms?.length
      ? partial.academicTerms
      : seed.academicTerms,
    subjects: ensureSubjectGroups(
      partial.subjects?.length ? partial.subjects : seed.subjects,
    ),
    classSubjects,
    seniorStreams: (() => {
      const raw = partial.seniorStreams;
      if (raw?.length) {
        return raw.map((s) => {
          const n = normalizeSeniorStream(s);
          if (n.code.toUpperCase() !== "MULTI") return n;
          const legacyName =
            /NEP flexible|Multidisciplinary \(NEP/i.test(n.nameEn) ||
            n.nameEn.trim() === "Multidisciplinary";
          if (!legacyName) return n;
          return {
            ...n,
            nameEn: "Multidisciplinary (optional)",
            nepNote:
              "Optional pathway — only if the school allows free choice across groups. Most CBSE schools still enrol students in Science / Commerce / Humanities packages.",
            isActive: false,
          };
        });
      }
      return seed.seniorStreams;
    })(),
    numberSeries: mergeNumberSeries(partial.numberSeries, seed.numberSeries),
    holidays: (
      Array.isArray(partial.holidays) ? partial.holidays : seed.holidays
    ).map((h) =>
      normalizeHoliday({
        ...h,
        academicYearCode: h.academicYearCode || FOUNDATION_DEFAULT_AY,
        title: h.title || "Holiday",
        startsOn: h.startsOn || "",
        id: h.id,
      }),
    ),
    departments: partial.departments?.length
      ? partial.departments
      : seed.departments,
    designations: partial.designations?.length
      ? partial.designations
      : seed.designations,
    staff: (Array.isArray(partial.staff) ? partial.staff : seed.staff).map(
      (s) => normalizeStaffRecord(s),
    ),
  };
}

export function mastersCompleteness(
  state: MastersState & Partial<FoundationSlice>,
): {
  percent: number;
  items: CompletenessItem[];
  okCount: number;
  total: number;
} {
  const profile = normalizeSchoolProfile(state.schoolProfile);
  const feePublished = (state.feeGroups ?? []).some(
    (g) => g.isActive && g.structurePublishedAt,
  );
  const subjectsN = (state.subjects ?? []).filter((s) => s.isActive).length;
  const mapN = (state.classSubjects ?? []).filter((l) => l.isActive).length;
  const publishedHolidays = (state.holidays ?? []).filter(
    (h) => h.isPublished,
  ).length;
  const staffN = (state.staff ?? []).filter(isStaffActive).length;
  const deptN = (state.departments ?? []).filter((d) => d.isActive).length;
  const desN = (state.designations ?? []).filter((d) => d.isActive).length;
  const seriesN = (state.numberSeries ?? []).length;
  const ayOk = (state.academicYears ?? []).some((y) => y.status === "current");

  const items: CompletenessItem[] = [
    {
      id: "udise",
      label: "UDISE code",
      ok: profile.udiseCode.trim().length >= 8,
      detail: profile.udiseCode || "Missing — set on School profile",
      tab: "school",
    },
    {
      id: "affiliation",
      label: "Board / affiliation",
      ok: !!profile.boardMode && !!profile.affiliationNo.trim(),
      detail: `${profile.boardMode} · ${profile.affiliationNo || "no affiliation no."}`,
      tab: "school",
    },
    {
      id: "ay",
      label: "Current academic year",
      ok: ayOk,
      detail: ayOk ? "Current year set" : "Add a current academic year",
      tab: "academic",
    },
    {
      id: "classes",
      label: "Classes & sections",
      ok: (state.classes?.length ?? 0) > 0 && (state.sections?.length ?? 0) > 0,
      detail: `${state.classes?.length ?? 0} classes · ${state.sections?.length ?? 0} sections`,
      tab: "classes",
    },
    {
      id: "subjects",
      label: "Subjects",
      ok: subjectsN >= 3,
      detail: `${subjectsN} active subject(s)`,
      tab: "subjects",
    },
    {
      id: "class-subjects",
      label: "Class–subject map",
      ok: mapN >= 3,
      detail: `${mapN} link(s)`,
      tab: "subjects",
    },
    {
      id: "fee-heads",
      label: "Fee heads",
      ok: (state.feeHeads?.filter((h) => h.isActive).length ?? 0) >= 3,
      detail: `${state.feeHeads?.filter((h) => h.isActive).length ?? 0} heads`,
      tab: "fee-heads",
    },
    {
      id: "fee-publish",
      label: "Fee structure published",
      ok: feePublished,
      detail: feePublished
        ? "At least one group published for Fee Take"
        : "Publish a fee group structure",
      tab: "fee-structure",
    },
    {
      id: "series",
      label: "Numbering series",
      ok: seriesN >= 5,
      detail: `${seriesN} series`,
      tab: "series",
    },
    {
      id: "streams",
      label: "XI–XII streams",
      ok: (state.seniorStreams?.filter((s) => s.isActive).length ?? 0) >= 3,
      detail: `${state.seniorStreams?.filter((s) => s.isActive).length ?? 0} stream(s)`,
      tab: "subjects",
    },
    {
      id: "holidays",
      label: "Published holidays",
      ok: publishedHolidays >= 1,
      detail: `${publishedHolidays} published`,
      tab: "holidays",
    },
    {
      id: "staff-setup",
      label: "Staff setup (depts / designations)",
      ok: deptN >= 1 && desN >= 1,
      detail: `${deptN} department(s) · ${desN} designation(s)`,
      tab: "staff",
    },
    {
      id: "staff",
      label: "Staff roster (Staff module)",
      ok: staffN >= 1,
      detail:
        staffN >= 1
          ? `${staffN} active — manage in Staff module`
          : "Add employees in Staff module (/staff)",
    },
    {
      id: "mid-year",
      label: "Mid-year fee policy",
      ok: !!state.midYearFeePolicy,
      detail: "Configured",
      tab: "mid-year",
    },
  ];

  const okCount = items.filter((i) => i.ok).length;
  const total = items.length;
  const percent = Math.round((okCount / total) * 100);
  return { percent, items, okCount, total };
}

/**
 * School-wide published holiday on date (legacy helper).
 * Prefer classifyHolidayDay / classifyClassHolidayDay for scoped rules.
 */
export function isPublishedHoliday(
  state: MastersState & Partial<FoundationSlice>,
  isoDate: string,
  academicYearCode = FOUNDATION_DEFAULT_AY,
): Holiday | null {
  const d = isoDate.slice(0, 10);
  for (const h of state.holidays ?? []) {
    if (!h.isPublished) continue;
    if (h.academicYearCode !== academicYearCode) continue;
    if ((h.scope || "school") !== "school") continue;
    if (h.workingOverride) continue;
    const applies = h.appliesTo || "everyone";
    if (
      applies === "staff_all" ||
      applies === "staff_teaching" ||
      applies === "staff_non_teaching"
    ) {
      continue; // staff-only — not a student holiday
    }
    const mode = h.mode || "one_off";
    if (mode === "weekly") {
      if (d < h.startsOn || d > h.endsOn) continue;
      if ((h.exceptionDates ?? []).includes(d)) continue;
      const wd = typeof h.weekday === "number" ? h.weekday : null;
      if (wd == null) continue;
      if (new Date(`${d}T12:00:00`).getDay() !== wd) continue;
      return h;
    }
    if (d >= h.startsOn && d <= h.endsOn) return h;
  }
  return null;
}

export const BOARD_MODES: { value: BoardMode; label: string }[] = [
  { value: "CBSE", label: "CBSE" },
  { value: "UP_STATE", label: "UP State" },
  { value: "DUAL", label: "Dual (UP + CBSE path)" },
];

export const HOLIDAY_KINDS: { value: HolidayKind; label: string }[] = [
  { value: "gazetted", label: "Gazetted" },
  { value: "national", label: "National (legacy)" },
  { value: "restricted", label: "Restricted" },
  { value: "school", label: "School-specific" },
  { value: "exam", label: "Exam / break" },
  { value: "emergency", label: "Emergency closure" },
  { value: "other", label: "Other" },
];

export const HOLIDAY_SCOPES: { value: HolidayScope; label: string }[] = [
  { value: "school", label: "School-wide" },
  { value: "class_group", label: "Class group" },
  { value: "class", label: "Specific class(es)" },
];

export const HOLIDAY_APPLIES_TO: {
  value: HolidayAppliesTo;
  label: string;
}[] = [
  { value: "everyone", label: "Students + all staff" },
  { value: "students", label: "Students only" },
  { value: "staff_all", label: "All staff only" },
  { value: "staff_teaching", label: "Teachers only" },
  { value: "staff_non_teaching", label: "Non-teaching only" },
  { value: "students_and_teaching", label: "Students + teachers" },
  {
    value: "students_and_non_teaching",
    label: "Students + non-teaching",
  },
];

export const HOLIDAY_MODES: { value: HolidayMode; label: string }[] = [
  { value: "one_off", label: "One-off date / range" },
  { value: "weekly", label: "Recurring weekly" },
];

export const HOLIDAY_DAY_TYPES: { value: HolidayDayType; label: string }[] = [
  { value: "full", label: "Full day" },
  { value: "half", label: "Half day" },
];

export const STAFF_STREAMS: { value: StaffStream; label: string }[] = [
  { value: "teaching", label: "Teaching" },
  { value: "non_teaching", label: "Non-teaching" },
];

export const STAFF_CATEGORIES: { value: StaffCategory; label: string }[] = [
  { value: "permanent", label: "Permanent" },
  { value: "contract", label: "Contract" },
  { value: "part_time", label: "Part-time" },
];

export const STAFF_JOB_TYPES: {
  value: Exclude<StaffJobType, "">;
  label: string;
}[] = [
  { value: "confirmed", label: "Confirmed" },
  { value: "probation", label: "Probation" },
  { value: "temporary", label: "Temporary" },
  { value: "contract", label: "Contract" },
];

export const STAFF_GENDERS: { value: StaffGender; label: string }[] = [
  { value: "M", label: "Male" },
  { value: "F", label: "Female" },
  { value: "O", label: "Other" },
];

export const STAFF_CASTE_CATEGORIES: {
  value: Exclude<StaffCasteCategory, "">;
  label: string;
}[] = [
  { value: "GENERAL", label: "General" },
  { value: "OBC", label: "OBC" },
  { value: "SC", label: "SC" },
  { value: "ST", label: "ST" },
  { value: "OTHER", label: "Other" },
];

export const STAFF_MARITAL: { value: StaffMaritalStatus; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "married", label: "Married" },
  { value: "widowed", label: "Widowed" },
  { value: "other", label: "Other" },
];

export const STAFF_BLOOD_GROUPS = [
  "A+",
  "A-",
  "B+",
  "B-",
  "AB+",
  "AB-",
  "O+",
  "O-",
] as const;

export function ensureSubjectGroups(subjects: Subject[]): Subject[] {
  const list = subjects.map(normalizeSubject);
  const ensureComponents = (
    parentCode: string,
    components: { code: string; nameEn: string; sortOrder: number }[],
  ) => {
    const parent = list.find((s) => s.code === parentCode && !s.parentId);
    if (!parent) return;
    if (list.some((s) => s.parentId === parent.id)) return;
    for (const c of components) {
      list.push(
        normalizeSubject({
          id: nid("sub"),
          code: c.code,
          nameEn: c.nameEn,
          category: parent.category,
          coScholasticArea: "",
          parentId: parent.id,
          isElective: false,
          isActive: true,
          sortOrder: c.sortOrder,
        }),
      );
    }
  };
  ensureComponents("ENG", [
    { code: "ENG-ORAL", nameEn: "English — Oral", sortOrder: 1 },
    { code: "ENG-WRIT", nameEn: "English — Written", sortOrder: 2 },
  ]);
  ensureComponents("HIN", [
    { code: "HIN-ORAL", nameEn: "Hindi — Oral", sortOrder: 1 },
    { code: "HIN-WRIT", nameEn: "Hindi — Written", sortOrder: 2 },
  ]);
  return list;
}

export function newFoundationId(prefix: string) {
  return nid(prefix);
}
