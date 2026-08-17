/**
 * Assigning teachers to classes and subjects.
 *
 * The links themselves have lived on `StaffRecord` since Phase 0
 * (`classTeacherLinks` / `subjectTeachingLinks`), but nothing in the ERP
 * could create them in bulk — they had to be set one staff profile at a
 * time, which is why 49 of the school's 49 class-section-subject
 * assignments were still empty. This module is the logic behind the
 * Staff → Allocate teaching desk.
 *
 * Two rules shape the whole file:
 *
 *  - A slot has one teacher. Two teachers holding the same class +
 *    section + subject makes the timetable unsolvable and per-teacher
 *    coverage meaningless, so conflicts are *reported to the user*
 *    rather than silently merged or silently overwritten.
 *  - `sectionId: null` means "every section of this class". It is a real
 *    value, not a missing one, so it has to be compared deliberately
 *    everywhere rather than falling out of an `===` on undefined.
 */

import type { MastersState } from "@/lib/masters";
import type {
  StaffClassTeacherLink,
  StaffRecord,
  StaffSubjectTeachingLink,
} from "@/lib/foundationMasters";

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

/* ------------------------------------------------------------------ */
/* Reading the curriculum                                              */
/* ------------------------------------------------------------------ */

export type SubjectOption = {
  subjectId: string;
  name: string;
  /** Periods the curriculum allots this subject for the class */
  periodsPerWeek: number;
  /**
   * A subject the student chooses rather than one the whole section
   * takes — a third language, a skill subject, an elective. It still
   * needs a teacher, but it does NOT consume a timetable slot for
   * everyone, because the alternatives run against each other.
   */
  isOptional: boolean;
  sortOrder: number;
};

/**
 * Subjects the curriculum links to a class, in teaching order.
 *
 * Driven by `classSubjects`, not by the full subject master: a school
 * with 40 subjects on file only teaches a handful in any one class, and
 * offering all 40 in the picker is how mis-assignments happen.
 */
export function listClassSubjectOptions(
  masters: MastersState,
  classId: string,
): SubjectOption[] {
  if (!classId) return [];
  const subjects = masters.subjects ?? [];
  return (masters.classSubjects ?? [])
    .filter((l) => l.classId === classId && l.isActive)
    .map((l) => {
      const subject = subjects.find((s) => s.id === l.subjectId);
      if (!subject) return null;
      return {
        subjectId: subject.id,
        name: subject.nameEn,
        periodsPerWeek: l.periodsPerWeek || 0,
        isOptional: l.isOptional === true,
        sortOrder: subject.sortOrder,
      };
    })
    .filter((x): x is SubjectOption => !!x)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export type ClassPeriodDemand = {
  /** Periods every student in the section sits through */
  compulsory: number;
  /** Periods across ALL elective alternatives added together */
  optionalTotal: number;
  /** The largest single elective, i.e. what one student actually takes */
  largestOptional: number;
  /**
   * Slots the section really needs: compulsory plus the electives a
   * single student takes. Elective alternatives run against each other in
   * the same slot, so they are NOT summed.
   */
  effective: number;
  /**
   * compulsory + optionalTotal — what you get by naively adding every
   * link. Kept only so a caller can show why the naive figure looks
   * alarming; never compare this against slot capacity.
   */
  naiveTotal: number;
};

/**
 * How many weekly slots a class actually needs.
 *
 * The distinction matters: Class IX here lists 53 periods of subjects but
 * only 30 are compulsory — the other 23 are nine electives a student
 * picks between. Adding them all up says the class overflows a 48-slot
 * week, which is wrong and sends someone off to "fix" a curriculum that
 * was correct. Capacity questions must use `effective`, never
 * `naiveTotal`.
 *
 * `effective` assumes one elective choice per student, the common CBSE
 * shape (one third language, one skill subject). A school that lets
 * students take two electives should compare against `compulsory +
 * n * largestOptional` instead.
 */
export function classPeriodDemand(
  masters: MastersState,
  classId: string,
): ClassPeriodDemand {
  const options = listClassSubjectOptions(masters, classId);
  let compulsory = 0;
  let optionalTotal = 0;
  let largestOptional = 0;
  for (const o of options) {
    if (o.isOptional) {
      optionalTotal += o.periodsPerWeek;
      largestOptional = Math.max(largestOptional, o.periodsPerWeek);
    } else {
      compulsory += o.periodsPerWeek;
    }
  }
  return {
    compulsory,
    optionalTotal,
    largestOptional,
    effective: compulsory + largestOptional,
    naiveTotal: compulsory + optionalTotal,
  };
}

export function activeTeachers(masters: MastersState): StaffRecord[] {
  return (masters.staff ?? [])
    .filter((s) => s.stream === "teaching" && s.status === "active")
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export function sectionsOfClass(masters: MastersState, classId: string) {
  return (masters.sections ?? [])
    .filter((s) => s.classId === classId && s.isActive)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ */
/* Conflicts                                                           */
/* ------------------------------------------------------------------ */

export type SubjectConflict = {
  staffId: string;
  teacherName: string;
  linkId: string;
  /** null = that teacher holds the subject for every section */
  sectionId: string | null;
};

/**
 * Does a link cover this section?
 *
 * A `null` sectionId covers every section, so an all-sections link and a
 * single-section link for the same class+subject genuinely collide.
 */
function linkCoversSection(
  link: { sectionId: string | null },
  sectionId: string | null,
): boolean {
  if (link.sectionId === null || sectionId === null) return true;
  return link.sectionId === sectionId;
}

/** Teachers other than `exceptStaffId` already holding this slot. */
export function findSubjectTeacherConflicts(
  masters: MastersState,
  input: {
    academicYearCode: string;
    classId: string;
    sectionId: string | null;
    subjectId: string;
    exceptStaffId?: string;
  },
): SubjectConflict[] {
  const out: SubjectConflict[] = [];
  for (const staff of masters.staff ?? []) {
    if (staff.id === input.exceptStaffId) continue;
    if (staff.status !== "active") continue;
    for (const link of staff.subjectTeachingLinks ?? []) {
      if (link.academicYearCode && link.academicYearCode !== input.academicYearCode) {
        continue;
      }
      if (link.classId !== input.classId) continue;
      if (link.subjectId !== input.subjectId) continue;
      if (!linkCoversSection(link, input.sectionId)) continue;
      out.push({
        staffId: staff.id,
        teacherName: staff.fullName,
        linkId: link.id,
        sectionId: link.sectionId,
      });
    }
  }
  return out;
}

/** The teacher currently marked primary class teacher of a section. */
export function findPrimaryClassTeacher(
  masters: MastersState,
  input: { academicYearCode: string; classId: string; sectionId: string },
): { staffId: string; teacherName: string } | null {
  for (const staff of masters.staff ?? []) {
    if (staff.status !== "active") continue;
    for (const link of staff.classTeacherLinks ?? []) {
      if (link.academicYearCode && link.academicYearCode !== input.academicYearCode) {
        continue;
      }
      if (link.classId !== input.classId) continue;
      if (link.sectionId !== input.sectionId) continue;
      if (!link.isPrimary) continue;
      return { staffId: staff.id, teacherName: staff.fullName };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

export type AllocationResult =
  | { ok: true; masters: MastersState; added: number; skipped: string[] }
  | { ok: false; error: string };

function replaceStaff(
  masters: MastersState,
  staffId: string,
  update: (s: StaffRecord) => StaffRecord,
): MastersState {
  return {
    ...masters,
    staff: (masters.staff ?? []).map((s) =>
      s.id === staffId ? update(s) : s,
    ),
  };
}

/**
 * Give a teacher one or more subjects for a class (optionally one
 * section). Subjects the teacher already holds for that scope are
 * skipped rather than duplicated, so pressing Add twice is harmless.
 *
 * Conflicts with *other* teachers are NOT resolved here — the caller is
 * expected to have shown them via `findSubjectTeacherConflicts` and
 * asked. `force` records the caller's decision to proceed anyway.
 */
export function assignSubjectTeaching(
  masters: MastersState,
  input: {
    staffId: string;
    academicYearCode: string;
    classId: string;
    /** null = all sections of the class */
    sectionId: string | null;
    subjectIds: string[];
    /** Falls back to the curriculum's periodsPerWeek when omitted */
    periodsPerWeek?: Record<string, number>;
  },
): AllocationResult {
  const staff = (masters.staff ?? []).find((s) => s.id === input.staffId);
  if (!staff) return { ok: false, error: "Pick a teacher" };
  if (!input.classId) return { ok: false, error: "Pick a class" };
  const subjectIds = input.subjectIds.filter(Boolean);
  if (subjectIds.length === 0) {
    return { ok: false, error: "Pick at least one subject" };
  }

  const options = listClassSubjectOptions(masters, input.classId);
  const byId = new Map(options.map((o) => [o.subjectId, o]));
  const existing = staff.subjectTeachingLinks ?? [];
  const skipped: string[] = [];
  const additions: StaffSubjectTeachingLink[] = [];

  for (const subjectId of subjectIds) {
    const option = byId.get(subjectId);
    if (!option) {
      // The subject is not on this class's curriculum — refusing beats
      // recording teaching that the class is not supposed to receive.
      skipped.push(subjectId);
      continue;
    }
    const already = existing.some(
      (l) =>
        l.classId === input.classId &&
        l.subjectId === subjectId &&
        (l.academicYearCode || input.academicYearCode) ===
          input.academicYearCode &&
        linkCoversSection(l, input.sectionId),
    );
    if (already) {
      skipped.push(option.name);
      continue;
    }
    additions.push({
      id: nid("sst"),
      classId: input.classId,
      sectionId: input.sectionId,
      subjectId,
      academicYearCode: input.academicYearCode,
      periodsPerWeek:
        input.periodsPerWeek?.[subjectId] ?? option.periodsPerWeek ?? 0,
    });
  }

  if (additions.length === 0) {
    return {
      ok: false,
      error: "Already assigned — nothing new to add",
    };
  }

  return {
    ok: true,
    added: additions.length,
    skipped,
    masters: replaceStaff(masters, input.staffId, (s) => ({
      ...s,
      subjectTeachingLinks: [...(s.subjectTeachingLinks ?? []), ...additions],
    })),
  };
}

export function removeSubjectTeaching(
  masters: MastersState,
  staffId: string,
  linkId: string,
): MastersState {
  return replaceStaff(masters, staffId, (s) => ({
    ...s,
    subjectTeachingLinks: (s.subjectTeachingLinks ?? []).filter(
      (l) => l.id !== linkId,
    ),
  }));
}

/**
 * Make a teacher class teacher of a section.
 *
 * A section has one primary class teacher, so promoting a new one
 * demotes the incumbent rather than leaving two — the parent-facing
 * "your class teacher is…" lookups take the first primary they find, and
 * two would make that answer depend on array order.
 */
export function assignClassTeacher(
  masters: MastersState,
  input: {
    staffId: string;
    academicYearCode: string;
    classId: string;
    sectionId: string;
    isPrimary?: boolean;
  },
): { ok: true; masters: MastersState; replaced: string | null } | { ok: false; error: string } {
  if (!input.staffId) return { ok: false, error: "Pick a teacher" };
  if (!input.classId || !input.sectionId) {
    return { ok: false, error: "Pick a class and section" };
  }
  const staff = (masters.staff ?? []).find((s) => s.id === input.staffId);
  if (!staff) return { ok: false, error: "Pick a teacher" };

  const isPrimary = input.isPrimary !== false;
  const already = (staff.classTeacherLinks ?? []).some(
    (l) =>
      l.classId === input.classId &&
      l.sectionId === input.sectionId &&
      (l.academicYearCode || input.academicYearCode) === input.academicYearCode,
  );
  if (already) {
    return { ok: false, error: "Already class teacher of that section" };
  }

  const incumbent = isPrimary
    ? findPrimaryClassTeacher(masters, {
        academicYearCode: input.academicYearCode,
        classId: input.classId,
        sectionId: input.sectionId,
      })
    : null;

  const link: StaffClassTeacherLink = {
    id: nid("sct"),
    classId: input.classId,
    sectionId: input.sectionId,
    academicYearCode: input.academicYearCode,
    isPrimary,
  };

  let next: MastersState = masters;
  if (incumbent && incumbent.staffId !== input.staffId) {
    next = replaceStaff(next, incumbent.staffId, (s) => ({
      ...s,
      classTeacherLinks: (s.classTeacherLinks ?? []).map((l) =>
        l.classId === input.classId &&
        l.sectionId === input.sectionId &&
        l.isPrimary
          ? { ...l, isPrimary: false }
          : l,
      ),
    }));
  }
  next = replaceStaff(next, input.staffId, (s) => ({
    ...s,
    classTeacherLinks: [...(s.classTeacherLinks ?? []), link],
  }));

  return {
    ok: true,
    masters: next,
    replaced:
      incumbent && incumbent.staffId !== input.staffId
        ? incumbent.teacherName
        : null,
  };
}

export function removeClassTeacher(
  masters: MastersState,
  staffId: string,
  linkId: string,
): MastersState {
  return replaceStaff(masters, staffId, (s) => ({
    ...s,
    classTeacherLinks: (s.classTeacherLinks ?? []).filter(
      (l) => l.id !== linkId,
    ),
  }));
}

/* ------------------------------------------------------------------ */
/* Gaps — what is still unassigned                                     */
/* ------------------------------------------------------------------ */

export type AllocationGap = {
  classId: string;
  className: string;
  sectionId: string;
  sectionName: string;
  subjectId: string;
  subjectName: string;
  periodsPerWeek: number;
  /** An elective still needs a teacher, but fewer students sit it */
  isOptional: boolean;
};

/**
 * Every class-section-subject the curriculum requires that no active
 * teacher holds. This is the number the allocation desk counts down.
 */
export function listAllocationGaps(
  masters: MastersState,
  academicYearCode: string,
): AllocationGap[] {
  const out: AllocationGap[] = [];
  const classes = (masters.classes ?? []).filter((c) => c.isActive);

  for (const cls of classes) {
    const sections = sectionsOfClass(masters, cls.id);
    const options = listClassSubjectOptions(masters, cls.id);
    for (const section of sections) {
      for (const option of options) {
        if (option.periodsPerWeek <= 0) continue;
        const covered =
          findSubjectTeacherConflicts(masters, {
            academicYearCode,
            classId: cls.id,
            sectionId: section.id,
            subjectId: option.subjectId,
          }).length > 0;
        if (covered) continue;
        out.push({
          classId: cls.id,
          className: cls.name,
          sectionId: section.id,
          sectionName: section.name,
          subjectId: option.subjectId,
          subjectName: option.name,
          periodsPerWeek: option.periodsPerWeek,
          isOptional: option.isOptional,
        });
      }
    }
  }
  return out;
}

/** One teacher's weekly period load from their subject links. */
export function teacherWeeklyLoad(
  masters: MastersState,
  staffId: string,
  academicYearCode: string,
): number {
  const staff = (masters.staff ?? []).find((s) => s.id === staffId);
  if (!staff) return 0;
  let total = 0;
  for (const link of staff.subjectTeachingLinks ?? []) {
    if (link.academicYearCode && link.academicYearCode !== academicYearCode) {
      continue;
    }
    // An all-sections link is taught once per section, so it costs the
    // teacher its periods for each one.
    const multiplier =
      link.sectionId === null
        ? Math.max(1, sectionsOfClass(masters, link.classId).length)
        : 1;
    total += (link.periodsPerWeek || 0) * multiplier;
  }
  return total;
}
