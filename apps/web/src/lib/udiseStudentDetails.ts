/**
 * UDISE+ portal “Students_Details” export (e.g. 09674104900_Students_Details 2026-27.xlsx).
 * Match SIS students and update PEN / APAAR / Aadhaar last-4 (and related fields).
 *
 * Columns (header row):
 * Class | Section | Name | Gender | Initialised at SDMS | Student PEN | Student State Code |
 * Father Name | Mother Name | Social Category | … | AADHAAR No. | … | APAAR ID | APAAR Status
 */

import {
  loadMasters,
  resolveFeeGroupId,
  sortClassIdsByClassBand,
  DEFAULT_AY,
  type FeeStudentType,
  type MastersState,
} from "@/lib/masters";
import {
  loadSis,
  normalizeHousehold,
  normalizeStudent,
  newSisId,
  saveSis,
  suggestAdmissionNo,
  type AadhaarVerificationStatus,
  type PenStatus,
  type SisState,
  type SisStudent,
  type StudentCategory,
} from "@/lib/sis";

export type UdiseStudentRow = {
  classHint: string;
  sectionHint: string;
  fullName: string;
  gender: string;
  dob: string;
  sdmsYear: string;
  pen: string;
  stateCode: string;
  fatherName: string;
  motherName: string;
  socialCategory: string;
  minorityGroup: string;
  bpl: string;
  cwsn: string;
  entryStatus: string;
  aadhaarRaw: string;
  aadhaarName: string;
  aadhaarValidation: string;
  apaarId: string;
  apaarStatus: string;
  suspectedDuplicate: string;
  mbuStatus: string;
};

export type UdiseMatchMethod =
  | "pen"
  | "apaar"
  | "aadhaar"
  | "name_father_class"
  | "name_father"
  | "name_class_section"
  | "name_unique"
  | "fuzzy_name_father";

/** Which keys the operator wants to match SIS ↔ UDISE on, plus fuzzy toggle. */
export type UdiseMatchOptions = {
  usePen: boolean;
  useApaar: boolean;
  useAadhaar: boolean;
  useNameFather: boolean;
  useNameClass: boolean;
  useNameUnique: boolean;
  /** Allow approximate (spelling-tolerant) name matching as a fallback. */
  fuzzy: boolean;
  /** Similarity 0..1 required for a fuzzy match (default 0.82). */
  fuzzyThreshold: number;
};

export const DEFAULT_UDISE_MATCH_OPTIONS: UdiseMatchOptions = {
  usePen: true,
  useApaar: true,
  useAadhaar: false,
  useNameFather: true,
  useNameClass: true,
  useNameUnique: true,
  fuzzy: false,
  fuzzyThreshold: 0.82,
};

export const UDISE_MATCH_METHOD_LABEL: Record<UdiseMatchMethod, string> = {
  pen: "PEN",
  apaar: "APAAR",
  aadhaar: "Aadhaar last-4",
  name_father_class: "Name + father + class",
  name_father: "Name + father",
  name_class_section: "Name + class/section",
  name_unique: "Unique name",
  fuzzy_name_father: "Fuzzy name",
};

export type UdiseRowTone =
  | "fill" // matched · fields will auto-fill from UDISE
  | "ok" // matched · already in sync
  | "verify" // matched · school must verify on UDISE+ portal
  | "suspect" // not in SIS (or portal suspected duplicate)
  | "ambiguous" // multiple SIS matches
  | "inactive" // matched an inactive SIS student (any session)
  | "mbu_age"; // MBU Pending — age / biometric below class requirement

export type UdiseMatchPreview = {
  rowIndex: number;
  udise: UdiseStudentRow;
  studentId: string | null;
  admissionNo: string;
  matchedName: string;
  method: UdiseMatchMethod | "unmatched" | "ambiguous";
  willUpdate: {
    fullName?: string;
    fatherName?: string;
    motherName?: string;
    pen?: string;
    apaarId?: string;
    aadhaarLast4?: string;
    aadhaarNumber?: string;
    aadhaarVerification?: AadhaarVerificationStatus;
    penStatus?: PenStatus;
    category?: StudentCategory;
    gender?: SisStudent["gender"];
    dob?: string;
    udiseAadhaarValidationStatus?: string;
    udiseMbuStatus?: string;
    udisePortalClassHint?: string;
    udiseAgeBelowClassAlert?: boolean;
  };
  /** Fields already present in SIS (for display) */
  sisFilled: {
    fullName: string;
    pen: string;
    apaarId: string;
    aadhaar: string;
    aadhaarVerification: AadhaarVerificationStatus;
    motherName: string;
    fatherName: string;
    gender: string;
    category: string;
    sisClassLabel: string;
  };
  /** Human labels of fields that will be written */
  fillLabels: string[];
  tone: UdiseRowTone;
  /** Matched an SIS student that is not active (TC / left / inactive). */
  sisInactive: boolean;
  /** Matched SIS student status (e.g. "inactive", "tc") — "" when unmatched. */
  sisStatus: string;
  /** Matched SIS student's academic session — "" when unmatched. */
  sisSession: string;
  /** Portal flags Suspected Duplicate */
  portalSuspect: boolean;
  portalAadhaarVerified: boolean;
  /** SIS class ≠ UDISE+ class (SIS class is NEVER overwritten) */
  classMismatch: boolean;
  udiseClassHint: string;
  sisClassLabel: string;
  /** MBU Pending — age below for class / biometric update */
  mbuAgeAlert: boolean;
  /** SIS DOB ≠ UDISE+ DOB (both present and different) */
  dobMismatch: boolean;
  /** Portal DOB (display dd/mm/yyyy) */
  udiseDob: string;
  /** SIS DOB (display dd/mm/yyyy) */
  sisDob: string;
  aadhaarValidationStatus: string;
  mbuStatus: string;
  actionHint: string;
  note: string;
};

export type UdiseImportResult = {
  ok: true;
  total: number;
  matched: number;
  updated: number;
  unmatched: number;
  ambiguous: number;
  /** Rows matched to an inactive SIS student — not auto-written. */
  inactive: number;
  skippedNoChange: number;
  preview: UdiseMatchPreview[];
  state: SisState;
};

function cellStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number" && Number.isFinite(v)) {
    if (Number.isInteger(v) || Math.abs(v - Math.round(v)) < 1e-6) {
      return String(Math.round(v));
    }
    return String(v);
  }
  return String(v).replace(/\u00a0/g, " ").trim();
}

function normHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9\u0900-\u097f ]/gi, "");
}

/** Canonical DOB key (yyyymmdd) for comparing SIS vs UDISE dates. */
function normDobKey(s: string): string {
  const raw = (s || "").trim();
  if (!raw || udiseIsBlank(raw)) return "";
  let m = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/); // yyyy-mm-dd
  if (m) return `${m[1]}${m[2]!.padStart(2, "0")}${m[3]!.padStart(2, "0")}`;
  m = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/); // dd-mm-yyyy
  if (m) return `${m[3]}${m[2]!.padStart(2, "0")}${m[1]!.padStart(2, "0")}`;
  return raw.replace(/\D/g, "");
}

/** DOB for display as dd/mm/yyyy (accepts iso or dmy). */
function fmtDob(s: string): string {
  const raw = (s || "").trim();
  if (!raw || udiseIsBlank(raw)) return "";
  let m = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[3]!.padStart(2, "0")}/${m[2]!.padStart(2, "0")}/${m[1]}`;
  m = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return `${m[1]!.padStart(2, "0")}/${m[2]!.padStart(2, "0")}/${m[3]}`;
  return raw;
}

/** Treat portal NA / empty / NOT AVAILABLE as missing. */
export function udiseIsBlank(v: string): boolean {
  const s = (v || "").trim();
  if (!s) return true;
  if (/^na$/i.test(s)) return true;
  if (/not available/i.test(s)) return true;
  if (/^n\/?a$/i.test(s)) return true;
  return false;
}

/** Extract last 4 digits from masked Aadhaar/APAAR (********6649) or full number. */
export function extractLast4(raw: string): string {
  if (udiseIsBlank(raw)) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 4) return digits.slice(-4);
  return "";
}

export function cleanPen(raw: string): string {
  if (udiseIsBlank(raw)) return "";
  const cleaned = raw.replace(/\s+/g, "").replace(/\.0+$/, "");
  // Imports often write "0" / "000" as a PEN placeholder — treat as missing.
  if (/^0+$/.test(cleaned)) return "";
  return cleaned;
}

export function cleanApaar(raw: string): string {
  if (udiseIsBlank(raw)) return "";
  const s = raw.trim();
  // Prefer digit-only when full APAAR; keep mask form otherwise
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 12) return digits.slice(0, 12);
  if (/^\*+\d{4}$/.test(s) || digits.length === 4) return s.includes("*") ? s : digits;
  return s;
}

export function mapUdiseSocialCategory(raw: string): StudentCategory {
  const s = raw.toLowerCase();
  if (s.includes("ews")) return "EWS";
  if (/\bsc\b/.test(s) || s.includes("scheduled caste") || s.startsWith("2-"))
    return "SC";
  if (/\bst\b/.test(s) || s.includes("scheduled tribe") || s.startsWith("3-"))
    return "ST";
  if (s.includes("obc") || s.includes("other backward") || s.startsWith("4-"))
    return "OBC";
  if (s.includes("general") || s.includes("gen") || s.startsWith("1-"))
    return "GEN";
  return "";
}

export function mapUdiseGender(raw: string): SisStudent["gender"] {
  const s = raw.trim().toLowerCase();
  if (s.startsWith("f") || s === "girl") return "F";
  if (s.startsWith("m") || s === "boy") return "M";
  if (s.startsWith("o")) return "O";
  return "";
}

/**
 * Map UDISE class labels like "Nursery/KG/PP3", "LKG/KG1/PP2", "I" → school class id.
 */
export function resolveUdiseClassId(
  classHint: string,
  masters: MastersState,
): string {
  const raw = classHint.trim();
  if (!raw) return "";
  const primary = raw.split("/")[0]!.trim().toLowerCase();
  const aliases: Record<string, string[]> = {
    nursery: ["nursery", "nur", "pp3", "prekg"],
    lkg: ["lkg", "kg1", "pp2"],
    ukg: ["ukg", "kg2", "pp1"],
  };
  for (const c of masters.classes) {
    const cn = c.name.toLowerCase().replace(/\s+/g, "");
    if (cn === primary.replace(/\s+/g, "")) return c.id;
    for (const [canon, keys] of Object.entries(aliases)) {
      if (
        (keys.includes(primary.replace(/\s+/g, "")) || primary === canon) &&
        (cn === canon || keys.includes(cn))
      ) {
        return c.id;
      }
    }
  }
  // Roman / numeric class (I–XII)
  const found = masters.classes.find(
    (c) =>
      c.name.toLowerCase() === primary ||
      c.name.toLowerCase() === raw.toLowerCase(),
  );
  return found?.id || "";
}

export function findUdiseHeaderRow(
  matrix: unknown[][],
): { headerRow: number; col: Record<string, number> } | null {
  for (let r = 0; r < Math.min(matrix.length, 40); r++) {
    const norms = (matrix[r] || []).map((c) => normHeader(cellStr(c)));
    const idx = (preds: ((n: string) => boolean)[]) => {
      for (let i = 0; i < norms.length; i++) {
        if (preds.every((p) => p(norms[i]))) return i;
      }
      return -1;
    };
    const isNameCol = (n: string) =>
      (n === "name" ||
        n.includes("student name") ||
        n.includes("name of student") ||
        n.includes("student s name") ||
        n.includes("pupil name") ||
        n.includes("child name")) &&
      !n.includes("father") &&
      !n.includes("mother") &&
      !n.includes("guardian") &&
      !n.includes("as per");
    const name = idx([isNameCol]);
    // PEN header comes in many shapes: "Student PEN", "PEN", "PEN No",
    // "PEN Number", "Pupil PEN". Match "pen" as a whole word (avoids
    // "pending", "open", "expenditure", etc.).
    const pen = idx([(n) => /(^| )pen( |$)/.test(n)]);
    const father = idx([(n) => n.includes("father")]);
    // A valid students-details header must have a Name column plus at least
    // one corroborating student column (PEN or Father) so we don't misfire
    // on unrelated tables whose header naming differs.
    if (name < 0 || (pen < 0 && father < 0)) continue;
    return {
      headerRow: r,
      col: {
        className: idx([(n) => n === "class" || n.startsWith("class ")]),
        section: idx([(n) => n === "section"]),
        name,
        gender: idx([(n) => n === "gender" || n === "sex"]),
        dob: idx([
          (n) =>
            n.includes("date of birth") ||
            n === "dob" ||
            n.includes("birth date") ||
            n === "birth",
        ]),
        sdms: idx([(n) => n.includes("initialised") || n.includes("sdms")]),
        pen,
        stateCode: idx([(n) => n.includes("state code")]),
        fatherName: idx([(n) => n.includes("father")]),
        motherName: idx([(n) => n.includes("mother")]),
        socialCategory: idx([
          (n) => n.includes("social category") || n === "category",
        ]),
        minority: idx([(n) => n.includes("minority")]),
        bpl: idx([(n) => n.includes("bpl")]),
        cwsn: idx([(n) => n === "cwsn"]),
        entryStatus: idx([(n) => n.includes("entry status")]),
        aadhaar: idx([
          (n) => n.includes("aadhaar no") || n === "aadhaar" || n === "aadhar",
        ]),
        aadhaarName: idx([(n) => n.includes("name as per aadhaar")]),
        aadhaarValidation: idx([(n) => n.includes("aadhaar validation")]),
        apaar: idx([
          (n) => n.includes("apaar id") || n === "apaar" || n.startsWith("apaar"),
        ]),
        apaarStatus: idx([(n) => n.includes("apaar status")]),
        suspectedDuplicate: idx([(n) => n.includes("suspected duplicate")]),
        mbu: idx([(n) => n.includes("mbu")]),
      },
    };
  }
  return null;
}

export function parseUdiseStudentDetailsMatrix(
  matrix: unknown[][],
): UdiseStudentRow[] {
  const detected = findUdiseHeaderRow(matrix);
  if (!detected) return [];
  const { headerRow, col } = detected;
  const get = (row: unknown[], key: string) => {
    const i = col[key];
    return i != null && i >= 0 ? cellStr(row[i]) : "";
  };
  const out: UdiseStudentRow[] = [];
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const fullName = get(row, "name");
    const pen = cleanPen(get(row, "pen"));
    if (!fullName) continue;
    if (/^list of all/i.test(fullName)) continue;
    out.push({
      classHint: get(row, "className"),
      sectionHint: get(row, "section"),
      fullName,
      gender: get(row, "gender"),
      dob: get(row, "dob"),
      sdmsYear: get(row, "sdms"),
      pen,
      stateCode: get(row, "stateCode"),
      fatherName: get(row, "fatherName"),
      motherName: get(row, "motherName"),
      socialCategory: get(row, "socialCategory"),
      minorityGroup: get(row, "minority"),
      bpl: get(row, "bpl"),
      cwsn: get(row, "cwsn"),
      entryStatus: get(row, "entryStatus"),
      aadhaarRaw: get(row, "aadhaar"),
      aadhaarName: get(row, "aadhaarName"),
      aadhaarValidation: get(row, "aadhaarValidation"),
      apaarId: cleanApaar(get(row, "apaar")),
      apaarStatus: get(row, "apaarStatus"),
      suspectedDuplicate: get(row, "suspectedDuplicate"),
      mbuStatus: get(row, "mbu"),
    });
  }
  return out;
}

function activeStudents(sis: SisState): SisStudent[] {
  return sis.students.filter((s) => s.status === "active");
}

/**
 * One record per child (by admission no) for matching. A promoted student has a
 * record in each session — collapse them so the same child is not treated as
 * many candidates. Preference: the selected-year record (even if inactive, that
 * is the child's current-year truth), else the active record, else the latest.
 */
function buildChildRepresentativePool(
  students: SisStudent[],
  academicYearCode?: string,
): SisStudent[] {
  const scope = academicYearCode ? ayVal(academicYearCode) : "";
  const byChild = new Map<string, SisStudent>();
  const pick = (a: SisStudent, b: SisStudent): SisStudent => {
    if (scope) {
      const aScope = ayVal(a.academicYearCode) === scope;
      const bScope = ayVal(b.academicYearCode) === scope;
      if (aScope !== bScope) return aScope ? a : b;
    }
    const aActive = a.status === "active";
    const bActive = b.status === "active";
    if (aActive !== bActive) return aActive ? a : b;
    return ayVal(a.academicYearCode) >= ayVal(b.academicYearCode) ? a : b;
  };
  for (const s of students) {
    const key = s.admissionNo.trim().toUpperCase() || s.id;
    const prev = byChild.get(key);
    byChild.set(key, prev ? pick(prev, s) : s);
  }
  return [...byChild.values()];
}

/** Levenshtein edit distance (small strings — names). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

/** Name similarity 0..1 on normalized names (1 = identical). */
export function nameSimilarity(a: string, b: string): number {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const dist = levenshtein(x, y);
  return 1 - dist / Math.max(x.length, y.length);
}

function matchStudent(
  row: UdiseStudentRow,
  pool: SisStudent[],
  masters: MastersState,
  options: UdiseMatchOptions = DEFAULT_UDISE_MATCH_OPTIONS,
): { student: SisStudent | null; method: UdiseMatchPreview["method"]; note: string } {
  const pen = cleanPen(row.pen);
  if (options.usePen && pen) {
    const byPen = pool.filter(
      (s) => cleanPen(s.pen) && cleanPen(s.pen) === pen,
    );
    if (byPen.length === 1) {
      return { student: byPen[0]!, method: "pen", note: "Matched existing PEN" };
    }
    if (byPen.length > 1) {
      return {
        student: null,
        method: "ambiguous",
        note: `PEN ${pen} matches ${byPen.length} SIS students`,
      };
    }
  }

  const apaar = cleanApaar(row.apaarId);
  if (options.useApaar && /^\d{12}$/.test(apaar)) {
    const byApaar = pool.filter((s) => {
      const a = cleanApaar(s.apaarId);
      return /^\d{12}$/.test(a) && a === apaar;
    });
    if (byApaar.length === 1) {
      return { student: byApaar[0]!, method: "apaar", note: "Matched existing APAAR" };
    }
    if (byApaar.length > 1) {
      return {
        student: null,
        method: "ambiguous",
        note: `APAAR matches ${byApaar.length} SIS students`,
      };
    }
  }

  const a4 = extractLast4(row.aadhaarRaw);
  if (options.useAadhaar && a4) {
    const byA4 = pool.filter(
      (s) => (s.aadhaarLast4 || s.aadhaarNumber.slice(-4)) === a4,
    );
    if (byA4.length === 1) {
      return {
        student: byA4[0]!,
        method: "aadhaar",
        note: "Matched Aadhaar last-4",
      };
    }
    // last-4 is weak — don't ambiguate, fall through to name strategies
  }

  const nameKey = normName(row.fullName);
  const fatherKey = normName(row.fatherName);
  const classId = resolveUdiseClassId(row.classHint, masters);
  const sectionHint = row.sectionHint.trim().toLowerCase();

  const byName = pool.filter((s) => normName(s.fullName) === nameKey);

  if (byName.length) {
    if (options.useNameFather && fatherKey) {
      const withFather = byName.filter(
        (s) => normName(s.fatherName) === fatherKey,
      );
      if (withFather.length === 1) {
        if (classId) {
          const withClass = withFather.filter((s) => s.classId === classId);
          if (withClass.length === 1) {
            return {
              student: withClass[0]!,
              method: "name_father_class",
              note: "Matched name + father + class",
            };
          }
        }
        return {
          student: withFather[0]!,
          method: "name_father",
          note: "Matched name + father",
        };
      }
      if (withFather.length > 1 && classId) {
        const withClass = withFather.filter((s) => s.classId === classId);
        if (withClass.length === 1) {
          return {
            student: withClass[0]!,
            method: "name_father_class",
            note: "Matched name + father + class",
          };
        }
        if (withClass.length > 1 && sectionHint) {
          const withSec = withClass.filter((s) => {
            const sec = masters.sections.find((x) => x.id === s.sectionId);
            return (sec?.name || "").trim().toLowerCase() === sectionHint;
          });
          if (withSec.length === 1) {
            return {
              student: withSec[0]!,
              method: "name_class_section",
              note: "Matched name + father + class + section",
            };
          }
        }
        return {
          student: null,
          method: "ambiguous",
          note: `Name+father matches ${withFather.length} students`,
        };
      }
    }

    if (options.useNameClass && classId) {
      let withClass = byName.filter((s) => s.classId === classId);
      if (sectionHint && withClass.length > 1) {
        const withSec = withClass.filter((s) => {
          const sec = masters.sections.find((x) => x.id === s.sectionId);
          return (sec?.name || "").trim().toLowerCase() === sectionHint;
        });
        if (withSec.length === 1) {
          return {
            student: withSec[0]!,
            method: "name_class_section",
            note: "Matched name + class + section",
          };
        }
        withClass = withSec.length ? withSec : withClass;
      }
      if (withClass.length === 1) {
        return {
          student: withClass[0]!,
          method: "name_class_section",
          note: "Matched name + class",
        };
      }
      if (withClass.length > 1) {
        return {
          student: null,
          method: "ambiguous",
          note: `Name+class matches ${withClass.length} students — check father name`,
        };
      }
    }

    if (options.useNameUnique && byName.length === 1) {
      return {
        student: byName[0]!,
        method: "name_unique",
        note: "Matched unique name in SIS",
      };
    }

    if (byName.length > 1 && !options.fuzzy) {
      return {
        student: null,
        method: "ambiguous",
        note: `Name matches ${byName.length} SIS students`,
      };
    }
  }

  // Fuzzy fallback — spelling-tolerant name (+ father when available).
  if (options.fuzzy && nameKey) {
    const th = options.fuzzyThreshold;
    let best: SisStudent | null = null;
    let bestScore = 0;
    let secondScore = 0;
    for (const s of pool) {
      const ns = nameSimilarity(row.fullName, s.fullName);
      if (ns < th) continue;
      let ok: boolean;
      if (fatherKey && normName(s.fatherName)) {
        ok =
          normName(s.fatherName) === fatherKey ||
          nameSimilarity(row.fatherName, s.fatherName) >= th;
      } else {
        ok = ns >= Math.max(th, 0.9);
      }
      if (!ok) continue;
      let score = ns;
      if (classId && s.classId === classId) score += 0.05;
      if (score > bestScore) {
        secondScore = bestScore;
        bestScore = score;
        best = s;
      } else if (score > secondScore) {
        secondScore = score;
      }
    }
    if (best && bestScore - secondScore >= 0.02) {
      return {
        student: best,
        method: "fuzzy_name_father",
        note: `Fuzzy name match (${Math.round(Math.min(bestScore, 1) * 100)}%)`,
      };
    }
    if (best) {
      return {
        student: null,
        method: "ambiguous",
        note: "Fuzzy match ambiguous — multiple close names",
      };
    }
  }

  if (!byName.length) {
    return { student: null, method: "unmatched", note: "No name match in SIS" };
  }
  return {
    student: null,
    method: "ambiguous",
    note: `Name matches ${byName.length} SIS students`,
  };
}

export function isMbuAgePending(mbuStatus: string): boolean {
  return /mbu\s*pending/i.test(mbuStatus || "");
}

function aadhaarOfficialName(row: UdiseStudentRow): string {
  const n = (row.aadhaarName || "").trim();
  if (!n || udiseIsBlank(n)) return "";
  if (/^not available$/i.test(n)) return "";
  return n;
}

function namesDiffer(a: string, b: string): boolean {
  return normName(a) !== normName(b) && !!normName(a) && !!normName(b);
}

function buildPatch(
  student: SisStudent,
  row: UdiseStudentRow,
): UdiseMatchPreview["willUpdate"] {
  const will: UdiseMatchPreview["willUpdate"] = {};
  // Never patch classId / sectionId — UDISE+ class can be wrong.

  const pen = cleanPen(row.pen);
  if (pen && cleanPen(student.pen) !== pen) {
    will.pen = pen;
    will.penStatus = "has_pen";
  } else if (
    pen &&
    student.penStatus !== "has_pen" &&
    student.penStatus !== "linked"
  ) {
    will.penStatus = "has_pen";
  }

  const apaar = cleanApaar(row.apaarId);
  if (apaar && (student.apaarId || "").trim() !== apaar) {
    will.apaarId = apaar;
  }

  const a4 = extractLast4(row.aadhaarRaw);
  const verified = /^verified$/i.test((row.aadhaarValidation || "").trim());
  if (a4 && student.aadhaarLast4 !== a4) {
    will.aadhaarLast4 = a4;
  }
  if (verified && a4) {
    // Only flag a change when the student isn't already verified by UDISE+.
    if (student.aadhaarVerification !== "verified_udise") {
      will.aadhaarVerification = "verified_udise";
      // Aadhaar now govt-verified — drop any stored full number if present.
      if (student.aadhaarNumber) will.aadhaarNumber = "";
      if (!will.aadhaarLast4 && student.aadhaarLast4 !== a4) will.aadhaarLast4 = a4;
    }
  } else if (
    a4 &&
    student.aadhaarVerification !== "verified_udise" &&
    student.aadhaarVerification !== "received"
  ) {
    will.aadhaarVerification = "received";
  }

  // Prefer Name as per AADHAAR when spelling differs from SIS
  const official = aadhaarOfficialName(row);
  if (official && namesDiffer(official, student.fullName)) {
    will.fullName = official;
  }

  if (
    row.fatherName &&
    !udiseIsBlank(row.fatherName) &&
    (!student.fatherName.trim() ||
      namesDiffer(row.fatherName, student.fatherName))
  ) {
    will.fatherName = row.fatherName.trim();
  }

  if (
    row.motherName &&
    !udiseIsBlank(row.motherName) &&
    (!student.motherName.trim() ||
      namesDiffer(row.motherName, student.motherName))
  ) {
    will.motherName = row.motherName.trim();
  }

  const cat = mapUdiseSocialCategory(row.socialCategory);
  if (cat && cat !== student.category) {
    will.category = cat;
  }

  const g = mapUdiseGender(row.gender);
  if (g && g !== student.gender) {
    will.gender = g;
  }

  // DOB: only auto-fill when SIS is blank. When both exist and differ, we never
  // silently overwrite — it's surfaced as a mismatch for the operator instead.
  const portalDobKey = normDobKey(row.dob);
  if (portalDobKey && !normDobKey(student.dob)) {
    will.dob = fmtDob(row.dob);
  }

  const aval = (row.aadhaarValidation || "").trim();
  // Record the portal validation status only when it actually differs — this
  // covers both "Verified" and "Failed" without re-flagging an unchanged row.
  if (aval && aval !== student.udiseAadhaarValidationStatus) {
    will.udiseAadhaarValidationStatus = aval;
  }

  const mbu = (row.mbuStatus || "").trim();
  if (mbu && mbu !== student.udiseMbuStatus) {
    will.udiseMbuStatus = mbu;
  }
  const ageAlert = isMbuAgePending(mbu);
  if (ageAlert !== !!student.udiseAgeBelowClassAlert) {
    will.udiseAgeBelowClassAlert = ageAlert;
  }

  const portalClass = (row.classHint || "").trim();
  if (portalClass && portalClass !== student.udisePortalClassHint) {
    will.udisePortalClassHint = portalClass;
  }

  return will;
}

function fillLabelsOf(will: UdiseMatchPreview["willUpdate"]): string[] {
  const labels: string[] = [];
  if (will.fullName) labels.push(`Name (Aadhaar) → ${will.fullName}`);
  if (will.fatherName) labels.push(`Father → ${will.fatherName}`);
  if (will.motherName) labels.push(`Mother → ${will.motherName}`);
  if (will.pen) labels.push(`PEN → ${will.pen}`);
  if (will.penStatus && !will.pen) labels.push(`PEN status → ${will.penStatus}`);
  if (will.apaarId) labels.push(`APAAR → ${will.apaarId}`);
  if (will.aadhaarLast4) labels.push(`Aadhaar ****${will.aadhaarLast4}`);
  if (will.aadhaarVerification === "verified_udise") {
    labels.push("Aadhaar mark verified by UDISE+");
  } else if (will.aadhaarVerification === "received") {
    labels.push("Aadhaar received");
  }
  if (will.udiseAadhaarValidationStatus) {
    labels.push(`Aadhaar validation → ${will.udiseAadhaarValidationStatus}`);
  }
  if (will.udiseMbuStatus) labels.push(`MBU → ${will.udiseMbuStatus}`);
  if (will.udiseAgeBelowClassAlert) {
    labels.push("⚠ Age/MBU pending for class (govt)");
  }
  if (will.udisePortalClassHint) {
    labels.push(`UDISE+ class noted → ${will.udisePortalClassHint}`);
  }
  if (will.gender) labels.push(`Gender → ${will.gender}`);
  if (will.category) labels.push(`Category → ${will.category}`);
  if (will.dob) labels.push(`DOB → ${will.dob}`);
  return labels;
}

function sisFilledOf(
  student: SisStudent | null,
  masters: MastersState,
): UdiseMatchPreview["sisFilled"] {
  if (!student) {
    return {
      fullName: "",
      pen: "",
      apaarId: "",
      aadhaar: "",
      aadhaarVerification: "missing",
      motherName: "",
      fatherName: "",
      gender: "",
      category: "",
      sisClassLabel: "",
    };
  }
  const a4 = student.aadhaarLast4 || student.aadhaarNumber.slice(-4);
  const cls =
    masters.classes.find((c) => c.id === student.classId)?.name || "—";
  const sec =
    masters.sections.find((s) => s.id === student.sectionId)?.name || "";
  return {
    fullName: student.fullName || "",
    pen: student.pen || "",
    apaarId: student.apaarId || "",
    aadhaar: a4
      ? student.aadhaarVerification === "verified_udise"
        ? `********${a4}`
        : student.aadhaarNumber || `********${a4}`
      : "",
    aadhaarVerification: student.aadhaarVerification || "missing",
    motherName: student.motherName || "",
    fatherName: student.fatherName || "",
    gender: student.gender || "",
    category: student.category || "",
    sisClassLabel: sec ? `${cls}-${sec}` : cls,
  };
}

function isPortalSuspect(row: UdiseStudentRow): boolean {
  const s = (row.suspectedDuplicate || "").trim().toLowerCase();
  return s === "yes" || s === "y" || s === "true" || s === "1";
}

function buildPreviewRow(
  udise: UdiseStudentRow,
  rowIndex: number,
  student: SisStudent | null,
  method: UdiseMatchPreview["method"],
  note: string,
  masters: MastersState,
  sisInactive = false,
): UdiseMatchPreview {
  const portalSuspect = isPortalSuspect(udise);
  const portalAadhaarVerified = /^verified$/i.test(
    (udise.aadhaarValidation || "").trim(),
  );
  const mbuAgeAlert = isMbuAgePending(udise.mbuStatus);
  // Representative record may itself be inactive (left / TC / promoted-out) —
  // derive from status so a single-pass match still flags it correctly.
  const inactive = !!student && (sisInactive || student.status !== "active");
  // Never auto-fill an inactive SIS record — just flag it for the operator.
  const willUpdate = student && !inactive ? buildPatch(student, udise) : {};
  const fillLabels = fillLabelsOf(willUpdate);
  const sisFilled = sisFilledOf(student, masters);

  const udiseClassId = resolveUdiseClassId(udise.classHint, masters);
  const classMismatch = !!(
    student &&
    udiseClassId &&
    student.classId &&
    udiseClassId !== student.classId
  );

  const udiseDob = fmtDob(udise.dob);
  const sisDob = student ? fmtDob(student.dob) : "";
  const dobMismatch = !!(
    student &&
    !inactive &&
    normDobKey(udise.dob) &&
    normDobKey(student.dob) &&
    normDobKey(udise.dob) !== normDobKey(student.dob)
  );

  let tone: UdiseRowTone = "ok";
  let actionHint = "";

  if (inactive && student) {
    tone = "inactive";
    actionHint = `Student exists in SIS but is INACTIVE (${student.status || "inactive"} · session ${student.academicYearCode || "—"}). Reactivate / promote in SIS to bring them onto UDISE+ for this year.`;
  } else if (mbuAgeAlert && student) {
    tone = "mbu_age";
    actionHint = `⚠ MBU Pending — age below / biometric pending for this class (govt). UDISE+ class: ${udise.classHint || "—"}. SIS class unchanged: ${sisFilled.sisClassLabel}.`;
  } else if (method === "ambiguous") {
    tone = "ambiguous";
    actionHint = "Resolve duplicate SIS matches before sync";
  } else if (!student || method === "unmatched") {
    tone = "suspect";
    actionHint = portalSuspect
      ? "Portal marks Suspected Duplicate · not in SIS — review before migrate"
      : "Not in SIS — migrate only if genuine (fee group required unless RTE)";
  } else if (fillLabels.length) {
    tone = "fill";
    actionHint =
      "Apply sync to update SIS fields (class never changed from UDISE+)";
  } else if (student.aadhaarVerification !== "verified_udise") {
    tone = "verify";
    actionHint =
      "Verify student Aadhaar on UDISE+ · then tick Verified in ERP";
  } else if (!student.pen) {
    tone = "verify";
    actionHint =
      "Student Aadhaar verified · generate / sync PEN from UDISE+";
  } else if (!student.apaarId?.trim()) {
    tone = "verify";
    actionHint =
      "PEN ok · APAAR still needs parent Aadhaar on UDISE+ then generate APAAR (not auto from student Aadhaar alone)";
  } else {
    tone = "ok";
    actionHint = "In sync · student Aadhaar verified · PEN & APAAR present";
  }

  if (classMismatch) {
    actionHint =
      `${actionHint} · UDISE+ class may be wrong: portal shows “${udise.classHint}”, SIS has “${sisFilled.sisClassLabel}” (SIS class not updated).`.trim();
  }

  if (dobMismatch) {
    actionHint =
      `${actionHint} · ⚠ DOB differs — SIS ${sisDob} vs UDISE+ ${udiseDob} (verify & correct; not auto-updated).`.trim();
  }

  return {
    rowIndex,
    udise,
    studentId: student?.id ?? null,
    admissionNo: student?.admissionNo ?? "",
    matchedName: student?.fullName ?? "",
    method,
    willUpdate,
    sisFilled,
    fillLabels,
    tone,
    sisInactive: inactive,
    sisStatus: student ? student.status || "" : "",
    sisSession: student ? student.academicYearCode || "" : "",
    portalSuspect,
    portalAadhaarVerified,
    classMismatch,
    udiseClassHint: udise.classHint || "—",
    sisClassLabel: sisFilled.sisClassLabel || "—",
    mbuAgeAlert,
    dobMismatch,
    udiseDob,
    sisDob,
    aadhaarValidationStatus: udise.aadhaarValidation || "—",
    mbuStatus: udise.mbuStatus || "—",
    actionHint,
    note,
  };
}

export function previewUdiseStudentDetailsSync(
  matrix: unknown[][],
  sis?: SisState,
  masters?: MastersState,
  options: UdiseMatchOptions = DEFAULT_UDISE_MATCH_OPTIONS,
  academicYearCode?: string,
): {
  rows: UdiseStudentRow[];
  preview: UdiseMatchPreview[];
  formatOk: boolean;
} {
  const m = masters ?? loadMasters();
  const state = sis ?? loadSis();
  const rows = parseUdiseStudentDetailsMatrix(matrix);
  const formatOk = !!findUdiseHeaderRow(matrix);
  // One record per child (promoted students collapse across sessions) so the
  // same child is not seen as multiple candidates, and inactive/left students
  // surface correctly instead of hiding behind an old active session record.
  const pool = buildChildRepresentativePool(state.students, academicYearCode);
  const preview: UdiseMatchPreview[] = rows.map((udise, i) => {
    const { student, method, note } = matchStudent(udise, pool, m, options);
    return buildPreviewRow(udise, i + 1, student, method, note, m);
  });
  return { rows, preview, formatOk };
}

/**
 * Apply UDISE+ Students_Details sync: update PEN / APAAR / Aadhaar last-4 on matched SIS students.
 * Does not create new students.
 */
export function applyUdiseStudentDetailsSync(
  matrix: unknown[][],
  sis?: SisState,
  masters?: MastersState,
  options: UdiseMatchOptions = DEFAULT_UDISE_MATCH_OPTIONS,
  academicYearCode?: string,
): UdiseImportResult {
  const m = masters ?? loadMasters();
  const state = sis ?? loadSis();
  const { preview, rows } = previewUdiseStudentDetailsSync(
    matrix,
    state,
    m,
    options,
    academicYearCode,
  );

  let matched = 0;
  let updated = 0;
  let unmatched = 0;
  let ambiguous = 0;
  let inactive = 0;
  let skippedNoChange = 0;
  const students = [...state.students];
  const touched = new Set<string>();

  for (const p of preview) {
    if (p.method === "unmatched") {
      unmatched += 1;
      continue;
    }
    if (p.method === "ambiguous" || !p.studentId) {
      ambiguous += 1;
      continue;
    }
    if (p.sisInactive) {
      // Matched an inactive SIS student — do not silently modify it.
      inactive += 1;
      continue;
    }
    matched += 1;
    if (touched.has(p.studentId)) {
      skippedNoChange += 1;
      continue;
    }
    const idx = students.findIndex((s) => s.id === p.studentId);
    if (idx < 0) continue;
    const cur = students[idx]!;
    const patchKeys = Object.keys(p.willUpdate);
    // Found on our UDISE+ Students_Details → Drop Box / release indication done
    const shouldClearInbound = !!cur.udiseInboundTransferPending;
    if (!patchKeys.length && !shouldClearInbound) {
      skippedNoChange += 1;
      continue;
    }
    const next = normalizeStudent({
      ...cur,
      // Never change classId / sectionId from UDISE+ upload
      fullName: p.willUpdate.fullName ?? cur.fullName,
      fatherName: p.willUpdate.fatherName ?? cur.fatherName,
      motherName: p.willUpdate.motherName ?? cur.motherName,
      pen: p.willUpdate.pen ?? cur.pen,
      penStatus: (p.willUpdate.penStatus ?? cur.penStatus) as PenStatus,
      apaarId: p.willUpdate.apaarId ?? cur.apaarId,
      aadhaarLast4: p.willUpdate.aadhaarLast4 ?? cur.aadhaarLast4,
      aadhaarNumber:
        p.willUpdate.aadhaarVerification === "verified_udise"
          ? ""
          : (p.willUpdate.aadhaarNumber ?? cur.aadhaarNumber),
      aadhaarVerification:
        p.willUpdate.aadhaarVerification ?? cur.aadhaarVerification,
      category: p.willUpdate.category ?? cur.category,
      gender: p.willUpdate.gender ?? cur.gender,
      dob: p.willUpdate.dob ?? cur.dob,
      udiseAadhaarValidationStatus:
        p.willUpdate.udiseAadhaarValidationStatus ??
        cur.udiseAadhaarValidationStatus,
      udiseMbuStatus: p.willUpdate.udiseMbuStatus ?? cur.udiseMbuStatus,
      udisePortalClassHint:
        p.willUpdate.udisePortalClassHint ?? cur.udisePortalClassHint,
      udiseAgeBelowClassAlert:
        p.willUpdate.udiseAgeBelowClassAlert ?? cur.udiseAgeBelowClassAlert,
      udiseInboundTransferPending: shouldClearInbound
        ? false
        : cur.udiseInboundTransferPending,
      notes: [
        cur.notes,
        patchKeys.length
          ? `UDISE+ sync ${new Date().toISOString().slice(0, 10)}: ${patchKeys.join(", ")}`
          : "",
        shouldClearInbound
          ? `UDISE+ Drop Box / release cleared ${new Date().toISOString().slice(0, 10)} (found on Students_Details)`
          : "",
        p.classMismatch
          ? `Note: UDISE+ class “${p.udiseClassHint}” ≠ SIS “${p.sisClassLabel}” (SIS class kept)`
          : "",
        p.mbuAgeAlert
          ? `ALERT: ${p.mbuStatus} — age/biometric pending for class`
          : "",
      ]
        .filter(Boolean)
        .join(" · "),
    });
    students[idx] = next;
    touched.add(p.studentId);
    updated += 1;
  }

  // Also clear inbound pending when PEN appears in file even if name match failed earlier —
  // second pass by PEN only for pending students
  const pensInFile = new Set(
    rows.map((r) => cleanPen(r.pen)).filter(Boolean),
  );
  const namesInFile = new Set(
    rows.map((r) => normName(r.fullName)).filter(Boolean),
  );
  for (let i = 0; i < students.length; i++) {
    const cur = students[i]!;
    if (!cur.udiseInboundTransferPending || touched.has(cur.id)) continue;
    const pen = cleanPen(cur.pen);
    const byPen = pen && pensInFile.has(pen);
    const byName = namesInFile.has(normName(cur.fullName));
    if (!byPen && !byName) continue;
    students[i] = normalizeStudent({
      ...cur,
      udiseInboundTransferPending: false,
      notes: [
        cur.notes,
        `UDISE+ Drop Box / release cleared ${new Date().toISOString().slice(0, 10)} (found on Students_Details)`,
      ]
        .filter(Boolean)
        .join(" · "),
    });
    updated += 1;
  }

  const nextState: SisState = { ...state, students };
  saveSis(nextState);
  return {
    ok: true,
    total: rows.length,
    matched,
    updated,
    unmatched,
    ambiguous,
    inactive,
    skippedNoChange,
    preview: previewUdiseStudentDetailsSync(
      matrix,
      nextState,
      m,
      options,
      academicYearCode,
    ).preview,
    state: nextState,
  };
}

function ayVal(code: string): string {
  const t = (code || "").trim().replace(/\s+/g, "").replace(/–/g, "-");
  const full = t.match(/^(20\d{2})-(20\d{2})$/);
  if (full) return `${full[1]}-${full[2]!.slice(2)}`;
  return t;
}

export type UdiseCandidate = {
  student: SisStudent;
  classLabel: string;
  reasons: string[];
};

/**
 * All SIS students (active + inactive, any session) a UDISE row could refer to.
 * Used to manually resolve an ambiguous match.
 */
export function findUdiseMatchCandidates(
  row: UdiseStudentRow,
  sis?: SisState,
  masters?: MastersState,
): UdiseCandidate[] {
  const state = sis ?? loadSis();
  const m = masters ?? loadMasters();
  const hits = new Map<string, Set<string>>();
  const add = (s: SisStudent, reason: string) => {
    const set = hits.get(s.id) ?? new Set<string>();
    set.add(reason);
    hits.set(s.id, set);
  };
  const pen = cleanPen(row.pen);
  const apaar = cleanApaar(row.apaarId);
  const a4 = extractLast4(row.aadhaarRaw);
  const nameKey = normName(row.fullName);
  const fatherKey = normName(row.fatherName);
  for (const s of state.students) {
    if (pen && cleanPen(s.pen) === pen) add(s, "same PEN");
    if (/^\d{12}$/.test(apaar) && cleanApaar(s.apaarId) === apaar) {
      add(s, "same APAAR");
    }
    if (a4 && (s.aadhaarLast4 || s.aadhaarNumber.slice(-4)) === a4) {
      add(s, "same Aadhaar last-4");
    }
    if (nameKey && normName(s.fullName) === nameKey) {
      add(s, fatherKey && normName(s.fatherName) === fatherKey ? "same name + father" : "same name");
    }
  }
  const byId = new Map(state.students.map((s) => [s.id, s] as const));
  // Collapse the same child (promoted across sessions) to one candidate row —
  // prefer their active / latest-session record.
  const byChild = new Map<
    string,
    { student: SisStudent; reasons: Set<string> }
  >();
  for (const [id, reasons] of hits.entries()) {
    const student = byId.get(id)!;
    const key = student.admissionNo.trim().toUpperCase() || student.id;
    const prev = byChild.get(key);
    if (!prev) {
      byChild.set(key, { student, reasons: new Set(reasons) });
      continue;
    }
    reasons.forEach((r) => prev.reasons.add(r));
    const better =
      (student.status === "active") !== (prev.student.status === "active")
        ? student.status === "active"
        : ayVal(student.academicYearCode) >
          ayVal(prev.student.academicYearCode);
    if (better) prev.student = student;
  }
  return [...byChild.values()]
    .map(({ student, reasons }) => {
      const cls = m.classes.find((c) => c.id === student.classId)?.name || "—";
      const sec = m.sections.find((x) => x.id === student.sectionId)?.name || "";
      return {
        student,
        classLabel: sec ? `${cls}-${sec}` : cls,
        reasons: [...reasons],
      };
    })
    .sort((a, b) => {
      if (a.student.status !== b.student.status) {
        return a.student.status === "active" ? -1 : 1;
      }
      return ayVal(b.student.academicYearCode).localeCompare(
        ayVal(a.student.academicYearCode),
      );
    });
}

/**
 * Apply a single UDISE row's data to one specific SIS student — used to resolve
 * ambiguous matches, or push data onto an inactive / other-session record.
 * Optionally reactivate the student.
 */
export function applyUdiseRowToStudent(input: {
  row: UdiseStudentRow;
  studentId: string;
  reactivate?: boolean;
  sis?: SisState;
  masters?: MastersState;
}):
  | { ok: true; state: SisState; student: SisStudent; fields: string[] }
  | { ok: false; error: string } {
  const state = input.sis ?? loadSis();
  const idx = state.students.findIndex((s) => s.id === input.studentId);
  if (idx < 0) return { ok: false, error: "Student not found in SIS" };
  const cur = state.students[idx]!;
  const will = buildPatch(cur, input.row);
  const fields = Object.keys(will);
  if (!fields.length && !input.reactivate && cur.status === "active") {
    return { ok: false, error: "Nothing to update on this student" };
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const students = [...state.students];
  students[idx] = normalizeStudent({
    ...cur,
    status: input.reactivate ? "active" : cur.status,
    fullName: will.fullName ?? cur.fullName,
    fatherName: will.fatherName ?? cur.fatherName,
    motherName: will.motherName ?? cur.motherName,
    pen: will.pen ?? cur.pen,
    penStatus: (will.penStatus ?? cur.penStatus) as PenStatus,
    apaarId: will.apaarId ?? cur.apaarId,
    aadhaarLast4: will.aadhaarLast4 ?? cur.aadhaarLast4,
    aadhaarNumber:
      will.aadhaarVerification === "verified_udise"
        ? ""
        : (will.aadhaarNumber ?? cur.aadhaarNumber),
    aadhaarVerification: will.aadhaarVerification ?? cur.aadhaarVerification,
    category: will.category ?? cur.category,
    gender: will.gender ?? cur.gender,
    dob: will.dob ?? cur.dob,
    udiseAadhaarValidationStatus:
      will.udiseAadhaarValidationStatus ?? cur.udiseAadhaarValidationStatus,
    udiseMbuStatus: will.udiseMbuStatus ?? cur.udiseMbuStatus,
    udisePortalClassHint: will.udisePortalClassHint ?? cur.udisePortalClassHint,
    udiseAgeBelowClassAlert:
      will.udiseAgeBelowClassAlert ?? cur.udiseAgeBelowClassAlert,
    udiseInboundTransferPending: false,
    notes: [
      cur.notes,
      `UDISE+ manual apply ${stamp}: ${fields.join(", ") || "no field change"}${
        input.reactivate ? " · reactivated" : ""
      }`,
    ]
      .filter(Boolean)
      .join(" · "),
  });
  const nextState: SisState = { ...state, students };
  saveSis(nextState);
  return { ok: true, state: nextState, student: students[idx]!, fields };
}

/**
 * Bring a student whose active record sits in another session into the target
 * (current) session, then apply the UDISE row. If a target-session record for
 * the same admission no already exists, applies onto that instead of creating a
 * duplicate. Class is taken from the UDISE portal hint when it resolves, else
 * the source record's class.
 */
export function promoteUdiseRowToSession(input: {
  row: UdiseStudentRow;
  sourceStudentId: string;
  targetAcademicYearCode: string;
  sis?: SisState;
  masters?: MastersState;
}):
  | {
      ok: true;
      state: SisState;
      student: SisStudent;
      fields: string[];
      created: boolean;
    }
  | { ok: false; error: string } {
  const state = input.sis ?? loadSis();
  const masters = input.masters ?? loadMasters();
  const target = ayVal(input.targetAcademicYearCode);
  if (!target) return { ok: false, error: "No target session selected" };

  const source = state.students.find((s) => s.id === input.sourceStudentId);
  if (!source) return { ok: false, error: "Source student not found in SIS" };

  const adm = source.admissionNo.trim().toUpperCase();
  // Already enrolled in the target session? Apply onto that record instead.
  const existing = state.students.find(
    (s) =>
      s.admissionNo.trim().toUpperCase() === adm &&
      ayVal(s.academicYearCode) === target,
  );
  if (existing) {
    const applied = applyUdiseRowToStudent({
      row: input.row,
      studentId: existing.id,
      reactivate: existing.status !== "active",
      sis: state,
      masters,
    });
    if (!applied.ok) return applied;
    return {
      ok: true,
      state: applied.state,
      student: applied.student,
      fields: applied.fields,
      created: false,
    };
  }

  const resolvedClass = resolveUdiseClassId(input.row.classHint, masters);
  const classId = resolvedClass || source.classId;
  const sectionId = classId === source.classId ? source.sectionId : "";
  const studentType: FeeStudentType =
    source.studentType === "RTE" ? "RTE" : "PROMOTE";

  const draft = normalizeStudent({
    ...source,
    id: newSisId("stu"),
    academicYearCode: input.targetAcademicYearCode,
    status: "active",
    studentType,
    classId,
    sectionId,
    curriculum: null,
    notes: [
      source.notes,
      `Promoted to ${input.targetAcademicYearCode} from UDISE+ apply ${new Date()
        .toISOString()
        .slice(0, 10)}`,
    ]
      .filter(Boolean)
      .join(" · "),
  });
  const withRow = normalizeStudent({
    ...draft,
    ...buildPatch(draft, input.row),
  });
  const fields = Object.keys(buildPatch(draft, input.row));
  const nextState: SisState = {
    ...state,
    students: [...state.students, withRow],
  };
  saveSis(nextState);
  return { ok: true, state: nextState, student: withRow, fields, created: true };
}

/** Toggle a matched SIS student's status (active ⇄ inactive) with a dated note. */
export function setUdiseStudentStatus(input: {
  studentId: string;
  status: "active" | "inactive";
  reason?: string;
  sis?: SisState;
}):
  | { ok: true; state: SisState; student: SisStudent }
  | { ok: false; error: string } {
  const state = input.sis ?? loadSis();
  const idx = state.students.findIndex((s) => s.id === input.studentId);
  if (idx < 0) return { ok: false, error: "Student not found in SIS" };
  const cur = state.students[idx]!;
  if (cur.status === input.status) {
    return { ok: false, error: `Student is already ${input.status}` };
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const students = [...state.students];
  students[idx] = normalizeStudent({
    ...cur,
    status: input.status,
    notes: [
      cur.notes,
      `Marked ${input.status} ${stamp}${input.reason ? ` · ${input.reason}` : ""}`,
    ]
      .filter(Boolean)
      .join(" · "),
  });
  const nextState: SisState = { ...state, students };
  saveSis(nextState);
  return { ok: true, state: nextState, student: students[idx]! };
}

/** Mark a matched SIS student inactive (e.g. left / TC / not really enrolled). */
export function markUdiseStudentInactive(input: {
  studentId: string;
  reason?: string;
  sis?: SisState;
}) {
  return setUdiseStudentStatus({ ...input, status: "inactive" });
}

/** Next academic-year code, e.g. "2025-26" → "2026-27". */
export function nextSessionCode(code: string): string {
  const m = (code || "").trim().match(/^(20\d{2})\s*[-–]\s*(\d{2,4})$/);
  if (!m) return "";
  const nextStart = Number(m[1]) + 1;
  return `${nextStart}-${String(nextStart + 1).slice(2)}`;
}

/** Active class ids in serial order (Nursery → XII). */
function orderedActiveClassIds(masters: MastersState): string[] {
  return sortClassIdsByClassBand(
    masters,
    masters.classes.filter((c) => c.isActive).map((c) => c.id),
  );
}

/** Class id one rank below the given class, or null if it is the lowest. */
export function classBelowId(
  masters: MastersState,
  classId: string,
): string | null {
  const ordered = orderedActiveClassIds(masters);
  const i = ordered.indexOf(classId);
  if (i <= 0) return null;
  return ordered[i - 1] ?? null;
}

/** All class ids below the given class (age-correction targets). */
export function lowerClassIds(
  masters: MastersState,
  classId: string,
): string[] {
  const ordered = orderedActiveClassIds(masters);
  const i = ordered.indexOf(classId);
  if (i <= 0) return [];
  return ordered.slice(0, i);
}

/** True when the class is the lowest active class (e.g. Nursery). */
export function isLowestActiveClass(
  masters: MastersState,
  classId: string,
): boolean {
  return !!classId && classBelowId(masters, classId) === null;
}

/** Lock / unlock a student from next-session promotion with a clear reason. */
export function setStudentPromotionLock(input: {
  studentId: string;
  locked: boolean;
  reason?: string;
  sis?: SisState;
}):
  | { ok: true; state: SisState; student: SisStudent }
  | { ok: false; error: string } {
  const state = input.sis ?? loadSis();
  const idx = state.students.findIndex((s) => s.id === input.studentId);
  if (idx < 0) return { ok: false, error: "Student not found in SIS" };
  const cur = state.students[idx]!;
  if (cur.promotionLocked === input.locked) {
    return {
      ok: false,
      error: input.locked
        ? "Student is already locked for promotion"
        : "Student is not locked for promotion",
    };
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const reason = input.locked
    ? input.reason?.trim() ||
      cur.promotionLockReason ||
      "Under-age for class (UDISE MBU) — repeat same class next session"
    : "";
  const students = [...state.students];
  students[idx] = normalizeStudent({
    ...cur,
    promotionLocked: input.locked,
    promotionLockReason: reason,
    notes: [
      cur.notes,
      input.locked
        ? `Promotion locked ${stamp}: ${reason}`
        : `Promotion lock removed ${stamp}`,
    ]
      .filter(Boolean)
      .join(" · "),
  });
  const nextState: SisState = { ...state, students };
  saveSis(nextState);
  return { ok: true, state: nextState, student: students[idx]! };
}

export type UdiseReconciliation = {
  /** Parsed data rows in the uploaded portal file. */
  fileRows: number;
  /** Rows with a real (non-placeholder) Student PEN. */
  filePenRows: number;
  /** Distinct real PENs in the file. */
  uniqueFilePens: number;
  /** Duplicate PEN rows in the file (filePenRows − uniqueFilePens). */
  duplicateFilePens: number;
  /** File rows matched to an SIS student. */
  matchedRows: number;
  /** Distinct SIS students matched. */
  matchedUniqueStudents: number;
  /** File rows with no SIS match (not admitted / name differs). */
  unmatchedRows: number;
  /** File rows matching more than one SIS student. */
  ambiguousRows: number;
  /** SIS active students in the selected year with a PEN — the "on UDISE+" count. */
  onUdiseSelectedYear: number;
  /** Matched students whose active record sits in another session. */
  matchedButOtherYear: number;
  /** Matched students that are inactive (TC/left). */
  matchedButInactive: number;
  /** Matched students whose SIS PEN is blank/placeholder (not applied yet). */
  matchedButPlaceholderPen: number;
  /** Distinct file PENs not found on any active SIS student. */
  penInFileNotInSis: number;
};

/**
 * Explains the gap between "students on the UDISE+ portal file" and the
 * "on UDISE+" count the app shows for the selected academic year.
 */
export function reconcileUdisePortalUpload(input: {
  matrix: unknown[][];
  sis?: SisState;
  masters?: MastersState;
  academicYearCode: string;
  options?: UdiseMatchOptions;
}): UdiseReconciliation {
  const state = input.sis ?? loadSis();
  const m = input.masters ?? loadMasters();
  const options = input.options ?? DEFAULT_UDISE_MATCH_OPTIONS;
  const { preview, rows } = previewUdiseStudentDetailsSync(
    input.matrix,
    state,
    m,
    options,
    input.academicYearCode,
  );
  const scope = ayVal(input.academicYearCode);

  const penList = rows.map((r) => cleanPen(r.pen)).filter(Boolean);
  const uniqueFilePens = new Set(penList);

  let matchedRows = 0;
  let unmatchedRows = 0;
  let ambiguousRows = 0;
  const matchedIds = new Set<string>();
  for (const p of preview) {
    if (p.method === "unmatched") {
      unmatchedRows += 1;
      continue;
    }
    if (p.method === "ambiguous" || !p.studentId) {
      ambiguousRows += 1;
      continue;
    }
    matchedRows += 1;
    matchedIds.add(p.studentId);
  }

  // Mirror listUdiseRegisteredStudents: active + selected year, deduped by adm no.
  const byChild = new Map<string, SisStudent>();
  for (const s of state.students) {
    if (s.status !== "active") continue;
    if (ayVal(s.academicYearCode) !== scope) continue;
    const key = s.admissionNo.trim().toUpperCase() || s.id;
    const prev = byChild.get(key);
    if (!prev || ayVal(s.academicYearCode) > ayVal(prev.academicYearCode)) {
      byChild.set(key, s);
    }
  }
  const onUdiseSelectedYear = [...byChild.values()].filter(
    (s) => !!cleanPen(s.pen),
  ).length;

  const byId = new Map(state.students.map((s) => [s.id, s] as const));
  let matchedButOtherYear = 0;
  let matchedButInactive = 0;
  let matchedButPlaceholderPen = 0;
  for (const id of matchedIds) {
    const s = byId.get(id);
    if (!s) continue;
    if (s.status !== "active") {
      matchedButInactive += 1;
      continue;
    }
    if (ayVal(s.academicYearCode) !== scope) {
      matchedButOtherYear += 1;
      continue;
    }
    if (!cleanPen(s.pen)) matchedButPlaceholderPen += 1;
  }

  const sisActivePens = new Set(
    state.students
      .filter((s) => s.status === "active")
      .map((s) => cleanPen(s.pen))
      .filter(Boolean),
  );
  let penInFileNotInSis = 0;
  for (const pen of uniqueFilePens) {
    if (!sisActivePens.has(pen)) penInFileNotInSis += 1;
  }

  return {
    fileRows: rows.length,
    filePenRows: penList.length,
    uniqueFilePens: uniqueFilePens.size,
    duplicateFilePens: penList.length - uniqueFilePens.size,
    matchedRows,
    matchedUniqueStudents: matchedIds.size,
    unmatchedRows,
    ambiguousRows,
    onUdiseSelectedYear,
    matchedButOtherYear,
    matchedButInactive,
    matchedButPlaceholderPen,
    penInFileNotInSis,
  };
}

/** PEN locked only when student Aadhaar is UDISE-verified and PEN is already on file. */
export function isUdisePenLocked(s: SisStudent): boolean {
  return (
    s.aadhaarVerification === "verified_udise" &&
    !!(s.pen && s.pen.trim())
  );
}

/**
 * APAAR is separate from student Aadhaar verification — portal APAAR needs
 * parent Aadhaar too. Lock only once an APAAR ID is actually present.
 */
export function isUdiseApaarLocked(s: SisStudent): boolean {
  const id = (s.apaarId || "").trim();
  if (!id || /^na$/i.test(id)) return false;
  return true;
}

/** @deprecated Prefer isUdisePenLocked / isUdiseApaarLocked (APAAR ≠ student Aadhaar). */
export function isUdisePenApaarLocked(s: SisStudent): boolean {
  return isUdisePenLocked(s) && isUdiseApaarLocked(s);
}

/**
 * After school verifies student Aadhaar on UDISE+ portal: tick verified.
 * PEN may fill from portal; APAAR is only written if portal already issued it
 * (parent Aadhaar is still required on UDISE+ before APAAR appears).
 */
export function markStudentVerifiedFromUdise(input: {
  studentId: string;
  pen?: string;
  apaarId?: string;
  aadhaarLast4?: string;
}):
  | { ok: true; student: SisStudent; state: SisState }
  | { ok: false; error: string } {
  const state = loadSis();
  const i = state.students.findIndex((s) => s.id === input.studentId);
  if (i < 0) return { ok: false, error: "Student not found" };
  const cur = state.students[i]!;
  const pen = cleanPen(input.pen || cur.pen);
  const apaar = cleanApaar(input.apaarId || cur.apaarId);
  const a4 =
    extractLast4(input.aadhaarLast4 || "") ||
    cur.aadhaarLast4 ||
    cur.aadhaarNumber.slice(-4);
  if (!a4 && !pen) {
    return {
      ok: false,
      error: "Enter Aadhaar last 4 and/or PEN from UDISE+ before ticking verified",
    };
  }
  const student = normalizeStudent({
    ...cur,
    pen: pen || cur.pen,
    penStatus: pen ? "has_pen" : cur.penStatus,
    apaarId: apaar || cur.apaarId,
    aadhaarLast4: a4 || cur.aadhaarLast4,
    aadhaarNumber: "",
    aadhaarVerification: "verified_udise",
    notes: [
      cur.notes,
      `Marked verified by UDISE+ ${new Date().toISOString().slice(0, 10)}`,
    ]
      .filter(Boolean)
      .join(" · "),
  });
  const students = [...state.students];
  students[i] = student;
  const next = { ...state, students };
  saveSis(next);
  return { ok: true, student, state: next };
}

/**
 * Migrate UDISE row not found in SIS.
 * Non-RTE: fee group is mandatory (cannot migrate without fee assignment).
 * RTE: fee group resolved from Masters RTE group.
 */
export function migrateUdiseRowToSis(input: {
  row: UdiseStudentRow;
  studentType: FeeStudentType;
  feeGroupId?: string | null;
  classId?: string;
  sectionId?: string;
  academicYearCode?: string;
}):
  | { ok: true; student: SisStudent; state: SisState }
  | { ok: false; error: string } {
  const masters = loadMasters();
  const state = loadSis();
  const row = input.row;
  if (!row.fullName.trim()) return { ok: false, error: "Student name required" };

  const classId =
    input.classId ||
    resolveUdiseClassId(row.classHint, masters) ||
    masters.classes.find((c) => c.isActive !== false)?.id ||
    "";
  if (!classId) {
    return { ok: false, error: "Map class from UDISE list (or pick class)" };
  }

  let sectionId = input.sectionId || "";
  if (!sectionId) {
    const hint = (row.sectionHint || "").trim().toLowerCase();
    const secs = masters.sections.filter(
      (s) => s.classId === classId && s.isActive !== false,
    );
    sectionId =
      secs.find((s) => s.name.toLowerCase() === hint)?.id || secs[0]?.id || "";
  }
  if (!sectionId) {
    return { ok: false, error: "Assign a section in Masters before migrate" };
  }

  const ay = input.academicYearCode || DEFAULT_AY;
  const studentType = input.studentType;
  let feeGroupId = (input.feeGroupId || "").trim() || null;

  if (studentType !== "RTE") {
    if (!feeGroupId) {
      return {
        ok: false,
        error:
          "Fee group required — non-RTE students cannot migrate without fee assignment",
      };
    }
  } else {
    feeGroupId =
      feeGroupId ||
      resolveFeeGroupId(masters, {
        studentType: "RTE",
        classId,
        academicYearCode: ay,
        preferPublished: true,
      }) ||
      null;
    if (!feeGroupId) {
      return {
        ok: false,
        error:
          "RTE fee group not found in Masters — configure RTE fee group first",
      };
    }
  }

  const pen = cleanPen(row.pen);
  const apaar = cleanApaar(row.apaarId);
  const a4 = extractLast4(row.aadhaarRaw);
  const verified = /verified/i.test(row.aadhaarValidation || "");
  const gender = mapUdiseGender(row.gender);
  const category = mapUdiseSocialCategory(row.socialCategory);
  const admissionNo = suggestAdmissionNo(state.students);

  const hh = normalizeHousehold({
    id: newSisId("hh"),
    code: `HH-UDISE-${state.households.length + 1}`,
    guardianName: row.fatherName || "Parent",
    mobile: "0000000000",
    whatsappMobile: "0000000000",
  });

  const campusId =
    masters.campuses.find((c) => c.isPrimary)?.id ||
    masters.campuses[0]?.id ||
    "";

  const student = normalizeStudent({
    id: newSisId("stu"),
    admissionNo,
    fullName: row.fullName,
    status: "active",
    campusId,
    classId,
    sectionId,
    academicYearCode: ay,
    studentType,
    feeGroupId,
    joinedOn: new Date().toISOString().slice(0, 10),
    fatherName: row.fatherName,
    motherName: row.motherName,
    gender,
    category,
    dob: fmtDob(row.dob),
    pen,
    penStatus: pen ? "has_pen" : "to_register",
    apaarId: apaar,
    aadhaarLast4: a4,
    aadhaarNumber: "",
    aadhaarVerification:
      verified && a4 ? "verified_udise" : a4 ? "received" : "missing",
    householdId: hh.id,
    notes: [
      "Migrated from UDISE+ Students_Details",
      isPortalSuspect(row) ? "Portal: Suspected Duplicate — review" : "",
      row.entryStatus ? `Entry: ${row.entryStatus}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  });

  const next: SisState = {
    ...state,
    households: [...state.households, hh],
    students: [...state.students, student],
  };
  saveSis(next);
  return { ok: true, student, state: next };
}

export type UdiseBulkImportResult = {
  ok: true;
  created: number;
  skipped: number;
  errors: { name: string; reason: string }[];
  state: SisState;
};

/**
 * Bulk-create SIS students from UDISE+ rows that did not match any existing
 * student (per the given match options). Class is resolved from the UDISE hint,
 * falling back to `defaultClassId` when provided. Non-RTE requires a fee group.
 */
export function importUnmatchedUdiseRows(input: {
  matrix: unknown[][];
  sis?: SisState;
  masters?: MastersState;
  studentType: FeeStudentType;
  feeGroupId?: string | null;
  academicYearCode?: string;
  matchOptions?: UdiseMatchOptions;
  defaultClassId?: string;
  defaultSectionId?: string;
}): UdiseBulkImportResult {
  const m = input.masters ?? loadMasters();
  const state = input.sis ?? loadSis();
  const { preview } = previewUdiseStudentDetailsSync(
    input.matrix,
    state,
    m,
    input.matchOptions ?? DEFAULT_UDISE_MATCH_OPTIONS,
    input.academicYearCode,
  );
  const unmatched = preview.filter(
    (p) => p.method === "unmatched" && !p.studentId,
  );

  const ay = input.academicYearCode || DEFAULT_AY;
  const campusId =
    m.campuses.find((c) => c.isPrimary)?.id || m.campuses[0]?.id || "";
  const students = [...state.students];
  const households = [...state.households];
  const errors: { name: string; reason: string }[] = [];
  let created = 0;

  for (const p of unmatched) {
    const row = p.udise;
    if (!row.fullName.trim()) {
      errors.push({ name: row.fullName || "(blank)", reason: "no name" });
      continue;
    }
    const classId =
      resolveUdiseClassId(row.classHint, m) || input.defaultClassId || "";
    if (!classId) {
      errors.push({
        name: row.fullName,
        reason: `class “${row.classHint || "—"}” not mapped — set a fallback class`,
      });
      continue;
    }
    const secs = m.sections.filter(
      (s) => s.classId === classId && s.isActive !== false,
    );
    const hint = (row.sectionHint || "").trim().toLowerCase();
    const sectionId =
      secs.find((s) => s.name.toLowerCase() === hint)?.id ||
      (input.defaultSectionId &&
      secs.some((s) => s.id === input.defaultSectionId)
        ? input.defaultSectionId
        : "") ||
      secs[0]?.id ||
      "";
    if (!sectionId) {
      errors.push({
        name: row.fullName,
        reason: "no section available for class",
      });
      continue;
    }

    let feeGroupId = (input.feeGroupId || "").trim() || null;
    if (input.studentType === "RTE") {
      feeGroupId =
        feeGroupId ||
        resolveFeeGroupId(m, {
          studentType: "RTE",
          classId,
          academicYearCode: ay,
          preferPublished: true,
        }) ||
        null;
      if (!feeGroupId) {
        errors.push({ name: row.fullName, reason: "RTE fee group not configured" });
        continue;
      }
    } else if (!feeGroupId) {
      errors.push({
        name: row.fullName,
        reason: "fee group required for non-RTE",
      });
      continue;
    }

    const pen = cleanPen(row.pen);
    const apaar = cleanApaar(row.apaarId);
    const a4 = extractLast4(row.aadhaarRaw);
    const verified = /verified/i.test(row.aadhaarValidation || "");
    const hh = normalizeHousehold({
      id: newSisId("hh"),
      code: `HH-UDISE-${households.length + 1}`,
      guardianName: row.fatherName || "Parent",
      mobile: "0000000000",
      whatsappMobile: "0000000000",
    });
    households.push(hh);
    const student = normalizeStudent({
      id: newSisId("stu"),
      admissionNo: suggestAdmissionNo(students),
      fullName: row.fullName,
      status: "active",
      campusId,
      classId,
      sectionId,
      academicYearCode: ay,
      studentType: input.studentType,
      feeGroupId,
      joinedOn: new Date().toISOString().slice(0, 10),
      fatherName: row.fatherName,
      motherName: row.motherName,
      gender: mapUdiseGender(row.gender),
      category: mapUdiseSocialCategory(row.socialCategory),
      dob: fmtDob(row.dob),
      pen,
      penStatus: pen ? "has_pen" : "to_register",
      apaarId: apaar,
      aadhaarLast4: a4,
      aadhaarNumber: "",
      aadhaarVerification:
        verified && a4 ? "verified_udise" : a4 ? "received" : "missing",
      householdId: hh.id,
      notes: [
        "Bulk-imported from UDISE+ Students_Details",
        isPortalSuspect(row) ? "Portal: Suspected Duplicate — review" : "",
      ]
        .filter(Boolean)
        .join(" · "),
    });
    students.push(student);
    created += 1;
  }

  const next: SisState = { ...state, students, households };
  saveSis(next);
  return { ok: true, created, skipped: errors.length, errors, state: next };
}

export async function matrixFromUdiseStudentsFile(
  buf: ArrayBuffer,
): Promise<unknown[][]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const preferred =
    wb.SheetNames.find((n) => /student/i.test(n)) || wb.SheetNames[0] || "";
  const sheet = wb.Sheets[preferred] || Object.values(wb.Sheets)[0];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: true,
  }) as unknown[][];
}
