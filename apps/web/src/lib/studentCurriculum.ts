/**
 * Student curriculum enrollment — grade + NCF subject cart (A/B/C/D).
 * Streams remain optional counselor packages in Masters, not an enrollment gate.
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
  MIDDLE: ["SKT", "URDU", "VOC", "MUS", "WE", "ICT"],
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

/** Hard NCF rules for IX–X and XI–XII shopping carts. */
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

  for (const id of chosen) {
    if (!known.has(id)) {
      errors.push("Unknown subject in enrollment.");
      break;
    }
  }

  const picks = subjectsByIds(masters, chosen);
  const tags = countByTag(picks);

  if (mode === "none") {
    // Fixed stage — office may attach extras freely
  } else if (mode === "middle_options") {
    if (chosen.length > 2) {
      errors.push("Middle stage: choose at most 2 optional subjects.");
    }
  } else if (mode === "secondary_cart") {
    // IX–X: 7 subjects · ≥3 languages · ≥1 skill/voc
    if (picks.length !== 7) {
      errors.push(
        `IX–X: enroll exactly 7 subjects (now ${picks.length}). Pattern: 3 languages + skill/voc + academic electives.`,
      );
    }
    if (tags.A < 3) {
      errors.push(
        `IX–X: choose at least 3 languages — Tag A (now ${tags.A}).`,
      );
    }
    if (tags.B < 1) {
      errors.push(
        "IX–X: vocational / skill subject is mandatory — add at least one Tag B.",
      );
    }
  } else if (mode === "senior_cart") {
    // XI–XII: exactly 6 · ≥2 languages · ≥1 native · soft lab load
    if (picks.length !== 6) {
      errors.push(
        `XI–XII: enroll exactly 6 subjects (now ${picks.length}). Mix across Tags A–C freely.`,
      );
    }
    if (tags.A < 2) {
      errors.push(
        `XI–XII: choose at least 2 languages — Tag A (now ${tags.A}).`,
      );
    }
    const nativeCount = picks.filter(
      (s) =>
        ncfTagForSubject(s) === "A" && languageSubtypeOf(s) === "native",
    ).length;
    if (nativeCount < 1) {
      errors.push(
        "XI–XII: at least one language must be native (e.g. Hindi / Indian language).",
      );
    }
    const labCount = picks.filter((s) => isLabHeavy(s)).length;
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
): {
  target: number | null;
  count: number;
  languages: number;
  skill: number;
  nativeLanguages: number;
  labHeavy: number;
} {
  const tags = countByTag(subjects);
  const nativeLanguages = subjects.filter(
    (s) =>
      ncfTagForSubject(s) === "A" && languageSubtypeOf(s) === "native",
  ).length;
  const labHeavy = subjects.filter((s) => isLabHeavy(s)).length;
  let target: number | null = null;
  if (mode === "secondary_cart") target = 7;
  if (mode === "senior_cart") target = 6;
  if (mode === "middle_options") target = 2;
  return {
    target,
    count: subjects.length,
    languages: tags.A,
    skill: tags.B,
    nativeLanguages,
    labHeavy,
  };
}
