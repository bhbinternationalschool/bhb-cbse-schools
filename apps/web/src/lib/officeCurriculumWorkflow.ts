/**
 * Office curriculum workflow — class templates, bulk apply, session roll.
 */

import { DEFAULT_AY, type MastersState } from "@/lib/masters";
import {
  loadSis,
  normalizeStudent,
  saveSis,
  type SisState,
  type SisStudent,
} from "@/lib/sis";
import {
  confirmCurriculum,
  curriculumChoiceMode,
  classGroupForStudent,
  isCurriculumConfirmed,
  normalizeCurriculum,
  validateCurriculum,
  type StudentCurriculum,
} from "@/lib/studentCurriculum";

export type CurriculumEnrollmentStatus = "confirmed" | "draft" | "empty";

export type ClassCurriculumTemplate = {
  id: string;
  classId: string;
  academicYearCode: string;
  label: string;
  chosenSubjectIds: string[];
  seniorStreamId: string | null;
  updatedAt: string;
};

export type CurriculumClassSummary = {
  total: number;
  confirmed: number;
  draft: number;
  empty: number;
  pendingRequests: number;
};

export type BulkApplyPolicy = "overwrite" | "skip_confirmed" | "empty_only";

export type BulkApplyResult = {
  ok: boolean;
  updated: number;
  skipped: number;
  errors: string[];
  state: SisState;
};

export type YearRollMode = "clear" | "draft_copy";

const TEMPLATE_KEY = "bhb_class_curriculum_templates_v1";

function tid() {
  return `tmpl_${Math.random().toString(36).slice(2, 10)}`;
}

export function enrollmentStatusOf(
  student: Pick<SisStudent, "academicYearCode" | "curriculum">,
): CurriculumEnrollmentStatus {
  const cur = normalizeCurriculum(
    student.curriculum,
    student.academicYearCode,
  );
  if (!cur || cur.chosenSubjectIds.length === 0) return "empty";
  if (cur.confirmedAt) return "confirmed";
  return "draft";
}

export function summarizeClassCurriculum(
  students: SisStudent[],
  pendingRequestStudentIds?: Set<string>,
): CurriculumClassSummary {
  let confirmed = 0;
  let draft = 0;
  let empty = 0;
  let pendingRequests = 0;
  for (const s of students) {
    const st = enrollmentStatusOf(s);
    if (st === "confirmed") confirmed += 1;
    else if (st === "draft") draft += 1;
    else empty += 1;
    if (pendingRequestStudentIds?.has(s.id)) pendingRequests += 1;
  }
  return {
    total: students.length,
    confirmed,
    draft,
    empty,
    pendingRequests,
  };
}

export function loadClassCurriculumTemplates(): ClassCurriculumTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(TEMPLATE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ClassCurriculumTemplate[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveClassCurriculumTemplates(
  list: ClassCurriculumTemplate[],
): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TEMPLATE_KEY, JSON.stringify(list));
  void import("@/lib/curriculumPersistence").then(({ scheduleTemplateSync }) => {
    scheduleTemplateSync(list);
  });
}

export function templateForClass(
  classId: string,
  academicYearCode: string,
): ClassCurriculumTemplate | null {
  return (
    loadClassCurriculumTemplates().find(
      (t) =>
        t.classId === classId && t.academicYearCode === academicYearCode,
    ) ?? null
  );
}

export function upsertClassCurriculumTemplate(input: {
  classId: string;
  academicYearCode: string;
  label?: string;
  chosenSubjectIds: string[];
  seniorStreamId?: string | null;
}): ClassCurriculumTemplate {
  const list = loadClassCurriculumTemplates();
  const existing = list.find(
    (t) =>
      t.classId === input.classId &&
      t.academicYearCode === input.academicYearCode,
  );
  const row: ClassCurriculumTemplate = {
    id: existing?.id ?? tid(),
    classId: input.classId,
    academicYearCode: input.academicYearCode,
    label: input.label?.trim() || existing?.label || "Class template",
    chosenSubjectIds: [...input.chosenSubjectIds],
    seniorStreamId: input.seniorStreamId ?? null,
    updatedAt: new Date().toISOString(),
  };
  const next = existing
    ? list.map((t) => (t.id === existing.id ? row : t))
    : [...list, row];
  saveClassCurriculumTemplates(next);
  return row;
}

export function draftFromTemplate(
  template: ClassCurriculumTemplate,
): StudentCurriculum {
  return {
    academicYearCode: template.academicYearCode,
    seniorStreamId: template.seniorStreamId,
    chosenSubjectIds: [...template.chosenSubjectIds],
    confirmedAt: "",
    confirmedBy: "system",
  };
}

/**
 * Apply a curriculum cart to many students.
 * Optionally confirm immediately (office bulk confirm).
 */
export function applyCurriculumBulk(input: {
  state?: SisState;
  studentIds: string[];
  curriculum: StudentCurriculum;
  masters: MastersState;
  policy?: BulkApplyPolicy;
  /** If true, stamp confirmedAt as office */
  confirm?: boolean;
  /** Validate against first student's class rules (or provide classId) */
  classId?: string;
}): BulkApplyResult {
  const sis = input.state ?? loadSis();
  const policy = input.policy ?? "skip_confirmed";
  const errors: string[] = [];
  let updated = 0;
  let skipped = 0;

  const sample =
    sis.students.find((s) => s.id === input.studentIds[0]) ??
    sis.students.find((s) => s.classId === input.classId);

  if (sample) {
    const check = validateCurriculum(
      { classId: input.classId || sample.classId, academicYearCode: sample.academicYearCode },
      input.curriculum,
      input.masters,
    );
    if (!check.ok) {
      return {
        ok: false,
        updated: 0,
        skipped: 0,
        errors: check.errors,
        state: sis,
      };
    }
  }

  const ay = input.curriculum.academicYearCode || DEFAULT_AY;
  let payload: StudentCurriculum = {
    academicYearCode: ay,
    seniorStreamId: input.curriculum.seniorStreamId ?? null,
    chosenSubjectIds: [...input.curriculum.chosenSubjectIds],
    confirmedAt: "",
    confirmedBy: "system",
  };
  if (input.confirm) {
    payload = confirmCurriculum(payload, "office");
  }

  const idSet = new Set(input.studentIds);
  const students = sis.students.map((s) => {
    if (!idSet.has(s.id)) return s;
    if (s.status !== "active") {
      skipped += 1;
      return s;
    }
    const status = enrollmentStatusOf(s);
    if (policy === "skip_confirmed" && status === "confirmed") {
      skipped += 1;
      return s;
    }
    if (policy === "empty_only" && status !== "empty") {
      skipped += 1;
      return s;
    }
    updated += 1;
    return normalizeStudent({
      ...s,
      academicYearCode: ay,
      curriculum: {
        ...payload,
        academicYearCode: s.academicYearCode || ay,
      },
    });
  });

  const next = { ...sis, students };
  saveSis(next);
  return { ok: true, updated, skipped, errors, state: next };
}

/** Copy one student's cart onto others. */
export function copyCurriculumFromStudent(input: {
  state?: SisState;
  fromStudentId: string;
  toStudentIds: string[];
  masters: MastersState;
  policy?: BulkApplyPolicy;
  confirm?: boolean;
}): BulkApplyResult {
  const sis = input.state ?? loadSis();
  const from = sis.students.find((s) => s.id === input.fromStudentId);
  if (!from?.curriculum) {
    return {
      ok: false,
      updated: 0,
      skipped: 0,
      errors: ["Source student has no curriculum to copy"],
      state: sis,
    };
  }
  const cur =
    normalizeCurriculum(from.curriculum, from.academicYearCode) ??
    from.curriculum;
  return applyCurriculumBulk({
    state: sis,
    studentIds: input.toStudentIds,
    curriculum: {
      ...cur,
      confirmedAt: "",
      confirmedBy: "system",
    },
    masters: input.masters,
    policy: input.policy,
    confirm: input.confirm,
    classId: from.classId,
  });
}

/**
 * Session roll — move students onto a new academic year and reset confirmation.
 * - clear: wipe subject choices (re-enrol)
 * - draft_copy: keep choices as unconfirmed draft
 */
export function rollCurriculumToNewAy(input: {
  state?: SisState;
  studentIds: string[];
  fromAy?: string;
  toAy: string;
  mode?: YearRollMode;
  masters: MastersState;
}): BulkApplyResult {
  const sis = input.state ?? loadSis();
  const mode = input.mode ?? "clear";
  const idSet = new Set(input.studentIds);
  let updated = 0;
  let skipped = 0;

  const students = sis.students.map((s) => {
    if (!idSet.has(s.id)) return s;
    if (input.fromAy && s.academicYearCode && s.academicYearCode !== input.fromAy) {
      skipped += 1;
      return s;
    }
    const prev = normalizeCurriculum(s.curriculum, s.academicYearCode);
    const nextCur: StudentCurriculum | null =
      mode === "draft_copy" && prev && prev.chosenSubjectIds.length > 0
        ? {
            academicYearCode: input.toAy,
            seniorStreamId: prev.seniorStreamId,
            chosenSubjectIds: [...prev.chosenSubjectIds],
            confirmedAt: "",
            confirmedBy: "system",
          }
        : null;

    // Cart stages with draft_copy still need re-validation for new class maps
    if (nextCur) {
      const check = validateCurriculum(
        { classId: s.classId, academicYearCode: input.toAy },
        nextCur,
        input.masters,
      );
      if (!check.ok) {
        // Keep as draft anyway — office will fix; don't block roll
      }
    }

    updated += 1;
    return normalizeStudent({
      ...s,
      academicYearCode: input.toAy,
      curriculum: nextCur,
    });
  });

  const next = { ...sis, students };
  saveSis(next);
  return { ok: true, updated, skipped, errors: [], state: next };
}

/**
 * After promotion/detain apply: clear curriculum when class changes;
 * keep for detain (same class).
 */
export function curriculumAfterClassChange(input: {
  previous: SisStudent;
  toClassId: string;
  decision: "promoted" | "detained" | "conditional" | "pending";
}): StudentCurriculum | null {
  if (input.decision === "detained" || input.toClassId === input.previous.classId) {
    return input.previous.curriculum;
  }
  // New class → re-enrol (especially IX→XI stream/cart change)
  return null;
}

/** Whether this class needs cart-style office enrollment. */
export function classNeedsCartEnrollment(
  classId: string,
  masters: MastersState,
): boolean {
  const fake = { classId } as Pick<SisStudent, "classId">;
  const mode = curriculumChoiceMode(classGroupForStudent(fake, masters));
  return (
    mode === "secondary_cart" ||
    mode === "senior_cart" ||
    mode === "middle_options"
  );
}

export function studentsNeedingCurriculum(
  students: SisStudent[],
): SisStudent[] {
  return students.filter((s) => {
    if (s.status !== "active") return false;
    const st = enrollmentStatusOf(s);
    return st === "empty" || st === "draft" || !isCurriculumConfirmed(s);
  });
}
