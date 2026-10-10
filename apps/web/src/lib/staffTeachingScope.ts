/**
 * A teacher's own sections and subjects — "my classes".
 *
 * Pure (no I/O, no browser/server split) so the same answer drives the
 * server's write checks, the staff app's picker and the web ERP's class
 * dropdowns. Self-tested in staffTeachingScope.selftest.ts.
 *
 * Until 2026-09-29 the server built scope from class-teacher links and the
 * published timetable only. The school has never published a timetable, so
 * every subject allocation made in Staff → Duties was invisible: subject
 * teachers were refused on every save, and every picker listed all 13
 * sections because there was nothing narrower to offer.
 */

import type {
  ClassSubjectLink,
  StaffRecord,
} from "@/lib/foundationMasters";

/** `code` is how the exams desk names a subject — its ids are its own
 * (sub_eng, not the Masters id), so exam screens match on the code. */
export type TeachingSubject = { id: string; name: string; code: string };

export type TeachingSection = {
  classId: string;
  className: string;
  sectionId: string;
  sectionName: string;
  isClassTeacher: boolean;
  /** For a class teacher: every subject the class studies. For a subject
   * teacher: only the subjects they were given. */
  subjects: TeachingSubject[];
};

type MastersLike = {
  staff?: StaffRecord[];
  classes: { id: string; name: string; sortOrder?: number; isActive?: boolean }[];
  sections: { id: string; classId: string; name: string; isActive?: boolean }[];
  subjects: {
    id: string;
    code?: string;
    nameEn?: string;
    name?: string;
    parentId?: string | null;
    isActive?: boolean;
  }[];
  classSubjects?: ClassSubjectLink[];
};

type GridLike = {
  academicYearCode: string;
  classId: string;
  sectionId: string;
  slots: { teacherId: string; subjectId: string }[];
};

export function sectionKey(classId: string, sectionId: string): string {
  return `${classId}|${sectionId}`;
}

/** `2026-2027` / `2026–27` → `2026-27`. */
export function normalizeYear(code: string): string {
  const t = (code || "").trim().replace(/\s+/g, "").replace(/–/g, "-");
  const full = t.match(/^(20\d{2})-(20\d{2})$/);
  if (full) return `${full[1]}-${full[2]!.slice(2)}`;
  return t;
}

/** A link stamped with no year belongs to every year; otherwise it must
 * match one of the accepted years (normalized). */
function yearMatches(linkYear: string, accepted: Set<string>): boolean {
  if (!linkYear) return true;
  return accepted.has(normalizeYear(linkYear));
}

export function teachingSectionsFor(opts: {
  staffId: string;
  masters: MastersLike;
  grids?: GridLike[];
  /** Usually [Masters' current year, the session's year]. */
  academicYearCodes: string[];
}): TeachingSection[] {
  const { staffId, masters } = opts;
  if (!staffId) return [];
  const staff = (masters.staff ?? []).find((s) => s.id === staffId) || null;
  const accepted = new Set(
    opts.academicYearCodes.filter(Boolean).map(normalizeYear),
  );

  const classById = new Map(masters.classes.map((c) => [c.id, c]));
  const sectionById = new Map(masters.sections.map((s) => [s.id, s]));
  const liveSection = (id: string) => {
    const s = sectionById.get(id);
    return s && s.isActive !== false ? s : null;
  };
  const subjectById = new Map(masters.subjects.map((x) => [x.id, x]));
  const subjectName = (id: string) => {
    const s = subjectById.get(id);
    return s?.nameEn || s?.name || "";
  };
  const classSubjectIds = (classId: string) =>
    (masters.classSubjects ?? [])
      .filter((l) => l.classId === classId && l.isActive !== false)
      .map((l) => l.subjectId);

  // Teaching "Hindi — Oral" is teaching Hindi: the marks sheet and the
  // homework subject list work on the parent (HIN), so it comes along.
  const withParent = (id: string): string[] => {
    const parent = subjectById.get(id)?.parentId;
    return parent && subjectById.has(parent) ? [id, parent] : [id];
  };

  type Acc = { classId: string; sectionId: string; isClassTeacher: boolean; subjects: Set<string> };
  const acc = new Map<string, Acc>();
  const touch = (classId: string, sectionId: string): Acc | null => {
    if (!classById.has(classId) || !liveSection(sectionId)) return null;
    const key = sectionKey(classId, sectionId);
    let a = acc.get(key);
    if (!a) {
      a = { classId, sectionId, isClassTeacher: false, subjects: new Set() };
      acc.set(key, a);
    }
    return a;
  };

  for (const l of staff?.classTeacherLinks ?? []) {
    if (!yearMatches(l.academicYearCode, accepted)) continue;
    const a = touch(l.classId, l.sectionId);
    if (a) a.isClassTeacher = true;
  }

  for (const l of staff?.subjectTeachingLinks ?? []) {
    if (!yearMatches(l.academicYearCode, accepted)) continue;
    // A link with no section means the subject in every section of the class.
    const sectionIds = l.sectionId
      ? [l.sectionId]
      : masters.sections.filter((s) => s.classId === l.classId).map((s) => s.id);
    for (const sid of sectionIds) {
      const a = touch(l.classId, sid);
      if (a && l.subjectId) for (const id of withParent(l.subjectId)) a.subjects.add(id);
    }
  }

  for (const g of opts.grids ?? []) {
    if (!yearMatches(g.academicYearCode, accepted)) continue;
    for (const slot of g.slots) {
      if (slot.teacherId !== staffId) continue;
      const a = touch(g.classId, g.sectionId);
      if (a && slot.subjectId) for (const id of withParent(slot.subjectId)) a.subjects.add(id);
    }
  }

  const out: TeachingSection[] = [];
  for (const a of acc.values()) {
    const ids = new Set(a.subjects);
    if (a.isClassTeacher) for (const id of classSubjectIds(a.classId)) ids.add(id);
    out.push({
      classId: a.classId,
      className: classById.get(a.classId)?.name || "",
      sectionId: a.sectionId,
      sectionName: sectionById.get(a.sectionId)?.name || "",
      isClassTeacher: a.isClassTeacher,
      subjects: [...ids]
        .map((id) => ({
          id,
          name: subjectName(id),
          code: (subjectById.get(id)?.code || "").trim().toUpperCase(),
        }))
        .filter((s) => s.name)
        .sort((x, y) => x.name.localeCompare(y.name)),
    });
  }
  const order = (classId: string) => classById.get(classId)?.sortOrder ?? 0;
  return out.sort(
    (x, y) =>
      Number(y.isClassTeacher) - Number(x.isClassTeacher) ||
      order(x.classId) - order(y.classId) ||
      x.sectionName.localeCompare(y.sectionName),
  );
}
