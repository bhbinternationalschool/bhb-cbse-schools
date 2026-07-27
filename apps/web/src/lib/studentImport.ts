/**
 * Student CSV import — aligned to full register export columns.
 * Supports session-wise upload (old year files → current session).
 */

import {
  DEFAULT_AY,
  STUDENT_TYPES,
  resolveFeeGroupId,
  type FeeStudentType,
  type MastersState,
} from "@/lib/masters";
import {
  normalizeHousehold,
  normalizeMobile,
  normalizeStudent,
  newSisId,
  type Household,
  type SisState,
  type SisStudent,
  type StudentCategory,
  type StudentStatus,
} from "@/lib/sis";
import {
  STUDENT_REGISTER_EXPORT_COLUMNS,
  studentToRegisterExportRow,
} from "@/lib/studentRegisterExport";
import { downloadExcelCsv } from "@/lib/reportExport";
import { ACADEMIC_YEARS, TENANT } from "@/lib/types";

export type StudentImportPlacement =
  /** Keep Session column from CSV (or sourceSession filter). */
  | "keep_csv_session"
  /** Force all imported rows into targetSession (typical: bring old year → current). */
  | "place_in_target";

export type StudentImportOptions = {
  /** Academic year to place students into when placement is place_in_target. */
  targetSession: string;
  placement: StudentImportPlacement;
  /**
   * If set, only rows whose Session matches this code are imported
   * (e.g. upload a multi-year dump but take only 2023-24).
   */
  sourceSessionFilter: string;
  /**
   * When placing into target session, default type for rows without a type
   * (usually PROMOTE for continuing from prior year).
   */
  defaultStudentType: FeeStudentType;
  /** Update existing students matched by admission no. */
  upsert: boolean;
};

export type StudentImportRowError = {
  row: number;
  admissionNo: string;
  message: string;
};

export type StudentImportPreview = {
  totalRows: number;
  accepted: number;
  skipped: number;
  errors: StudentImportRowError[];
  sample: {
    admissionNo: string;
    fullName: string;
    className: string;
    session: string;
    studentType: FeeStudentType;
    continuing: boolean;
  }[];
};

export type StudentImportResult = StudentImportPreview & {
  created: number;
  updated: number;
  state: SisState;
  /** Session rows were written into */
  targetSession: string;
  /** Admission nos created/updated in this run (for prior-year gap check) */
  importedAdmissionNos: string[];
};

const HEADER_TO_KEY: Record<string, string> = {};
for (const col of STUDENT_REGISTER_EXPORT_COLUMNS) {
  HEADER_TO_KEY[normalizeHeader(col.header)] = col.key;
  HEADER_TO_KEY[normalizeHeader(col.key)] = col.key;
}

/** Legacy ERP “Student Report” / Excel column aliases → import keys. */
const VENDOR_HEADER_ALIASES: Record<string, string> = {
  admissionnumber: "admissionNo",
  "admission number": "admissionNo",
  "admission no.": "admissionNo",
  "adm no": "admissionNo",
  "student name": "fullName",
  "student first name": "studentFirstName",
  "student middle name": "studentMiddleName",
  "student last name": "studentLastName",
  class: "className",
  "class name": "className",
  section: "section",
  "roll number": "rollNo",
  roll: "rollNo",
  gender: "gender",
  "date of birth": "dob",
  dob: "dob",
  "current status": "status",
  status: "status",
  "admission date": "joinedOn",
  "joined on": "joinedOn",
  "father name": "fatherName",
  "mother name": "motherName",
  "father phone": "fatherMobile",
  "mother phone": "motherMobile",
  smsno: "whatsapp",
  "sms no": "whatsapp",
  "father email": "email",
  email: "email",
  address: "address",
  city: "city",
  state: "state",
  pin: "pincode",
  "blood group": "bloodGroup",
  religion: "religion",
  category: "category",
  "student adharcard no.": "aadhaarLast4",
  "student adharcard no": "aadhaarLast4",
  "student aadhaar": "aadhaarLast4",
  "father adharcard": "fatherAadhaarLast4",
  "mother adharcard": "motherAadhaarLast4",
  "father pancard": "fatherPan",
  "mother pancard": "motherPan",
  pen: "pen",
  "student apaar id": "apaarId",
  apaar: "apaarId",
  "srn no.": "srn",
  "srn no": "srn",
  srn: "srn",
  "previous school name": "previousSchool",
  "previous tc no.": "previousTcNo",
  "previous tc no": "previousTcNo",
  "mother tongue": "motherTongue",
  "place of birth": "placeOfBirth",
  notes: "notes",
  "new/promoted students": "studentType",
  "student type": "studentType",
  session: "academicYear",
  "academic year": "academicYear",
  campus: "campus",
  "fee group": "feeGroup",
  "guardian name": "guardianName",
  "guardian mobile": "guardianMobile",
  whatsapp: "whatsapp",
  "alt mobile": "altMobile",
  locality: "locality",
  landmark: "landmark",
  nationality: "nationality",
  "pen status": "penStatus",
  "prev udise": "previousUdise",
  "emergency name": "emergencyName",
  "emergency mobile": "emergencyMobile",
  // Extended profile fields (legacy ERP full-register export)
  caste: "caste",
  "admission class": "admissionClass",
  "admission form no": "admissionFormNo",
  "registration number": "registrationNo",
  "registration no": "registrationNo",
  "tc number": "tcNo",
  "tc no": "tcNo",
  "previous school class": "previousSchoolClass",
  "previous school year": "previousSchoolYear",
  "permanent address": "permanentAddress",
  "permanent city": "permanentCity",
  "permanent state": "permanentState",
  "permanent pin": "permanentPincode",
  route: "transportRoute",
  "height cm": "heightCm",
  height: "heightCm",
  "weight kg": "weightKg",
  weight: "weightKg",
  "is handicapped": "isCwsn",
  "is handicaped": "isCwsn",
  "medical condition": "medicalNotes",
  "disability details": "disabilityDetails",
  "father occupation": "fatherOccupation",
  "mother occupation": "motherOccupation",
  "father qualification": "fatherQualification",
  "mother qualification": "motherQualification",
  "father incomeperyear": "annualIncome",
  "mother incomeperyear": "annualIncome",
  "bank name": "bankName",
  "account number": "bankAccountNo",
  ifsc: "bankIfsc",
  "second language": "secondLanguage",
  "third language": "thirdLanguage",
  hobbies: "hobbies",
};

for (const [alias, key] of Object.entries(VENDOR_HEADER_ALIASES)) {
  if (!HEADER_TO_KEY[alias]) HEADER_TO_KEY[alias] = key;
}

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[*]+/g, "")
    .replace(/[._]/g, " ")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Excel serial day number → YYYY-MM-DD (UTC). */
export function excelSerialToIso(serial: number): string {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 60000) return "";
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

function normalizeDateField(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(v)) {
    const parts = v.split(/[/-]/).map((p) => Number(p));
    if (parts.length === 3) {
      let [a, b, c] = parts as [number, number, number];
      if (c < 100) c += 2000;
      // prefer D/M/Y when day > 12
      const day = a > 12 ? a : b > 12 ? b : a;
      const month = a > 12 ? b : a;
      const y = c;
      const m = String(month).padStart(2, "0");
      const d = String(day).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
  }
  const asNum = Number(v);
  if (Number.isFinite(asNum) && asNum > 20000 && asNum < 60000) {
    return excelSerialToIso(asNum);
  }
  return v;
}

function aadhaarLast4(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 4) return digits.slice(-4);
  return "";
}

/** "Yes" / "true" / "1" / "y" → true (legacy Yes/No columns). */
function truthyFlag(raw: string | undefined): boolean {
  return /^(yes|y|true|1)$/i.test((raw ?? "").trim());
}

function preferFullName(fields: Record<string, string>): void {
  if (fields.fullName?.trim()) return;
  const parts = [
    fields.studentFirstName,
    fields.studentMiddleName,
    fields.studentLastName,
  ]
    .map((p) => (p ?? "").trim())
    .filter(Boolean);
  if (parts.length) fields.fullName = parts.join(" ");
}

/** RFC-style CSV parse with quotes. Skips leading meta lines until header. */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

function findHeaderIndex(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = rows[i]!.map((c) => normalizeHeader(c));
    const hasAdm = cells.some(
      (c) =>
        c === "admission no" ||
        c === "admissionno" ||
        c === "admission number" ||
        c === "admissionnumber" ||
        c === "adm no" ||
        HEADER_TO_KEY[c] === "admissionNo",
    );
    const hasName = cells.some(
      (c) =>
        c === "student name" ||
        c === "fullname" ||
        c === "name" ||
        HEADER_TO_KEY[c] === "fullName",
    );
    if (hasAdm && hasName) return i;
  }
  return -1;
}

function mapGender(raw: string): SisStudent["gender"] {
  const v = raw.trim().toLowerCase();
  if (!v) return "";
  if (v === "m" || v === "male" || v === "boy") return "M";
  if (v === "f" || v === "female" || v === "girl") return "F";
  if (v === "o" || v === "other") return "O";
  return "";
}

function mapStatus(raw: string): StudentStatus {
  const v = raw.trim().toLowerCase();
  if (v === "inactive" || v === "left" || v === "tc") return "inactive";
  return "active";
}

function mapStudentType(
  raw: string,
  fallback: FeeStudentType,
): FeeStudentType {
  const v = raw.trim().toLowerCase();
  if (!v) return fallback;
  for (const t of STUDENT_TYPES) {
    if (t.value.toLowerCase() === v) return t.value;
    if (t.label.toLowerCase() === v) return t.value;
  }
  if (v.includes("promot") || v.includes("continu")) return "PROMOTE";
  if (v.includes("mid")) return "MID_YEAR";
  if (v.includes("rte") || v.includes("ews")) return "RTE";
  if (v.includes("new") || v.includes("admission")) return "NEW";
  return fallback;
}

function mapCategory(raw: string): StudentCategory {
  const v = raw.trim().toUpperCase();
  if (v === "GEN" || v === "GENERAL") return "GEN";
  if (v === "OBC") return "OBC";
  if (v === "SC") return "SC";
  if (v === "ST") return "ST";
  if (v === "EWS") return "EWS";
  return "";
}

function mapPenStatus(raw: string): SisStudent["penStatus"] {
  const v = raw.trim().toLowerCase();
  if (!v) return "";
  if (v.includes("register")) return "to_register";
  if (v.includes("pending")) return "pending_portal";
  if (v.includes("linked")) return "linked";
  if (v.includes("has") || v === "has_pen") return "has_pen";
  return "";
}

function resolveClassSection(
  masters: MastersState,
  className: string,
  sectionName: string,
): { classId: string; sectionId: string } | { error: string } {
  const raw = className.trim();
  const cn = raw.toLowerCase();
  const sn = sectionName.trim().toLowerCase() || "a";
  if (!cn) return { error: "Class is required" };

  const aliases: Record<string, string> = {
    nur: "nursery",
    nursery: "nursery",
    lkg: "lkg",
    ukg: "ukg",
    "1": "i",
    "2": "ii",
    "3": "iii",
    "4": "iv",
    "5": "v",
    "6": "vi",
    "7": "vii",
    "8": "viii",
    "9": "ix",
    "10": "x",
    "11": "xi",
    "12": "xii",
    class1: "i",
    class2: "ii",
    class3: "iii",
    class4: "iv",
    class5: "v",
  };
  const want = aliases[cn.replace(/\s+/g, "")] ?? cn;

  const cls =
    masters.classes.find((c) => c.name.toLowerCase() === want) ??
    masters.classes.find(
      (c) => c.name.replace(/\s+/g, "").toLowerCase() === want.replace(/\s+/g, ""),
    ) ??
    masters.classes.find((c) => c.name.toLowerCase() === cn) ??
    masters.classes.find(
      (c) => c.name.replace(/\s+/g, "").toLowerCase() === cn.replace(/\s+/g, ""),
    );
  if (!cls) return { error: `Unknown class “${className}”` };
  const secs = masters.sections.filter((s) => s.classId === cls.id);
  const sec =
    secs.find((s) => s.name.toLowerCase() === sn) ??
    secs.find((s) => s.name.toLowerCase() === "a") ??
    secs[0];
  if (!sec) return { error: `No section for class “${className}”` };
  return { classId: cls.id, sectionId: sec.id };
}

function resolveCampusId(masters: MastersState, campusName: string): string {
  const cn = campusName.trim().toLowerCase();
  if (cn) {
    const hit = masters.campuses.find(
      (c) =>
        c.name.toLowerCase() === cn || c.code?.toLowerCase() === cn,
    );
    if (hit) return hit.id;
  }
  return (
    masters.campuses.find((c) => c.isPrimary)?.id ??
    masters.campuses[0]?.id ??
    ""
  );
}

function resolveFeeGroupIdByName(
  masters: MastersState,
  name: string,
  studentType: FeeStudentType,
  classId: string,
  ay: string,
): string | null {
  const n = name.trim().toLowerCase();
  if (n) {
    const hit = masters.feeGroups.find(
      (g) => g.name.toLowerCase() === n || g.code.toLowerCase() === n,
    );
    if (hit) return hit.id;
  }
  return resolveFeeGroupId(masters, {
    studentType,
    classId,
    academicYearCode: ay,
    preferPublished: true,
  });
}

export function listImportSessions(masters: MastersState): string[] {
  const fromMasters = (masters.academicYears ?? []).map((y) => y.code);
  const fromShell = ACADEMIC_YEARS.map((y) => y.code);
  /** Rolling window so future sessions (2026-27, …) appear without code edits. */
  const extras: string[] = [];
  const anchor = new Date().getFullYear();
  for (let start = anchor + 2; start >= 2018; start -= 1) {
    extras.push(`${start}-${String(start + 1).slice(2)}`);
  }
  return [...new Set([DEFAULT_AY, ...fromMasters, ...fromShell, ...extras])]
    .map(normalizeSessionCode)
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a));
}

/** Most recent enrollment in an earlier session (for promote / identity copy). */
function findEarlierEnrollment(
  students: SisStudent[],
  admissionNo: string,
  session: string,
): SisStudent | undefined {
  const adm = admissionNo.trim().toUpperCase();
  const target = normalizeSessionCode(session);
  return students
    .filter(
      (s) =>
        s.admissionNo.trim().toUpperCase() === adm &&
        normalizeSessionCode(s.academicYearCode) < target,
    )
    .sort((a, b) =>
      normalizeSessionCode(b.academicYearCode).localeCompare(
        normalizeSessionCode(a.academicYearCode),
      ),
    )[0];
}

function findPeerEnrollment(
  students: SisStudent[],
  admissionNo: string,
  session: string,
): SisStudent | undefined {
  const adm = admissionNo.trim().toUpperCase();
  const target = normalizeSessionCode(session);
  const earlier = findEarlierEnrollment(students, admissionNo, session);
  if (earlier) return earlier;
  return students.find(
    (s) =>
      s.admissionNo.trim().toUpperCase() === adm &&
      normalizeSessionCode(s.academicYearCode) !== target,
  );
}

export function downloadStudentImportTemplate(masters: MastersState): void {
  const sampleClass = masters.classes.find((c) => c.isActive !== false);
  const sampleSec = sampleClass
    ? masters.sections.find((s) => s.classId === sampleClass.id)
    : undefined;
  const empty = normalizeStudent({
    id: "template",
    admissionNo: "BHB-XXXX-001",
    fullName: "Sample Student",
    gender: "M",
    dob: "2015-01-15",
    status: "active",
    campusId: masters.campuses.find((c) => c.isPrimary)?.id ?? "",
    classId: sampleClass?.id ?? "",
    sectionId: sampleSec?.id ?? "",
    rollNo: "1",
    academicYearCode: DEFAULT_AY,
    studentType: "PROMOTE",
    feeGroupId: null,
    fatherName: "Father Name",
    motherName: "Mother Name",
    fatherMobile: "9876543210",
    nationality: "Indian",
    guardianRelation: "Father",
  });
  const hh = normalizeHousehold({
    id: "hh_template",
    code: "HH-001",
    guardianName: "Father Name",
    mobile: "9876543210",
    whatsappMobile: "9876543210",
    email: "",
    address: "",
    locality: "",
    landmark: "",
    city: TENANT.city,
    state: TENANT.state,
    pincode: "",
    altMobile: "",
  });
  const sis: SisState = {
    version: 1,
    households: [hh],
    students: [{ ...empty, householdId: hh.id }],
    curriculumRequests: [],
    tags: [],
    classUpgrades: [],
  };
  const row = studentToRegisterExportRow(sis.students[0]!, sis, masters);
  downloadExcelCsv({
    title: "Student import template",
    subtitle: `${TENANT.shortName} · fill rows · Session = source year`,
    filterNote:
      "Delete sample row. Class/Section must match Masters names. Use Import on Students page.",
    fileBaseName: "student_import_template",
    columns: STUDENT_REGISTER_EXPORT_COLUMNS.filter(
      (c) => c.key !== "docsUploaded" && c.key !== "hasPhoto",
    ),
    rows: [row],
  });
}

type ParsedRow = {
  lineNo: number;
  fields: Record<string, string>;
};

function rowsToFieldMaps(text: string): {
  rows: ParsedRow[];
  error?: string;
} {
  const grid = parseCsvText(text);
  const hi = findHeaderIndex(grid);
  if (hi < 0) {
    return {
      rows: [],
      error:
        "Could not find header row. Need columns “Admission no” and “Student name”.",
    };
  }
  const headers = grid[hi]!.map((h) => HEADER_TO_KEY[normalizeHeader(h)] ?? "");
  const rows: ParsedRow[] = [];
  for (let i = hi + 1; i < grid.length; i++) {
    const cells = grid[i]!;
    const fields: Record<string, string> = {};
    headers.forEach((key, idx) => {
      if (!key) return;
      const next = String(cells[idx] ?? "").trim();
      if (!fields[key]) fields[key] = next;
      else if (!fields[key].trim() && next) fields[key] = next;
    });
    preferFullName(fields);
    if (fields.dob) fields.dob = normalizeDateField(fields.dob);
    if (fields.joinedOn) fields.joinedOn = normalizeDateField(fields.joinedOn);
    if (fields.aadhaarLast4)
      fields.aadhaarLast4 = aadhaarLast4(fields.aadhaarLast4);
    if (fields.fatherAadhaarLast4)
      fields.fatherAadhaarLast4 = aadhaarLast4(fields.fatherAadhaarLast4);
    if (fields.motherAadhaarLast4)
      fields.motherAadhaarLast4 = aadhaarLast4(fields.motherAadhaarLast4);
    if (!fields.admissionNo && !fields.fullName) continue;
    // Skip title/meta leftovers
    if (/^sr$/i.test(fields.admissionNo) || /^student name$/i.test(fields.fullName))
      continue;
    rows.push({ lineNo: i + 1, fields });
  }
  return { rows };
}

/** `2023-2024` / `2023–2024` / `2023-24` → Masters code `2023-24`. */
export function normalizeSessionCode(raw: string): string {
  const t = raw.trim().replace(/\s+/g, "").replace(/–/g, "-");
  const full = t.match(/^(20\d{2})-(20\d{2})$/);
  if (full) return `${full[1]}-${full[2]!.slice(2)}`;
  const short = t.match(/^(20\d{2})-(\d{2})$/);
  if (short) return `${short[1]}-${short[2]}`;
  return t;
}

/** Pull AY from report titles / filenames, e.g. Student Report(2024-2025). */
export function detectSessionCodeFromText(text: string): string {
  const m = text.match(/20\d{2}\s*[-–]\s*20\d{2}/);
  if (!m) return "";
  return normalizeSessionCode(m[0]!);
}

function applyPlacementSession(
  csvSession: string,
  options: StudentImportOptions,
): string {
  if (options.placement === "place_in_target") {
    return normalizeSessionCode(options.targetSession || DEFAULT_AY);
  }
  return normalizeSessionCode(
    csvSession || options.targetSession || DEFAULT_AY,
  );
}

export function previewStudentImport(
  text: string,
  masters: MastersState,
  options: StudentImportOptions,
  sis?: SisState | null,
): StudentImportPreview {
  const { rows, error } = rowsToFieldMaps(text);
  if (error) {
    return {
      totalRows: 0,
      accepted: 0,
      skipped: 0,
      errors: [{ row: 0, admissionNo: "", message: error }],
      sample: [],
    };
  }
  const errors: StudentImportRowError[] = [];
  const sample: StudentImportPreview["sample"] = [];
  let accepted = 0;
  let skipped = 0;
  const roster = sis?.students ?? [];

  for (const r of rows) {
    const f = r.fields;
    const adm = f.admissionNo?.trim() ?? "";
    const name = f.fullName?.trim() ?? "";
    const csvSession = (f.academicYear ?? "").trim();
    const csvAy = csvSession ? normalizeSessionCode(csvSession) : "";
    const filterAy = options.sourceSessionFilter
      ? normalizeSessionCode(options.sourceSessionFilter)
      : "";
    if (filterAy && csvAy && csvAy !== filterAy) {
      skipped += 1;
      continue;
    }
    if (!adm || !name) {
      errors.push({
        row: r.lineNo,
        admissionNo: adm,
        message: "Admission no and Student name are required",
      });
      continue;
    }
    const cls = resolveClassSection(
      masters,
      f.className ?? "",
      f.section ?? "",
    );
    if ("error" in cls) {
      errors.push({ row: r.lineNo, admissionNo: adm, message: cls.error });
      continue;
    }
    const session = applyPlacementSession(csvAy || csvSession, options);
    const earlier = findEarlierEnrollment(roster, adm, session);
    const csvTypeRaw = (f.studentType ?? "").trim();
    const typeFallback: FeeStudentType = earlier
      ? earlier.studentType === "RTE"
        ? "RTE"
        : "PROMOTE"
      : options.defaultStudentType;
    const studentType = mapStudentType(csvTypeRaw, typeFallback);
    accepted += 1;
    if (sample.length < 5) {
      sample.push({
        admissionNo: adm,
        fullName: name,
        className: f.className ?? "",
        session,
        studentType,
        continuing: !!earlier,
      });
    }
  }

  return {
    totalRows: rows.length,
    accepted,
    skipped,
    errors: errors.slice(0, 40),
    sample,
  };
}

export function applyStudentImport(
  text: string,
  sis: SisState,
  masters: MastersState,
  options: StudentImportOptions,
): StudentImportResult {
  const preview = previewStudentImport(text, masters, options, sis);
  if (preview.errors.some((e) => e.row === 0)) {
    return {
      ...preview,
      created: 0,
      updated: 0,
      state: sis,
      targetSession: normalizeSessionCode(
        options.targetSession || DEFAULT_AY,
      ),
      importedAdmissionNos: [],
    };
  }

  const { rows } = rowsToFieldMaps(text);
  let households = [...sis.households];
  let students = [...sis.students];
  /** Upsert key is admission + session so years stay separate. */
  const enrollmentKey = (admissionNo: string, ay: string) =>
    `${admissionNo.trim().toUpperCase()}::${(ay || "").trim()}`;
  const byEnrollment = new Map(
    students.map(
      (s) =>
        [enrollmentKey(s.admissionNo, s.academicYearCode), s] as const,
    ),
  );
  let created = 0;
  let updated = 0;
  const importedAdmissionNos: string[] = [];
  const errors: StudentImportRowError[] = [...preview.errors];
  let resolvedTargetSession = normalizeSessionCode(
    options.targetSession || DEFAULT_AY,
  );

  const householdKey = (mobile: string, guardian: string) =>
    `${normalizeMobile(mobile)}|${guardian.trim().toLowerCase()}`;

  const hhIndex = new Map<string, Household>();
  for (const h of households) {
    hhIndex.set(householdKey(h.mobile, h.guardianName), h);
  }

  for (const r of rows) {
    const f = r.fields;
    const adm = (f.admissionNo ?? "").trim();
    const name = (f.fullName ?? "").trim();
    const csvSession = (f.academicYear ?? "").trim();
    const csvAy = csvSession ? normalizeSessionCode(csvSession) : "";
    const filterAy = options.sourceSessionFilter
      ? normalizeSessionCode(options.sourceSessionFilter)
      : "";
    if (filterAy && csvAy && csvAy !== filterAy) {
      continue;
    }
    if (!adm || !name) continue;
    const placed = resolveClassSection(
      masters,
      f.className ?? "",
      f.section ?? "",
    );
    if ("error" in placed) continue;

    const session = applyPlacementSession(csvAy || csvSession, options);
    resolvedTargetSession = session;
    const key = enrollmentKey(adm, session);
    const existing = byEnrollment.get(key);
    /** Prefer prior year for promote + identity; never mutate that year. */
    const earlierYear = findEarlierEnrollment(students, adm, session);
    const peerYear =
      earlierYear ??
      (!existing ? findPeerEnrollment(students, adm, session) : undefined);

    const csvTypeRaw = (f.studentType ?? "").trim();
    /**
     * Continuing into a newer session → PROMOTE (unless CSV sets a type).
     * Same-session update keeps existing type when CSV type blank.
     * Fresh admission (no earlier year) uses panel default.
     */
    const typeFallback: FeeStudentType = existing
      ? existing.studentType
      : earlierYear
        ? earlierYear.studentType === "RTE"
          ? "RTE"
          : "PROMOTE"
        : options.defaultStudentType;
    const studentType = mapStudentType(csvTypeRaw, typeFallback);
    const campusId = resolveCampusId(masters, f.campus ?? "");
    const feeGroupId = resolveFeeGroupIdByName(
      masters,
      f.feeGroup ?? "",
      studentType,
      placed.classId,
      session,
    );

    const guardianName =
      (f.guardianName ?? "").trim() ||
      (f.fatherName ?? "").trim() ||
      `Guardian of ${name.split(" ")[0] ?? name}`;
    const guardianMobile = normalizeMobile(
      f.guardianMobile || f.fatherMobile || f.motherMobile || "",
    );
    const whatsapp = normalizeMobile(f.whatsapp || guardianMobile);
    let hh = hhIndex.get(householdKey(guardianMobile, guardianName));
    if (!hh && guardianMobile) {
      hh = households.find(
        (h) => normalizeMobile(h.mobile) === guardianMobile,
      );
    }
    if (!hh) {
      hh = normalizeHousehold({
        id: newSisId("hh"),
        code: `HH-${String(households.length + 1).padStart(3, "0")}`,
        guardianName,
        mobile: guardianMobile,
        whatsappMobile: whatsapp,
        email: f.email ?? "",
        address: f.address ?? "",
        locality: f.locality ?? "",
        landmark: f.landmark ?? "",
        city: f.city || TENANT.city,
        state: f.state || TENANT.state,
        pincode: f.pincode ?? "",
        altMobile: f.altMobile ?? "",
      });
      households.push(hh);
      hhIndex.set(householdKey(guardianMobile, guardianName), hh);
    }

    if (existing && !options.upsert) {
      errors.push({
        row: r.lineNo,
        admissionNo: adm,
        message: `Already in session ${session} (enable Update existing)`,
      });
      continue;
    }

    const identitySource = existing ?? peerYear;

    const patch: Partial<SisStudent> & { id: string } = {
      id: existing?.id ?? newSisId("stu"),
      admissionNo: adm,
      fullName: name,
      gender: mapGender(f.gender ?? "") || identitySource?.gender || "",
      dob: f.dob || identitySource?.dob || "",
      status: mapStatus(f.status ?? ""),
      campusId: campusId || identitySource?.campusId || "",
      classId: placed.classId,
      sectionId: placed.sectionId,
      rollNo: f.rollNo || existing?.rollNo || "",
      academicYearCode: session,
      studentType,
      feeGroupId: feeGroupId ?? existing?.feeGroupId ?? null,
      joinedOn: f.joinedOn || existing?.joinedOn || "",
      fatherName: f.fatherName ?? identitySource?.fatherName ?? "",
      motherName: f.motherName ?? identitySource?.motherName ?? "",
      fatherMobile: normalizeMobile(
        f.fatherMobile ||
          identitySource?.fatherMobile ||
          guardianMobile,
      ),
      motherMobile: normalizeMobile(
        f.motherMobile || identitySource?.motherMobile || "",
      ),
      fatherAadhaarLast4:
        f.fatherAadhaarLast4 ||
        identitySource?.fatherAadhaarLast4 ||
        "",
      motherAadhaarLast4:
        f.motherAadhaarLast4 ||
        identitySource?.motherAadhaarLast4 ||
        "",
      fatherPan: f.fatherPan || identitySource?.fatherPan || "",
      motherPan: f.motherPan || identitySource?.motherPan || "",
      guardianRelation:
        f.guardianRelation ||
        identitySource?.guardianRelation ||
        "Father",
      householdId: hh.id,
      bloodGroup: f.bloodGroup || identitySource?.bloodGroup || "",
      religion: f.religion || identitySource?.religion || "",
      category:
        mapCategory(f.category ?? "") || identitySource?.category || "",
      nationality: f.nationality || identitySource?.nationality || "Indian",
      motherTongue: f.motherTongue || identitySource?.motherTongue || "",
      placeOfBirth: f.placeOfBirth || identitySource?.placeOfBirth || "",
      aadhaarLast4: f.aadhaarLast4 || identitySource?.aadhaarLast4 || "",
      pen: f.pen || identitySource?.pen || "",
      penStatus:
        mapPenStatus(f.penStatus ?? "") || identitySource?.penStatus || "",
      apaarId: f.apaarId || identitySource?.apaarId || "",
      srn: f.srn || identitySource?.srn || "",
      previousSchool: f.previousSchool || existing?.previousSchool || "",
      previousTcNo: f.previousTcNo || existing?.previousTcNo || "",
      previousUdise: f.previousUdise || existing?.previousUdise || "",
      emergencyName: f.emergencyName || identitySource?.emergencyName || "",
      emergencyMobile: normalizeMobile(
        f.emergencyMobile || identitySource?.emergencyMobile || "",
      ),
      notes: f.notes ?? existing?.notes ?? "",
      caste: f.caste || identitySource?.caste || "",
      admissionClass: f.admissionClass || identitySource?.admissionClass || "",
      admissionFormNo:
        f.admissionFormNo || identitySource?.admissionFormNo || "",
      registrationNo: f.registrationNo || identitySource?.registrationNo || "",
      tcNo: f.tcNo || existing?.tcNo || "",
      previousSchoolClass:
        f.previousSchoolClass || identitySource?.previousSchoolClass || "",
      previousSchoolYear:
        f.previousSchoolYear || identitySource?.previousSchoolYear || "",
      permanentAddress:
        f.permanentAddress || identitySource?.permanentAddress || "",
      permanentCity: f.permanentCity || identitySource?.permanentCity || "",
      permanentState: f.permanentState || identitySource?.permanentState || "",
      permanentPincode:
        f.permanentPincode || identitySource?.permanentPincode || "",
      transportRoute: f.transportRoute || existing?.transportRoute || "",
      heightCm: f.heightCm || identitySource?.heightCm || "",
      weightKg: f.weightKg || identitySource?.weightKg || "",
      isCwsn: f.isCwsn ? truthyFlag(f.isCwsn) : (identitySource?.isCwsn ?? false),
      disabilityDetails:
        f.disabilityDetails || identitySource?.disabilityDetails || "",
      medicalNotes: f.medicalNotes || identitySource?.medicalNotes || "",
      fatherOccupation:
        f.fatherOccupation || identitySource?.fatherOccupation || "",
      motherOccupation:
        f.motherOccupation || identitySource?.motherOccupation || "",
      fatherQualification:
        f.fatherQualification || identitySource?.fatherQualification || "",
      motherQualification:
        f.motherQualification || identitySource?.motherQualification || "",
      annualIncome: f.annualIncome || identitySource?.annualIncome || "",
      bankName: f.bankName || identitySource?.bankName || "",
      bankAccountNo: f.bankAccountNo || identitySource?.bankAccountNo || "",
      bankIfsc: f.bankIfsc || identitySource?.bankIfsc || "",
      secondLanguage: f.secondLanguage || identitySource?.secondLanguage || "",
      thirdLanguage: f.thirdLanguage || identitySource?.thirdLanguage || "",
      hobbies: f.hobbies || identitySource?.hobbies || "",
      /** New session row starts without prior curriculum; same-session update keeps it. */
      curriculum: existing?.curriculum ?? null,
      docs: existing?.docs ?? identitySource?.docs,
      photoUrl: existing?.photoUrl || identitySource?.photoUrl || "",
      fatherPhotoUrl:
        existing?.fatherPhotoUrl || identitySource?.fatherPhotoUrl || "",
      motherPhotoUrl:
        existing?.motherPhotoUrl || identitySource?.motherPhotoUrl || "",
    };

    const normalized = normalizeStudent(patch);
    importedAdmissionNos.push(adm.toUpperCase());
    if (existing) {
      students = students.map((s) =>
        s.id === existing.id ? normalized : s,
      );
      byEnrollment.set(key, normalized);
      updated += 1;
    } else {
      students.push(normalized);
      byEnrollment.set(key, normalized);
      created += 1;
    }
  }

  const state: SisState = {
    version: 1,
    households,
    students: reconcileContinuingTypes(students, resolvedTargetSession),
    curriculumRequests: sis.curriculumRequests ?? [],
    tags: sis.tags ?? [],
    classUpgrades: sis.classUpgrades ?? [],
  };

  return {
    totalRows: preview.totalRows,
    accepted: created + updated,
    skipped: preview.skipped,
    errors: errors.slice(0, 40),
    sample: preview.sample,
    created,
    updated,
    state,
    targetSession: resolvedTargetSession,
    importedAdmissionNos: [...new Set(importedAdmissionNos)],
  };
}

/**
 * Align NEW vs PROMOTE for a session from prior-year enrollment
 * (fresh admission → NEW; was in earlier year → PROMOTE).
 */
export function reconcileContinuingTypes(
  students: SisStudent[],
  session: string,
): SisStudent[] {
  const target = normalizeSessionCode(session);
  return students.map((s) => {
    if (normalizeSessionCode(s.academicYearCode) !== target) return s;
    if (s.studentType === "RTE" || s.studentType === "MID_YEAR") return s;
    const earlier = findEarlierEnrollment(students, s.admissionNo, target);
    const nextType: FeeStudentType = earlier ? "PROMOTE" : "NEW";
    if (s.studentType === nextType) return s;
    return normalizeStudent({ ...s, studentType: nextType });
  });
}

export type SessionGapRow = {
  studentId: string;
  admissionNo: string;
  fullName: string;
  classId: string;
  sectionId: string;
  priorSession: string;
  studentType: FeeStudentType;
  gender: SisStudent["gender"];
  rollNo: string;
};

export type SessionGapAction = "inactive" | "promote" | "leave";

/** Most recent earlier session that still has active students. */
export function resolvePriorSessionForGap(
  students: SisStudent[],
  targetSession: string,
): string | null {
  const target = normalizeSessionCode(targetSession);
  const priors = [
    ...new Set(
      students
        .map((s) => normalizeSessionCode(s.academicYearCode))
        .filter((ay) => ay && ay < target),
    ),
  ].sort((a, b) => b.localeCompare(a));
  for (const ay of priors) {
    if (
      students.some(
        (s) =>
          normalizeSessionCode(s.academicYearCode) === ay &&
          s.status === "active",
      )
    ) {
      return ay;
    }
  }
  return priors[0] ?? null;
}

/**
 * Active students in the prior session who were not in this import file.
 */
export function listMissingFromImport(
  sis: SisState,
  targetSession: string,
  importedAdmissionNos: string[],
): { priorSession: string; targetSession: string; missing: SessionGapRow[] } | null {
  const target = normalizeSessionCode(targetSession);
  const prior = resolvePriorSessionForGap(sis.students, target);
  if (!prior) return null;
  const imported = new Set(
    importedAdmissionNos.map((a) => a.trim().toUpperCase()).filter(Boolean),
  );
  const missing: SessionGapRow[] = sis.students
    .filter(
      (s) =>
        normalizeSessionCode(s.academicYearCode) === prior &&
        s.status === "active" &&
        !imported.has(s.admissionNo.trim().toUpperCase()),
    )
    .map((s) => ({
      studentId: s.id,
      admissionNo: s.admissionNo,
      fullName: s.fullName,
      classId: s.classId,
      sectionId: s.sectionId,
      priorSession: prior,
      studentType: s.studentType,
      gender: s.gender,
      rollNo: s.rollNo,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  if (missing.length === 0) return null;
  return { priorSession: prior, targetSession: target, missing };
}

/**
 * Apply school choices for students missing from a new-session upload.
 * - inactive: mark prior-year row inactive (left / TC / not continuing)
 * - promote: create/update target-session row as PROMOTE from prior year
 * - leave: no change
 */
export function applySessionGapActions(
  sis: SisState,
  masters: MastersState,
  input: {
    targetSession: string;
    /** prior-year studentId → action */
    choices: Record<string, SessionGapAction>;
  },
): { state: SisState; inactivated: number; promoted: number } {
  const target = normalizeSessionCode(input.targetSession);
  let students = [...sis.students];
  let inactivated = 0;
  let promoted = 0;

  for (const [studentId, action] of Object.entries(input.choices)) {
    if (action === "leave") continue;
    const prior = students.find((s) => s.id === studentId);
    if (!prior) continue;

    if (action === "inactive") {
      if (prior.status === "inactive") continue;
      students = students.map((s) =>
        s.id === prior.id
          ? normalizeStudent({ ...s, status: "inactive" })
          : s,
      );
      inactivated += 1;
      continue;
    }

    if (action === "promote") {
      const existingTarget = students.find(
        (s) =>
          s.admissionNo.trim().toUpperCase() ===
            prior.admissionNo.trim().toUpperCase() &&
          normalizeSessionCode(s.academicYearCode) === target,
      );
      const feeGroupId =
        resolveFeeGroupId(masters, {
          studentType: prior.studentType === "RTE" ? "RTE" : "PROMOTE",
          classId: prior.classId,
          academicYearCode: target,
          preferPublished: true,
        }) ??
        existingTarget?.feeGroupId ??
        prior.feeGroupId ??
        null;
      const studentType: FeeStudentType =
        prior.studentType === "RTE" ? "RTE" : "PROMOTE";
      const patch = normalizeStudent({
        ...(existingTarget ?? prior),
        id: existingTarget?.id ?? newSisId("stu"),
        academicYearCode: target,
        studentType,
        status: "active",
        classId: prior.classId,
        sectionId: prior.sectionId,
        feeGroupId,
        curriculum: existingTarget?.curriculum ?? null,
        photoUrl: existingTarget?.photoUrl || prior.photoUrl || "",
        fatherPhotoUrl:
          existingTarget?.fatherPhotoUrl || prior.fatherPhotoUrl || "",
        motherPhotoUrl:
          existingTarget?.motherPhotoUrl || prior.motherPhotoUrl || "",
        docs: existingTarget?.docs ?? prior.docs,
      });
      if (existingTarget) {
        students = students.map((s) =>
          s.id === existingTarget.id ? patch : s,
        );
      } else {
        students.push(patch);
      }
      promoted += 1;
    }
  }

  return {
    state: {
      ...sis,
      version: 1,
      students,
    },
    inactivated,
    promoted,
  };
}

/**
 * Convert an .xlsx Student Report (or register export) into CSV text
 * suitable for previewStudentImport / applyStudentImport.
 */
export async function workbookToStudentImportCsv(
  data: ArrayBuffer | Uint8Array,
): Promise<{ csv: string; detectedSession: string }> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(data, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Workbook has no sheets");
  const sheet = wb.Sheets[sheetName]!;
  // Detect session from title rows (e.g. Student Report(2023-2024))
  const grid = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];
  let detectedSession = "";
  for (const row of grid.slice(0, 6)) {
    const joined = row.map((c) => String(c ?? "")).join(" ");
    const hit = detectSessionCodeFromText(joined);
    if (hit) {
      detectedSession = hit;
      break;
    }
  }
  let csv = XLSX.utils.sheet_to_csv(sheet);
  if (detectedSession && !/session/i.test(csv.slice(0, 2500))) {
    // Inject Session column after header for place_in_target / filters
    const parsed = parseCsvText(csv);
    const hIdx = findHeaderIndex(parsed);
    if (hIdx >= 0) {
      const headers = [...parsed[hIdx]!];
      if (!headers.some((h) => HEADER_TO_KEY[normalizeHeader(h)] === "academicYear")) {
        headers.push("Session");
        const out: string[][] = [];
        for (let i = 0; i < parsed.length; i++) {
          if (i < hIdx) {
            out.push(parsed[i]!);
            continue;
          }
          if (i === hIdx) {
            out.push(headers);
            continue;
          }
          out.push([...(parsed[i] ?? []), detectedSession]);
        }
        csv = out
          .map((row) =>
            row
              .map((cell) => {
                const s = String(cell ?? "");
                if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
                return s;
              })
              .join(","),
          )
          .join("\n");
      }
    }
  }
  return { csv, detectedSession };
}
