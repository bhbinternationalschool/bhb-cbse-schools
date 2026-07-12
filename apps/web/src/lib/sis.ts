/**
 * SIS (Students) — Phase 1 go-live roster.
 * Source of truth for enrollments; syncs a slim view into Masters for fee demos.
 */

import {
  DEFAULT_AY,
  DEMO_SIBLING_NAMES,
  DEMO_STUDENT_CLASS_BY_NAME,
  ensureStudentClassLinks,
  loadMasters,
  resolveFeeGroupId,
  saveMasters,
  type DemoStudent,
  type FeeStudentType,
  type MastersState,
} from "@/lib/masters";
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

export type StudentCategory = "GEN" | "OBC" | "SC" | "ST" | "EWS" | "";

export type DocStatus = "missing" | "received" | "verified";

export type StudentDocKey =
  | "birthCert"
  | "photo"
  | "aadhaar"
  | "addressProof"
  | "tc"
  | "casteCert"
  | "incomeCert";

/** Per-doc vault entry — fileUrl is https or data: (demo) until Supabase Storage. */
export type StudentDocFile = {
  status: DocStatus;
  fileName: string;
  mimeType: string;
  size: number;
  fileUrl: string;
  uploadedAt: string;
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
};

export type SisStudent = {
  id: string;
  admissionNo: string;
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
  /** Compliance IDs */
  pen: string;
  penStatus: PenStatus;
  apaarId: string;
  srn: string;
  previousSchool: string;
  previousTcNo: string;
  previousUdise: string;
  docs: StudentDocs;
  notes: string;
  /** Optional photo (https URL or data:image for demo upload) */
  photoUrl: string;
  /** Confirmed subjects/stream for the academic year */
  curriculum: StudentCurriculum | null;
};

export type SisState = {
  version: 1;
  households: Household[];
  students: SisStudent[];
  curriculumRequests: CurriculumRequest[];
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
    uploadedAt: "",
  };
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

export function normalizeDocFile(raw: unknown): StudentDocFile {
  if (typeof raw === "string") {
    const status: DocStatus =
      raw === "received" || raw === "verified" || raw === "missing"
        ? raw
        : "missing";
    return emptyDocFile(status);
  }
  if (!raw || typeof raw !== "object") return emptyDocFile();
  const o = raw as Partial<StudentDocFile> & { status?: string };
  const status: DocStatus =
    o.status === "received" || o.status === "verified" || o.status === "missing"
      ? o.status
      : "missing";
  const fileUrl = typeof o.fileUrl === "string" ? o.fileUrl : "";
  return {
    status: fileUrl && status === "missing" ? "received" : status,
    fileName: typeof o.fileName === "string" ? o.fileName : "",
    mimeType: typeof o.mimeType === "string" ? o.mimeType : "",
    size: typeof o.size === "number" ? o.size : 0,
    fileUrl,
    uploadedAt: typeof o.uploadedAt === "string" ? o.uploadedAt : "",
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
    fullName: s.fullName ?? "",
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
    fatherName: s.fatherName ?? "",
    motherName: s.motherName ?? "",
    fatherMobile: normalizeMobile(s.fatherMobile ?? ""),
    motherMobile: normalizeMobile(s.motherMobile ?? ""),
    fatherAadhaarLast4: (s.fatherAadhaarLast4 ?? "").replace(/\D/g, "").slice(0, 4),
    motherAadhaarLast4: (s.motherAadhaarLast4 ?? "").replace(/\D/g, "").slice(0, 4),
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
    aadhaarLast4: (s.aadhaarLast4 ?? "").replace(/\D/g, "").slice(0, 4),
    pen: s.pen ?? "",
    penStatus: s.penStatus ?? (s.pen ? "has_pen" : ""),
    apaarId: s.apaarId ?? "",
    srn: s.srn ?? "",
    previousSchool: s.previousSchool ?? "",
    previousTcNo: s.previousTcNo ?? "",
    previousUdise: s.previousUdise ?? "",
    docs,
    notes: s.notes ?? "",
    photoUrl: photoUrl || docs.photo.fileUrl || "",
    curriculum: normalizeCurriculum(
      s.curriculum,
      s.academicYearCode ?? DEFAULT_AY,
    ),
  };
}

export function normalizeHousehold(h: Partial<Household> & { id: string }): Household {
  const mobile = normalizeMobile(h.mobile ?? "");
  const whatsappRaw = normalizeMobile(h.whatsappMobile ?? "");
  return {
    id: h.id,
    code: h.code ?? "",
    guardianName: h.guardianName ?? "",
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


function pickFeeGroup(
  masters: MastersState,
  studentType: FeeStudentType,
  classId: string,
): string | null {
  return resolveFeeGroupId(masters, {
    studentType,
    classId,
    academicYearCode: DEFAULT_AY,
    preferPublished: true,
  });
}

function seedFromMasters(masters: MastersState): SisState {
  const campusId = masters.campuses.find((c) => c.isPrimary)?.id ??
    masters.campuses[0]?.id ??
    "";
  const households: Household[] = [];
  const students: SisStudent[] = [];

  /** Shared sibling household (Rahul + Ananya). */
  const siblingHh = normalizeHousehold({
    id: id("hh"),
    code: "HH-SINGH",
    guardianName: "Ramesh Singh",
    mobile: "9876543210",
    email: "ramesh.singh@example.com",
    address: "12, Lanka Road",
    locality: "Lanka",
    landmark: "Near BHU gate",
    city: "Varanasi",
    state: "Uttar Pradesh",
    pincode: "221005",
    altMobile: "9123456780",
  });
  households.push(siblingHh);

  const demo = masters.students ?? [];
  demo.forEach((d, i) => {
    const isSibling = (DEMO_SIBLING_NAMES as readonly string[]).includes(
      d.fullName,
    );
    let householdId = siblingHh.id;
    if (!isSibling) {
      const hh = normalizeHousehold({
        id: id("hh"),
        code: `HH-${100 + i}`,
        guardianName: `Guardian of ${d.fullName.split(" ")[0] ?? d.fullName}`,
        mobile: `98${String(70000001 + i).slice(0, 8)}`,
        email: "",
        address: "Lanka, Varanasi",
        ...emptyHouseholdFields(),
      });
      households.push(hh);
      householdId = hh.id;
    }
    const studentType: FeeStudentType = i % 3 === 0 ? "NEW" : "PROMOTE";
    students.push(
      normalizeStudent({
        id: d.id.startsWith("stu") ? d.id : id("stu"),
        admissionNo: d.admissionNo,
        fullName: d.fullName,
        gender: d.fullName.startsWith("Ananya") || d.fullName.includes("Meera") || d.fullName.includes("Isha") || d.fullName.includes("Sara") || d.fullName.includes("Priya")
          ? "F"
          : i % 2 === 0
            ? "M"
            : "F",
        dob: d.fullName === "Ananya Singh" ? "2017-08-20" : `201${i % 8}-0${(i % 9) + 1}-15`,
        status: d.status === "inactive" ? "inactive" : "active",
        campusId,
        classId: d.classId,
        sectionId: d.sectionId,
        rollNo: String((i % 40) + 1),
        academicYearCode: DEFAULT_AY,
        studentType,
        feeGroupId: pickFeeGroup(masters, studentType, d.classId),
        fatherName: isSibling ? "Ramesh Singh" : `Mr ${(d.fullName.split(" ").pop() ?? "Parent")}`,
        motherName: isSibling ? "Sunita Singh" : "",
        fatherMobile: isSibling ? "9876543210" : "",
        motherMobile: isSibling ? "9123456780" : "",
        householdId,
        nationality: "Indian",
        guardianRelation: "Father",
      }),
    );
  });

  if (students.length === 0) {
    const clsVi = masters.classes.find((c) => c.name === "VI") ?? masters.classes[0];
    const secVi =
      masters.sections.find((s) => s.classId === clsVi?.id) ??
      masters.sections[0];
    const clsIii = masters.classes.find((c) => c.name === "III") ?? clsVi;
    const secIii =
      masters.sections.find((s) => s.classId === clsIii?.id) ?? secVi;
    if (clsVi && secVi && clsIii && secIii) {
      students.push(
        normalizeStudent({
          id: id("stu"),
          admissionNo: "BHB-2025-101",
          fullName: "Rahul Singh",
          gender: "M",
          dob: "2014-05-12",
          status: "active",
          campusId,
          classId: clsVi.id,
          sectionId: secVi.id,
          rollNo: "1",
          academicYearCode: DEFAULT_AY,
          studentType: "PROMOTE",
          feeGroupId: pickFeeGroup(masters, "PROMOTE", clsVi.id),
          fatherName: "Ramesh Singh",
          motherName: "Sunita Singh",
          fatherMobile: "9876543210",
          motherMobile: "9123456780",
          householdId: siblingHh.id,
          nationality: "Indian",
          guardianRelation: "Father",
        }),
        normalizeStudent({
          id: id("stu"),
          admissionNo: "BHB-2025-102",
          fullName: "Ananya Singh",
          gender: "F",
          dob: "2017-08-20",
          status: "active",
          campusId,
          classId: clsIii.id,
          sectionId: secIii.id,
          rollNo: "5",
          academicYearCode: DEFAULT_AY,
          studentType: "PROMOTE",
          feeGroupId: pickFeeGroup(masters, "PROMOTE", clsIii.id),
          fatherName: "Ramesh Singh",
          motherName: "Sunita Singh",
          fatherMobile: "9876543210",
          motherMobile: "9123456780",
          householdId: siblingHh.id,
          nationality: "Indian",
          guardianRelation: "Father",
        }),
      );
    }
  }

  return ensureSiblingDemo(
    { version: 1, households, students, curriculumRequests: [] },
    masters,
  );
}

/**
 * Guarantee at least one household with 2 active siblings for Fee Take / SIS demos.
 * Safe to run on every load — no-op if siblings already exist.
 */
export function ensureSiblingDemo(
  sis: SisState,
  masters: MastersState,
): SisState {
  const active = sis.students.filter((s) => s.status === "active");
  const already = sis.households.some(
    (h) => active.filter((s) => s.householdId === h.id).length >= 2,
  );
  if (already) {
    // Rename legacy Ananya Gupta → Singh if linked as sibling of Rahul
    const rahul = sis.students.find((s) => s.fullName === "Rahul Singh");
    return {
      ...sis,
      students: sis.students.map((s) => {
        if (
          s.fullName === "Ananya Gupta" &&
          rahul &&
          s.householdId === rahul.householdId
        ) {
          return normalizeStudent({
            ...s,
            fullName: "Ananya Singh",
            fatherName: "Ramesh Singh",
            motherName: "Sunita Singh",
          });
        }
        return s;
      }),
    };
  }

  const campusId =
    masters.campuses.find((c) => c.isPrimary)?.id ??
    masters.campuses[0]?.id ??
    "";
  let households = [...sis.households];
  let students = [...sis.students];

  let rahul = students.find((s) => s.fullName === "Rahul Singh");
  let ananya = students.find(
    (s) => s.fullName === "Ananya Singh" || s.fullName === "Ananya Gupta",
  );

  const clsVi = masters.classes.find((c) => c.name === "VI");
  const secVi = clsVi
    ? masters.sections.find((s) => s.classId === clsVi.id)
    : undefined;
  const clsIii = masters.classes.find((c) => c.name === "III");
  const secIii = clsIii
    ? masters.sections.find((s) => s.classId === clsIii.id)
    : undefined;

  const siblingHh = normalizeHousehold({
    id: id("hh"),
    code: "HH-SINGH",
    guardianName: "Ramesh Singh",
    mobile: "9876543210",
    email: "ramesh.singh@example.com",
    address: "12, Lanka Road",
    locality: "Lanka",
    landmark: "Near BHU gate",
    city: "Varanasi",
    state: "Uttar Pradesh",
    pincode: "221005",
    altMobile: "9123456780",
  });
  households.push(siblingHh);

  if (!rahul && clsVi && secVi) {
    rahul = normalizeStudent({
      id: id("stu"),
      admissionNo: "BHB-2025-101",
      fullName: "Rahul Singh",
      gender: "M",
      dob: "2014-05-12",
      status: "active",
      campusId,
      classId: clsVi.id,
      sectionId: secVi.id,
      rollNo: "1",
      academicYearCode: DEFAULT_AY,
      studentType: "PROMOTE",
      feeGroupId: pickFeeGroup(masters, "PROMOTE", clsVi.id),
      fatherName: "Ramesh Singh",
      motherName: "Sunita Singh",
      fatherMobile: "9876543210",
      motherMobile: "9123456780",
      householdId: siblingHh.id,
      nationality: "Indian",
      guardianRelation: "Father",
    });
    students.push(rahul);
  }

  if (!ananya && clsIii && secIii) {
    ananya = normalizeStudent({
      id: id("stu"),
      admissionNo: "BHB-2025-102",
      fullName: "Ananya Singh",
      gender: "F",
      dob: "2017-08-20",
      status: "active",
      campusId,
      classId: clsIii.id,
      sectionId: secIii.id,
      rollNo: "5",
      academicYearCode: DEFAULT_AY,
      studentType: "PROMOTE",
      feeGroupId: pickFeeGroup(masters, "PROMOTE", clsIii.id),
      fatherName: "Ramesh Singh",
      motherName: "Sunita Singh",
      fatherMobile: "9876543210",
      motherMobile: "9123456780",
      householdId: siblingHh.id,
      nationality: "Indian",
      guardianRelation: "Father",
    });
    students.push(ananya);
  }

  if (!rahul || !ananya) return sis;

  const oldRahulHh = rahul.householdId;
  const oldAnanyaHh = ananya.householdId;

  students = students.map((s) => {
    if (s.id === rahul!.id || s.id === ananya!.id) {
      return normalizeStudent({
        ...s,
        fullName: s.id === ananya!.id ? "Ananya Singh" : s.fullName,
        householdId: siblingHh.id,
        fatherName: "Ramesh Singh",
        motherName: "Sunita Singh",
        fatherMobile: "9876543210",
        motherMobile: "9123456780",
        guardianRelation: "Father",
      });
    }
    return s;
  });

  // Drop empty former households
  households = households.filter((h) => {
    if (h.id === siblingHh.id) return true;
    if (h.id === oldRahulHh || h.id === oldAnanyaHh) {
      return students.some((s) => s.householdId === h.id);
    }
    return true;
  });

  return {
    version: 1,
    households,
    students,
    curriculumRequests: sis.curriculumRequests ?? [],
  };
}

/** Ensure at least one staff-ward tagged student for concession grant suggestions. */
export function ensureStaffWardDemo(sis: SisState): SisState {
  const active = sis.students.filter((s) => s.status === "active");
  const hasStaff = active.some((s) =>
    /staff\s*ward|staff\s*child|\bstaff\b/i.test(
      [s.notes, s.guardianRelation].join(" "),
    ),
  );
  if (hasStaff) return sis;
  const candidate =
    active.find(
      (s) =>
        s.fullName !== "Rahul Singh" && s.fullName !== "Ananya Singh",
    ) ?? active[0];
  if (!candidate) return sis;
  return {
    ...sis,
    students: sis.students.map((s) =>
      s.id === candidate.id
        ? {
            ...s,
            notes: s.notes
              ? `${s.notes} · Staff ward`
              : "Staff ward",
            guardianRelation: s.guardianRelation || "Father (staff)",
          }
        : s,
    ),
  };
}

/** Push slim roster into Masters so special fees / concessions demos stay in sync. */
export function syncSisIntoMasters(sis: SisState, masters?: MastersState) {
  const m = masters ?? loadMasters();
  const demo: DemoStudent[] = sis.students.map((s) => ({
    id: s.id,
    admissionNo: s.admissionNo,
    fullName: s.fullName,
    classId: s.classId,
    sectionId: s.sectionId,
    status: s.status,
  }));
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
      const firstSec = masters.sections.find((x) => x.classId === s.classId);
      if (firstSec) {
        changed = true;
        return { ...s, sectionId: firstSec.id };
      }
    }

    // Match masters demo roster
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
      const firstSec = cls
        ? masters.sections.find((x) => x.classId === cls.id)
        : undefined;
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
    // Total drift — re-seed from current masters roster
    return seedFromMasters(masters);
  }

  if (!changed) return sis;
  return { ...sis, students };
}

export function loadSis(): SisState {
  const masters = ensureStudentClassLinks(loadMasters());
  if (typeof window === "undefined") {
    return seedFromMasters(masters);
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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
      };
      if (next.students.length === 0) {
        next = seedFromMasters(masters);
      } else {
        next = alignSisToMasters(next, masters);
        next = ensureSiblingDemo(next, masters);
        next = ensureStaffWardDemo(next);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      syncSisIntoMasters(next, masters);
      return next;
    }
    const seed = seedFromMasters(masters);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    syncSisIntoMasters(seed, masters);
    return seed;
  } catch {
    return seedFromMasters(masters);
  }
}

export function saveSis(state: SisState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  syncSisIntoMasters(state);
  // Dual-mode: push full roster + curriculum when Supabase is configured
  void import("@/lib/sisPersistence").then(({ scheduleSisSync }) => {
    scheduleSisSync(state);
  });
  void import("@/lib/curriculumPersistence").then(({ scheduleCurriculumSync }) => {
    scheduleCurriculumSync(state);
  });
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

export function suggestAdmissionNo(students: SisStudent[]): string {
  const year = DEFAULT_AY.split("-")[0] ?? "2025";
  let max = 100;
  for (const s of students) {
    const m = s.admissionNo.match(/(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `BHB-${year}-${max + 1}`;
}

export function householdOf(
  state: SisState,
  householdId: string,
): Household | undefined {
  return state.households.find((h) => h.id === householdId);
}

export function siblingsOf(
  state: SisState,
  student: SisStudent,
): SisStudent[] {
  return state.students.filter(
    (s) => s.householdId === student.householdId && s.id !== student.id,
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
