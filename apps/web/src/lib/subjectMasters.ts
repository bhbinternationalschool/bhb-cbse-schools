/**
 * The rules behind Masters → Subjects: what the school's subject table
 * shows, what a new or edited subject must satisfy, and when a subject may
 * be deleted rather than only deactivated.
 *
 * Pure so every rule is testable; the screen is SubjectsPanel.tsx.
 *
 * Why this exists (30 Sep 2026): the old screen listed only subjects whose
 * code was in the NEP pack or that were already linked to a class. A subject
 * the school added itself — MATH, or MATH-ORAL under Early Numeracy — saved
 * correctly and then never appeared, so it looked like Add did nothing and
 * MATH-ORAL was added twice. Here a school subject is ALWAYS listed; a stage
 * filter may narrow the list but never hides a subject linked nowhere.
 */

import {
  newFoundationId,
  normalizeSubject,
  type ClassSubjectLink,
  type StaffRecord,
  type Subject,
  type SubjectCategory,
} from "@/lib/foundationMasters";
import type { NcfTagId, LanguageSubtype } from "@/lib/cbseSubjectGroups";
import type { ClassGroupCode, SchoolClass } from "@/lib/masters";
import type { NepStage, NepStagePack } from "@/lib/nepSubjectSuggestions";

export const CLASS_GROUP_TO_NEP: Record<ClassGroupCode, NepStage> = {
  PRE_PRIMARY: "foundational",
  PRIMARY: "preparatory",
  MIDDLE: "middle",
  SECONDARY: "secondary_9_10",
  SENIOR: "secondary_11_12",
};

/** The slice of Masters these rules read. */
export type SubjectsSlice = {
  subjects: Subject[];
  classSubjects: ClassSubjectLink[];
  classes: SchoolClass[];
  staff?: StaffRecord[];
};

/* ── The school's own table ──────────────────────────────────────────── */

export type SchoolSubjectRow = {
  subject: Subject;
  /** 0 = subject, 1 = component under it. */
  depth: 0 | 1;
  parent: Subject | null;
  componentCount: number;
  /** Active class links, by class name, in class order. */
  classNames: string[];
};

function byOrder(a: Subject, b: Subject): number {
  return a.sortOrder - b.sortOrder || a.code.localeCompare(b.code);
}

/**
 * Every school subject, components right under their subject.
 *
 * `groupClassIds` narrows to a stage: a subject shows when it (or its
 * parent, or one of its components) is linked to a class in that stage —
 * or when it is linked to NO class at all, because a subject the school
 * has just added belongs on screen until someone links it.
 */
export function schoolSubjectRows(
  slice: SubjectsSlice,
  opts?: { groupClassIds?: Set<string> | null; query?: string },
): SchoolSubjectRow[] {
  const { subjects, classSubjects, classes } = slice;
  const classById = new Map(classes.map((c) => [c.id, c] as const));
  const activeLinks = classSubjects.filter((l) => l.isActive);
  const linksBySubject = new Map<string, ClassSubjectLink[]>();
  for (const l of activeLinks) {
    const list = linksBySubject.get(l.subjectId) ?? [];
    list.push(l);
    linksBySubject.set(l.subjectId, list);
  }
  const classNamesOf = (id: string) =>
    (linksBySubject.get(id) ?? [])
      .map((l) => classById.get(l.classId))
      .filter((c): c is SchoolClass => !!c)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((c) => c.name);

  const ids = new Set(subjects.map((s) => s.id));
  const tops = subjects
    // An orphan component (its parent was removed) is shown as a subject
    // rather than lost.
    .filter((s) => !s.parentId || !ids.has(s.parentId))
    .sort(byOrder);

  const group = opts?.groupClassIds ?? null;
  const inStage = (id: string): boolean => {
    const links = linksBySubject.get(id) ?? [];
    if (!group) return true;
    return links.some((l) => group.has(l.classId));
  };
  const linkedAnywhere = (id: string) => (linksBySubject.get(id) ?? []).length > 0;

  const q = (opts?.query ?? "").trim().toLowerCase();
  const matches = (s: Subject) =>
    !q || s.code.toLowerCase().includes(q) || s.nameEn.toLowerCase().includes(q);

  const out: SchoolSubjectRow[] = [];
  for (const top of tops) {
    const kids = subjects.filter((s) => s.parentId === top.id).sort(byOrder);
    const family = [top, ...kids];
    if (group) {
      const shows =
        family.some((s) => inStage(s.id)) || family.every((s) => !linkedAnywhere(s.id));
      if (!shows) continue;
    }
    if (q && !family.some(matches)) continue;
    out.push({
      subject: top,
      depth: 0,
      parent: null,
      componentCount: kids.length,
      classNames: classNamesOf(top.id),
    });
    for (const k of kids) {
      out.push({
        subject: k,
        depth: 1,
        parent: top,
        componentCount: 0,
        classNames: classNamesOf(k.id),
      });
    }
  }
  return out;
}

/* ── Add / edit ──────────────────────────────────────────────────────── */

export type SubjectDraft = {
  code: string;
  nameEn: string;
  /** Empty = a subject; an id = a component under that subject. */
  parentId: string;
  category: SubjectCategory;
  coScholasticArea: string;
  /** Empty = derive from the code, as normalizeSubject always has. */
  ncfTagId: NcfTagId | "";
  languageSubtype: LanguageSubtype;
  isElective: boolean;
};

export function emptySubjectDraft(parentId = ""): SubjectDraft {
  return {
    code: "",
    nameEn: "",
    parentId,
    category: "scholastic",
    coScholasticArea: "",
    ncfTagId: "",
    languageSubtype: "",
    isElective: false,
  };
}

export function draftFromSubject(s: Subject): SubjectDraft {
  return {
    code: s.code,
    nameEn: s.nameEn,
    parentId: s.parentId ?? "",
    category: s.category,
    coScholasticArea: s.coScholasticArea,
    ncfTagId: s.ncfTagId,
    languageSubtype: s.languageSubtype,
    isElective: s.isElective,
  };
}

export function normalizeSubjectCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "-");
}

/**
 * Why this draft cannot be saved, or null.
 *
 * Codes are unique across the whole school, components included: marks,
 * timetables and report cards find a subject by its code, and two
 * MATH-ORAL rows is exactly how the old screen's silent add ended.
 */
export function subjectDraftError(
  subjects: Subject[],
  draft: SubjectDraft,
  editingId?: string,
): string | null {
  const code = normalizeSubjectCode(draft.code);
  if (!code) return "Enter a code";
  if (!/^[A-Z0-9][A-Z0-9_./-]*$/.test(code)) {
    return "Code may use letters, numbers and - _ . / only";
  }
  if (!draft.nameEn.trim()) return "Enter a name";
  const clash = subjects.find(
    (s) => s.id !== editingId && s.code.trim().toUpperCase() === code,
  );
  if (clash) {
    return `Code ${code} is already used by ${clash.nameEn}${clash.isActive ? "" : " (inactive)"}`;
  }
  if (draft.parentId) {
    const parent = subjects.find((s) => s.id === draft.parentId);
    if (!parent) return "That subject no longer exists";
    if (parent.id === editingId) return "A subject cannot be its own component";
    if (parent.parentId) return "Components go under a subject, not under another component";
    if (editingId && subjects.some((s) => s.parentId === editingId)) {
      return "This subject has components — move or delete them before making it a component";
    }
  }
  return null;
}

/** A new subject row from a valid draft. */
export function subjectFromDraft(subjects: Subject[], draft: SubjectDraft): Subject {
  const parent = draft.parentId ? subjects.find((s) => s.id === draft.parentId) ?? null : null;
  const category = parent?.category ?? draft.category;
  return normalizeSubject({
    id: newFoundationId("sub"),
    code: normalizeSubjectCode(draft.code),
    nameEn: draft.nameEn.trim(),
    category,
    coScholasticArea: category === "co_scholastic" ? draft.coScholasticArea.trim() : "",
    parentId: parent?.id ?? null,
    isElective: draft.isElective,
    isActive: true,
    sortOrder: parent
      ? subjects.filter((s) => s.parentId === parent.id).length + 1
      : subjects.filter((s) => !s.parentId).length + 1,
    ncfTagId: draft.ncfTagId || parent?.ncfTagId || undefined,
    cbseGroupId: draft.ncfTagId || parent?.ncfTagId || null,
    languageSubtype: draft.languageSubtype || parent?.languageSubtype || undefined,
  });
}

/** The edited subject; id, active flag and order are kept. */
export function applySubjectDraft(
  subjects: Subject[],
  existing: Subject,
  draft: SubjectDraft,
): Subject {
  const parent = draft.parentId ? subjects.find((s) => s.id === draft.parentId) ?? null : null;
  const category = parent?.category ?? draft.category;
  const moved = (existing.parentId ?? "") !== (parent?.id ?? "");
  return normalizeSubject({
    ...existing,
    code: normalizeSubjectCode(draft.code),
    nameEn: draft.nameEn.trim(),
    category,
    coScholasticArea: category === "co_scholastic" ? draft.coScholasticArea.trim() : "",
    parentId: parent?.id ?? null,
    isElective: draft.isElective,
    sortOrder: moved
      ? parent
        ? subjects.filter((s) => s.parentId === parent.id).length + 1
        : subjects.filter((s) => !s.parentId).length + 1
      : existing.sortOrder,
    // An explicit tag wins; "auto" re-derives from the (possibly new) code.
    ncfTagId: draft.ncfTagId || undefined,
    cbseGroupId: draft.ncfTagId || null,
    languageSubtype: draft.languageSubtype || undefined,
  });
}

/* ── Delete ──────────────────────────────────────────────────────────── */

/**
 * What still points at this subject. Empty = safe to delete.
 *
 * Anything here means Deactivate instead: deleting a subject a class is
 * linked to, or a teacher is assigned to, would leave those records naming
 * an id that no longer exists — the class's timetable and the teacher's
 * scope would quietly lose a subject.
 */
export function subjectDeleteBlockers(slice: SubjectsSlice, id: string): string[] {
  const out: string[] = [];
  const kids = slice.subjects.filter((s) => s.parentId === id);
  if (kids.length > 0) {
    out.push(`${kids.length} component${kids.length === 1 ? "" : "s"} (${kids.map((k) => k.code).join(", ")})`);
  }
  const links = slice.classSubjects.filter((l) => l.subjectId === id);
  if (links.length > 0) {
    const names = links
      .map((l) => slice.classes.find((c) => c.id === l.classId)?.name)
      .filter(Boolean);
    out.push(`linked to ${links.length} class${links.length === 1 ? "" : "es"}${names.length ? ` (${names.join(", ")})` : ""}`);
  }
  const teachers = (slice.staff ?? []).filter((st) =>
    (st.subjectTeachingLinks ?? []).some((t) => t.subjectId === id),
  );
  if (teachers.length > 0) {
    out.push(
      `assigned to ${teachers.length} teacher${teachers.length === 1 ? "" : "s"} (${teachers
        .slice(0, 3)
        .map((t) => t.fullName)
        .join(", ")}${teachers.length > 3 ? "…" : ""})`,
    );
  }
  return out;
}

/* ── NCF / NEP suggestion table ──────────────────────────────────────── */

export type NcfSuggestionRow = {
  code: string;
  nameEn: string;
  underCode: string;
  category: SubjectCategory;
  note: string;
  periodsPerWeek: number;
  /** The school's subject with this code, when there is one. */
  present: Subject | null;
};

export function ncfSuggestionRows(
  pack: NepStagePack,
  subjects: Subject[],
  periodsFor: (item: NepStagePack["subjects"][number]) => number,
): NcfSuggestionRow[] {
  const byCode = new Map(subjects.map((s) => [s.code.trim().toUpperCase(), s] as const));
  return pack.subjects.map((item) => ({
    code: item.code.toUpperCase(),
    nameEn: item.nameEn,
    underCode: (item.underCode ?? "").toUpperCase(),
    category: item.category,
    note: item.note ?? "",
    periodsPerWeek: periodsFor(item),
    present: byCode.get(item.code.toUpperCase()) ?? null,
  }));
}

/** A pack holding just one suggestion (and its parent, if the school lacks it). */
export function singleSuggestionPack(pack: NepStagePack, code: string): NepStagePack {
  const item = pack.subjects.find((s) => s.code.toUpperCase() === code.toUpperCase());
  if (!item) return { ...pack, subjects: [] };
  const parent = item.underCode
    ? pack.subjects.find((s) => s.code.toUpperCase() === item.underCode!.toUpperCase())
    : undefined;
  return { ...pack, subjects: parent ? [parent, item] : [item] };
}
