/**
 * Student curriculum enrollment — grade + NCF subject cart (A/B/C/D).
 * Streams remain optional counselor packages in Masters, not an enrollment gate.
 *
 * The rules follow CBSE's 2026-27 Schemes of Studies (cbseacademic.nic.in;
 * copies in the school Drive, "CBSE Curriculum 2026-27"). Until 30 Sep 2026
 * they encoded an older "cart": IX–X exactly 7 subjects with ≥3 languages,
 * XI–XII exactly 6 with ≥2 languages. CBSE asks for something else:
 *   - VI–VIII: three languages (R1–R3), two of them Indian; Skill Education
 *     (Kaushal Bodh) and CT & AI are compulsory, not options.
 *   - IX–X: Maths, Science, Social Science compulsory; three languages from
 *     Class IX in 2026-27 and Class X in 2027-28 (Class X of 2026-27 is on
 *     the old two-language scheme); vocational education compulsory in IX.
 *   - XI–XII: Hindi or English plus four more — five main subjects, a sixth
 *     optional; ONE language is enough. Mathematics/Applied Mathematics and
 *     Computer Science/IP/IT are not taken together.
 */

import {
  classGroupCodeForName,
  type ClassGroupCode,
  type MastersState,
} from "@/lib/masters";
import type {
  ClassSubjectLink,
  SeniorStream,
  Subject,
} from "@/lib/foundationMasters";
import type { SisStudent } from "@/lib/sis";
import {
  cbseGroupForSubject,
  isLabHeavy,
  languageSubtypeOf,
  ncfTagForSubject,
  type CbseGroupId,
  type NcfTagId,
} from "@/lib/cbseSubjectGroups";
import { dikshaGradeForClass } from "@/lib/ncfOfficial";

export type { CbseGroupId, CbseGroupDef, NcfTagId } from "@/lib/cbseSubjectGroups";
export {
  CBSE_SUBJECT_GROUPS,
  NCF_SUBJECT_TAGS,
  cbseGroupForSubject,
  ncfTagForSubject,
  groupSubjectsByCbse,
  groupSubjectsByNcf,
  cbseGroupDef,
  ncfTagDef,
  languageSubtypeOf,
  isLabHeavy,
} from "@/lib/cbseSubjectGroups";

export type StudentCurriculum = {
  academicYearCode: string;
  /**
   * Optional counselor stream package (Science/Commerce/Humanities).
   * Not required for enrollment — kept for legacy rows / soft guidance.
   */
  seniorStreamId: string | null;
  /** Enrolled / chosen subject ids (shopping cart). */
  chosenSubjectIds: string[];
  confirmedAt: string;
  confirmedBy: "office" | "system";
};

export type CurriculumRequestStatus = "pending" | "approved" | "rejected";

export type CurriculumRequest = {
  id: string;
  studentId: string;
  academicYearCode: string;
  proposedStreamId: string | null;
  proposedChosenSubjectIds: string[];
  note: string;
  status: CurriculumRequestStatus;
  requestedAt: string;
  reviewedAt: string | null;
  reviewNote: string;
};

export type OfferingRow = {
  link: ClassSubjectLink;
  subject: Subject;
  optional: boolean;
};

/** Codes treated as optional electives by stage when linked to the class. */
const OPTIONAL_CODES: Record<ClassGroupCode, string[]> = {
  PRE_PRIMARY: [],
  PRIMARY: [],
  // R3 is compulsory but WHICH R3 is the family's choice, so the candidate
  // third languages stay options; Skill Education (VOC) and CT & AI (ICT)
  // are compulsory in VI–VIII (CBSE 2025-26 / 2026-27) and are not.
  MIDDLE: ["SKT", "URDU", "MUS", "WE"],
  SECONDARY: [],
  SENIOR: [],
};

export type CurriculumChoiceMode =
  | "none"
  | "middle_options"
  | "secondary_cart"
  | "senior_cart";

export function curriculumChoiceMode(
  group: ClassGroupCode | null,
): CurriculumChoiceMode {
  if (!group) return "none";
  if (group === "PRE_PRIMARY" || group === "PRIMARY") return "none";
  if (group === "MIDDLE") return "middle_options";
  if (group === "SECONDARY") return "secondary_cart";
  if (group === "SENIOR") return "senior_cart";
  return "none";
}

export function classGroupForStudent(
  student: Pick<SisStudent, "classId">,
  masters: MastersState,
): ClassGroupCode | null {
  const cls = masters.classes.find((c) => c.id === student.classId);
  if (!cls) return null;
  return cls.groupCode ?? classGroupCodeForName(cls.name);
}

export function normalizeCurriculum(
  c: Partial<StudentCurriculum> | null | undefined,
  ay: string,
): StudentCurriculum | null {
  if (!c) return null;
  return {
    academicYearCode: c.academicYearCode || ay,
    seniorStreamId: c.seniorStreamId ?? null,
    chosenSubjectIds: Array.isArray(c.chosenSubjectIds)
      ? c.chosenSubjectIds
      : [],
    confirmedAt: c.confirmedAt ?? "",
    confirmedBy: c.confirmedBy === "office" ? "office" : "system",
  };
}

export function normalizeCurriculumRequest(
  r: Partial<CurriculumRequest> & { id: string; studentId: string },
): CurriculumRequest {
  return {
    id: r.id,
    studentId: r.studentId,
    academicYearCode: r.academicYearCode ?? "",
    proposedStreamId: r.proposedStreamId ?? null,
    proposedChosenSubjectIds: Array.isArray(r.proposedChosenSubjectIds)
      ? r.proposedChosenSubjectIds
      : [],
    note: r.note ?? "",
    status:
      r.status === "approved" || r.status === "rejected"
        ? r.status
        : "pending",
    requestedAt: r.requestedAt ?? new Date().toISOString(),
    reviewedAt: r.reviewedAt ?? null,
    reviewNote: r.reviewNote ?? "",
  };
}

function optionalCodeSet(group: ClassGroupCode): Set<string> {
  return new Set(OPTIONAL_CODES[group].map((c) => c.toUpperCase()));
}

export function isOfferingOptional(
  subject: Subject,
  link: ClassSubjectLink,
  group: ClassGroupCode,
): boolean {
  if (link.isOptional) return true;
  if (subject.isElective) return true;
  return optionalCodeSet(group).has(subject.code.toUpperCase());
}

/** Active class–subject offerings with optional flags. */
export function offeringForClass(
  masters: MastersState,
  classId: string,
): OfferingRow[] {
  if (!classId) return [];
  const cls = masters.classes.find((c) => c.id === classId);
  const group: ClassGroupCode =
    cls?.groupCode ?? (cls ? classGroupCodeForName(cls.name) : "PRIMARY");
  const byId = new Map(masters.subjects.map((s) => [s.id, s]));
  const rows: OfferingRow[] = [];
  for (const link of masters.classSubjects ?? []) {
    if (!link.isActive || link.classId !== classId) continue;
    const subject = byId.get(link.subjectId);
    if (!subject || !subject.isActive) continue;
    rows.push({
      link,
      subject,
      optional: isOfferingOptional(subject, link, group),
    });
  }
  return rows.sort(
    (a, b) =>
      a.subject.sortOrder - b.subject.sortOrder ||
      a.subject.code.localeCompare(b.subject.code),
  );
}

export function coreOfferings(rows: OfferingRow[]): OfferingRow[] {
  return rows.filter((r) => !r.optional);
}

export function optionalOfferings(rows: OfferingRow[]): OfferingRow[] {
  return rows.filter((r) => r.optional);
}

export function activeStreams(masters: MastersState): SeniorStream[] {
  return (masters.seniorStreams ?? [])
    .filter((s) => s.isActive)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Subjects available in the shopping cart for this class. */
export function cartCatalog(
  masters: MastersState,
  classId: string,
): Subject[] {
  const offerings = offeringForClass(masters, classId);
  if (offerings.length > 0) {
    return offerings
      .map((o) => o.subject)
      .filter((s) => {
        if (s.parentId) return false;
        const tag = ncfTagForSubject(s);
        return tag === "A" || tag === "B" || tag === "C" || tag === "D";
      })
      .sort(
        (a, b) =>
          a.sortOrder - b.sortOrder || a.code.localeCompare(b.code),
      );
  }
  // Class map empty — fall back to active top-level Tag A–D catalog
  return masters.subjects
    .filter((s) => {
      if (!s.isActive || s.parentId) return false;
      const tag = ncfTagForSubject(s);
      return tag === "A" || tag === "B" || tag === "C" || tag === "D";
    })
    .sort(
      (a, b) =>
        a.sortOrder - b.sortOrder || a.code.localeCompare(b.code),
    );
}

/** Auto enrollment when office hasn't confirmed choices yet. */
export function defaultCurriculum(
  student: Pick<SisStudent, "classId" | "academicYearCode" | "curriculum">,
  masters: MastersState,
): StudentCurriculum {
  const ay = student.academicYearCode;
  const existing = normalizeCurriculum(student.curriculum, ay);
  if (existing?.confirmedAt) return existing;

  return {
    academicYearCode: ay,
    seniorStreamId: existing?.seniorStreamId ?? null,
    chosenSubjectIds: existing?.chosenSubjectIds ?? [],
    confirmedAt: existing?.confirmedAt ?? "",
    confirmedBy: existing?.confirmedBy ?? "system",
  };
}

export function streamCoreSubjectIds(
  masters: MastersState,
  streamId: string | null,
  classId: string,
): string[] {
  if (!streamId) return [];
  const stream = (masters.seniorStreams ?? []).find((s) => s.id === streamId);
  if (!stream) return [];
  const offeredIds = new Set(
    offeringForClass(masters, classId).map((o) => o.subject.id),
  );
  const want = new Set(stream.coreCodes.map((c) => c.toUpperCase()));
  const fromMap = masters.subjects
    .filter(
      (s) =>
        s.isActive &&
        want.has(s.code.toUpperCase()) &&
        offeredIds.has(s.id),
    )
    .map((s) => s.id);
  if (fromMap.length > 0) return fromMap;
  return masters.subjects
    .filter((s) => s.isActive && want.has(s.code.toUpperCase()))
    .map((s) => s.id);
}

export function streamElectiveSubjectIds(
  masters: MastersState,
  streamId: string | null,
  classId: string,
): string[] {
  if (!streamId) return [];
  const stream = (masters.seniorStreams ?? []).find((s) => s.id === streamId);
  if (!stream) return [];
  const offeredIds = new Set(
    offeringForClass(masters, classId).map((o) => o.subject.id),
  );
  const want = new Set(stream.electiveCodes.map((c) => c.toUpperCase()));
  const fromMap = masters.subjects
    .filter(
      (s) =>
        s.isActive &&
        want.has(s.code.toUpperCase()) &&
        offeredIds.has(s.id),
    )
    .map((s) => s.id);
  if (fromMap.length > 0) return fromMap;
  return masters.subjects
    .filter((s) => s.isActive && want.has(s.code.toUpperCase()))
    .map((s) => s.id);
}

export type CurriculumValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

function subjectsByIds(
  masters: MastersState,
  ids: string[],
): Subject[] {
  const byId = new Map(masters.subjects.map((s) => [s.id, s]));
  return ids
    .map((id) => byId.get(id))
    .filter((s): s is Subject => !!s && s.isActive);
}

function countByTag(subjects: Subject[]): Record<NcfTagId, number> {
  const counts: Record<NcfTagId, number> = {
    A: 0,
    B: 0,
    C: 0,
    D: 0,
    CO: 0,
  };
  for (const s of subjects) {
    counts[ncfTagForSubject(s)] += 1;
  }
  return counts;
}

/* ── CBSE 2026-27 language rules ─────────────────────────────────────── */

const FOREIGN_LANGUAGE_NAME = /\b(english|french|german|spanish|japanese|russian|arabic|persian|chinese|korean|thai|bahasa)\b/i;
const INDIAN_LANGUAGE_NAME =
  /\b(hindi|sanskrit|urdu|bengali|bangla|marathi|gujarati|punjabi|tamil|telugu|kannada|malayalam|odia|oriya|assamese|maithili|bhojpuri|nepali|sindhi|kashmiri|konkani|manipuri|dogri|bodo|santhali)\b/i;

/**
 * "indian" | "foreign" when the subject is a language, else null.
 *
 * Not from the NCF tag alone: the school's own English and Hindi carried
 * tag D in September 2026, so counting tag-A subjects would have told the
 * office a child with Hindi + English + Sanskrit had one language.
 */
export function languageKindOf(s: Pick<Subject, "code" | "nameEn" | "languageSubtype" | "category" | "ncfTagId" | "cbseGroupId">): "indian" | "foreign" | null {
  const sub = languageSubtypeOf(s);
  if (sub === "foreign") return "foreign";
  if (sub === "native" || sub === "regional") return "indian";
  if (FOREIGN_LANGUAGE_NAME.test(s.nameEn)) return "foreign";
  if (INDIAN_LANGUAGE_NAME.test(s.nameEn)) return "indian";
  return ncfTagForSubject(s) === "A" ? "indian" : null;
}

function classNumber(className: string): number | null {
  const g = dikshaGradeForClass(className);
  const m = g ? /^Class (\d+)$/.exec(g) : null;
  return m ? Number(m[1]) : null;
}

function sessionStartYear(academicYearCode: string): number {
  const y = Number(String(academicYearCode ?? "").slice(0, 4));
  return Number.isFinite(y) && y > 2000 ? y : new Date().getFullYear();
}

/**
 * How many languages CBSE requires for this class in this session.
 *
 * VI–VIII: three (R3 compulsory from Class VI in 2026-27; VII and VIII
 * already needed three under the previous scheme). IX: three from 2026-27.
 * X: three from 2027-28 — Class X of 2026-27 stays on the old scheme with
 * two. XI–XII: one (Hindi or English). Others: no rule.
 */
export function languagesRequired(className: string, academicYearCode: string): number | null {
  const n = classNumber(className);
  const y = sessionStartYear(academicYearCode);
  if (n == null) return null;
  if (n >= 6 && n <= 8) return 3;
  if (n === 9) return y >= 2026 ? 3 : 2;
  if (n === 10) return y >= 2027 ? 3 : 2;
  if (n >= 11) return 1;
  return null;
}

/** Of the required languages, how many must be Indian (CBSE: two of three). */
function indianLanguagesRequired(required: number | null): number {
  if (required == null) return 0;
  return required >= 3 ? 2 : 1;
}

/** CBSE XI–XII: these may not be taken together (ERP codes). */
const SENIOR_NOT_TOGETHER: [string, string, string][] = [
  ["MAT", "APP-MAT", "Mathematics and Applied Mathematics"],
  ["CT", "IT", "Computer Science / Informatics Practices and Information Technology"],
];

const SECONDARY_COMPULSORY: [string, string][] = [
  ["MAT", "Mathematics"],
  ["SCI", "Science"],
  ["SST", "Social Science"],
];

/** Most subjects a IX–X cart may hold (CBSE 2026-27 lists up to 12). */
export const SECONDARY_CART_MAX = 12;
export const SENIOR_MAIN_MIN = 5;
export const SENIOR_MAIN_MAX = 6;

function topLevel(list: Subject[]): Subject[] {
  return list.filter((s) => !s.parentId);
}

/**
 * Each enrolled subject as its top-level subject, once. A class may study a
 * language only through its components — VI–VIII linked ENG-ORAL / ENG-WRIT
 * and HIN-ORAL / HIN-WRIT but not ENG or HIN in September 2026 — and that is
 * still English and Hindi.
 */
function asSubjectFamilies(list: Subject[], all: Subject[]): Subject[] {
  const byId = new Map(all.map((x) => [x.id, x] as const));
  const out = new Map<string, Subject>();
  for (const s of list) {
    const top = s.parentId ? byId.get(s.parentId) ?? s : s;
    out.set(top.id, top);
  }
  return [...out.values()];
}

/** One of the five/six main XI–XII subjects — not Work Experience, General
 * Studies or Health & PE, which are internal. A language always counts,
 * whatever its tag (the school's English carried tag D). */
function isMainSeniorSubject(s: Subject): boolean {
  if (s.category === "co_scholastic") return false;
  if (languageKindOf(s)) return true;
  const tag = ncfTagForSubject(s);
  return tag === "A" || tag === "B" || tag === "C";
}

/** CBSE 2026-27 rules for the student's enrollment (see the file header). */
export function validateCurriculum(
  student: Pick<SisStudent, "classId" | "academicYearCode">,
  curriculum: StudentCurriculum,
  masters: MastersState,
): CurriculumValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const group = classGroupForStudent(student, masters);
  const mode = curriculumChoiceMode(group);
  const chosen = curriculum.chosenSubjectIds;
  const known = new Set(masters.subjects.map((s) => s.id));
  const className = masters.classes.find((c) => c.id === student.classId)?.name ?? "";
  const ay = curriculum.academicYearCode || student.academicYearCode;

  for (const id of chosen) {
    if (!known.has(id)) {
      errors.push("Unknown subject in enrollment.");
      break;
    }
  }

  const picks = subjectsByIds(masters, chosen);

  const checkLanguages = (enrolled: Subject[], label: string) => {
    const need = languagesRequired(className, ay);
    if (need == null) return;
    const langs = asSubjectFamilies(enrolled, masters.subjects)
      .map(languageKindOf)
      .filter((k): k is "indian" | "foreign" => !!k);
    if (langs.length < need) {
      errors.push(
        need === 3
          ? `${label}: three languages are compulsory (CBSE 2026-27 — R1, R2 and R3); ${langs.length} enrolled.`
          : need === 1
            ? `${label}: Hindi or English is compulsory (CBSE Subject 1).`
            : `${label}: two languages are required; ${langs.length} enrolled.`,
      );
    }
    const indian = langs.filter((k) => k === "indian").length;
    const needIndian = indianLanguagesRequired(need);
    if (need >= 2 && indian < needIndian) {
      errors.push(
        `${label}: at least ${needIndian} of the languages must be Indian (CBSE); ${indian} enrolled.`,
      );
    }
  };

  if (mode === "none") {
    // Fixed stage — office may attach extras freely
  } else if (mode === "middle_options") {
    if (chosen.length > 2) {
      errors.push("Middle stage: choose at most 2 optional subjects.");
    }
    const enrolled = resolveStudentSubjects({ ...student, curriculum }, masters);
    checkLanguages(enrolled, className || "VI–VIII");
  } else if (mode === "secondary_cart") {
    const top = topLevel(picks);
    if (top.length > SECONDARY_CART_MAX) {
      errors.push(`IX–X: at most ${SECONDARY_CART_MAX} subjects (now ${top.length}).`);
    }
    const codes = new Set(top.map((s) => s.code.trim().toUpperCase()));
    for (const [code, name] of SECONDARY_COMPULSORY) {
      if (!codes.has(code)) errors.push(`IX–X: ${name} is compulsory (CBSE).`);
    }
    checkLanguages(top, className || "IX–X");
    const skill = top.some((s) => ncfTagForSubject(s) === "B" || s.code.trim().toUpperCase() === "VOC");
    const n = classNumber(className);
    if (!skill) {
      if (n === 9 && sessionStartYear(ay) >= 2026) {
        errors.push("Class IX: Vocational Education is compulsory (CBSE 2026-27) — add it or a skill subject.");
      } else {
        warnings.push("No skill / vocational subject — CBSE expects one.");
      }
    }
  } else if (mode === "senior_cart") {
    const top = topLevel(picks);
    const main = top.filter(isMainSeniorSubject);
    if (main.length < SENIOR_MAIN_MIN) {
      errors.push(`XI–XII: at least ${SENIOR_MAIN_MIN} main subjects (now ${main.length}).`);
    }
    if (main.length > SENIOR_MAIN_MAX) {
      errors.push(`XI–XII: at most ${SENIOR_MAIN_MAX} main subjects — five plus one optional (now ${main.length}).`);
    }
    const hasHindiOrEnglish = top.some((s) => {
      const c = s.code.trim().toUpperCase();
      return c === "ENG" || c === "HIN" || /\b(english|hindi)\b/i.test(s.nameEn);
    });
    if (!hasHindiOrEnglish) {
      errors.push("XI–XII: Hindi or English is compulsory (CBSE Subject 1).");
    }
    const codes = new Set(top.map((s) => s.code.trim().toUpperCase()));
    for (const [x, y, label] of SENIOR_NOT_TOGETHER) {
      if (codes.has(x) && codes.has(y)) errors.push(`XI–XII: ${label} cannot be taken together (CBSE).`);
    }
    const labCount = top.filter((s) => isLabHeavy(s)).length;
    if (labCount >= 3) {
      warnings.push(
        `Lab load is high (${labCount} lab-heavy subjects). Counselor may advise adjusting the mix.`,
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Resolved subjects for a student (cores ∪ chosen, or full cart). */
export function resolveStudentSubjects(
  student: Pick<SisStudent, "classId" | "academicYearCode" | "curriculum">,
  masters: MastersState,
  opts?: { forAssessment?: boolean },
): Subject[] {
  const group = classGroupForStudent(student, masters);
  const mode = curriculumChoiceMode(group);
  const offerings = offeringForClass(masters, student.classId);
  const cur =
    normalizeCurriculum(student.curriculum, student.academicYearCode) ??
    defaultCurriculum(student, masters);
  const confirmed = !!cur.confirmedAt;
  const forAssessment = opts?.forAssessment === true;

  const ids = new Set<string>();

  if (mode === "none") {
    for (const o of offerings) ids.add(o.subject.id);
    for (const id of cur.chosenSubjectIds) ids.add(id);
  } else if (mode === "middle_options") {
    for (const o of coreOfferings(offerings)) ids.add(o.subject.id);
    for (const id of cur.chosenSubjectIds) ids.add(id);
  } else if (mode === "secondary_cart" || mode === "senior_cart") {
    if (forAssessment) {
      // Exams / reports: confirmed cart only — no silent class-core preview
      if (confirmed) {
        for (const id of cur.chosenSubjectIds) ids.add(id);
      } else {
        // Provisional: class offerings until office confirms enrollment
        for (const o of offerings) {
          if (!o.subject.parentId) ids.add(o.subject.id);
        }
      }
    } else {
      for (const id of cur.chosenSubjectIds) ids.add(id);
      if (ids.size === 0) {
        for (const o of coreOfferings(offerings)) ids.add(o.subject.id);
      }
    }
  }

  return masters.subjects
    .filter((s) => ids.has(s.id) && s.isActive)
    .sort(
      (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code),
    );
}

/** True when office has confirmed enrollment for this student/year. */
export function isCurriculumConfirmed(
  student: Pick<SisStudent, "academicYearCode" | "curriculum">,
): boolean {
  const cur = normalizeCurriculum(
    student.curriculum,
    student.academicYearCode,
  );
  return !!cur?.confirmedAt;
}

/**
 * Enrollment source used by exams / report cards.
 * - confirmed_cart: IX–XII / Middle with office-confirmed choices
 * - class_map: fixed stage or provisional (unconfirmed cart)
 */
export function assessmentEnrollmentSource(
  student: Pick<SisStudent, "classId" | "academicYearCode" | "curriculum">,
  masters: MastersState,
): "confirmed_cart" | "class_map" {
  const mode = curriculumChoiceMode(classGroupForStudent(student, masters));
  if (
    (mode === "secondary_cart" ||
      mode === "senior_cart" ||
      mode === "middle_options") &&
    isCurriculumConfirmed(student)
  ) {
    return "confirmed_cart";
  }
  return "class_map";
}

export function confirmCurriculum(
  draft: StudentCurriculum,
  by: "office" | "system",
): StudentCurriculum {
  return {
    ...draft,
    confirmedAt: new Date().toISOString(),
    confirmedBy: by,
  };
}

export function streamLabel(
  masters: MastersState,
  streamId: string | null,
): string {
  if (!streamId) return "";
  return (
    (masters.seniorStreams ?? []).find((s) => s.id === streamId)?.nameEn ?? ""
  );
}

/** Active catalog subjects available to add under an NCF tag. */
export function catalogInCbseGroup(
  masters: MastersState,
  groupId: CbseGroupId | NcfTagId,
  excludeIds: Set<string>,
): Subject[] {
  return masters.subjects
    .filter(
      (s) =>
        s.isActive &&
        !s.parentId &&
        !excludeIds.has(s.id) &&
        ncfTagForSubject(s) === (groupId as NcfTagId),
    )
    .sort(
      (a, b) =>
        a.sortOrder - b.sortOrder || a.code.localeCompare(b.code),
    );
}

export const catalogInNcfTag = catalogInCbseGroup;

/** Cart progress helpers for UI. */
export function cartProgress(
  mode: CurriculumChoiceMode,
  subjects: Subject[],
  ctx?: { className?: string; academicYearCode?: string },
): {
  /** Hard cap on picks (the editor refuses more), or null for none. */
  target: number | null;
  /** Fewest picks the rules accept, or null. */
  min: number | null;
  count: number;
  languages: number;
  languagesRequired: number | null;
  /** Kept for callers that read it; now counts Indian languages. */
  nativeLanguages: number;
  indianRequired: number;
  skill: number;
  labHeavy: number;
  hint: string;
} {
  const top = subjects.filter((s) => !s.parentId);
  const tags = countByTag(top);
  const kinds = top.map(languageKindOf).filter((k): k is "indian" | "foreign" => !!k);
  const need = ctx?.className ? languagesRequired(ctx.className, ctx.academicYearCode ?? "") : null;
  const labHeavy = top.filter((s) => isLabHeavy(s)).length;
  let target: number | null = null;
  let min: number | null = null;
  let hint = "Fixed stage curriculum — office can still add if needed.";
  if (mode === "middle_options") {
    target = 2;
    hint = `Cores from the class map · choose up to 2 options${need === 3 ? " · three languages compulsory (R1, R2, R3)" : ""}.`;
  }
  if (mode === "secondary_cart") {
    target = SECONDARY_CART_MAX;
    hint = `CBSE 2026-27 · Maths, Science, Social Science compulsory · ${need ?? 3} languages (2 Indian when 3) · vocational / skill subject.`;
  }
  if (mode === "senior_cart") {
    target = SENIOR_MAIN_MAX;
    min = SENIOR_MAIN_MIN;
    hint = "CBSE 2026-27 · Hindi or English + four more (five main subjects) · a sixth optional · Maths / Applied Maths and CS / IP / IT not together.";
  }
  const count = mode === "senior_cart" ? top.filter(isMainSeniorSubject).length : top.length;
  return {
    target,
    min,
    count,
    languages: kinds.length,
    languagesRequired: need,
    nativeLanguages: kinds.filter((k) => k === "indian").length,
    indianRequired: indianLanguagesRequired(need),
    skill: tags.B,
    labHeavy,
    hint,
  };
}
