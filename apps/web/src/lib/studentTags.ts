/**
 * Student tags — create/assign; shown before student names across the ERP.
 */

import {
  loadSis,
  normalizeStudentTag,
  saveSis,
  type SisState,
  type SisStudent,
  type StudentTag,
} from "@/lib/sis";

export type { StudentTag };

const TAG_COLORS = [
  "#1565c0",
  "#2e7d32",
  "#c62828",
  "#6a1b9a",
  "#ef6c00",
  "#00838f",
  "#4527a0",
  "#ad1457",
];

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export const DEFAULT_STUDENT_TAGS: Omit<StudentTag, "id" | "createdAt">[] = [
  { code: "STAFF", name: "Staff ward", color: "#1565c0", isActive: true },
  { code: "SIB", name: "Sibling", color: "#00838f", isActive: true },
  { code: "RTE", name: "RTE", color: "#c62828", isActive: true },
  { code: "EWS", name: "EWS", color: "#ef6c00", isActive: true },
  { code: "SPORT", name: "Sports", color: "#2e7d32", isActive: true },
  { code: "NEED", name: "Special care", color: "#6a1b9a", isActive: true },
];

export function ensureDefaultTags(sis: SisState): SisState {
  if ((sis.tags ?? []).length > 0) return sis;
  return {
    ...sis,
    tags: DEFAULT_STUDENT_TAGS.map((t) =>
      normalizeStudentTag({ ...t, id: id("stag") }),
    ),
  };
}

export function listStudentTags(sis?: SisState): StudentTag[] {
  const raw = sis ?? loadSis();
  const state = ensureDefaultTags(raw);
  if (!(raw.tags ?? []).length && (state.tags ?? []).length) {
    saveSis(state);
  }
  return (state.tags ?? [])
    .filter((t) => t.isActive)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function tagsForStudent(
  student: Pick<SisStudent, "tagIds">,
  sis?: SisState,
): StudentTag[] {
  const state = sis ?? loadSis();
  const ids = student.tagIds ?? [];
  if (!ids.length) return [];
  const map = new Map((state.tags ?? []).map((t) => [t.id, t]));
  return ids
    .map((tid) => map.get(tid))
    .filter((t): t is StudentTag => !!t && t.isActive);
}

export function tagLabelsForStudent(
  student: Pick<SisStudent, "tagIds">,
  sis?: SisState,
): string {
  return tagsForStudent(student, sis)
    .map((t) => t.code)
    .join(", ");
}

export function createStudentTag(input: {
  name: string;
  code?: string;
  color?: string;
}): { ok: true; tag: StudentTag } | { ok: false; error: string } {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Tag name required" };
  const sis = ensureDefaultTags(loadSis());
  const code = (input.code?.trim() || name.slice(0, 8))
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .slice(0, 12);
  if ((sis.tags ?? []).some((t) => t.code === code && t.isActive)) {
    return { ok: false, error: `Tag code ${code} already exists` };
  }
  const used = new Set((sis.tags ?? []).map((t) => t.color));
  const color =
    input.color ||
    TAG_COLORS.find((c) => !used.has(c)) ||
    TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)]!;
  const tag = normalizeStudentTag({ name, code, color });
  saveSis({ ...sis, tags: [...(sis.tags ?? []), tag] });
  return { ok: true, tag };
}

export function updateStudentTag(
  tagId: string,
  patch: Partial<Pick<StudentTag, "name" | "code" | "color" | "isActive">>,
): { ok: true } | { ok: false; error: string } {
  const sis = loadSis();
  const idx = (sis.tags ?? []).findIndex((t) => t.id === tagId);
  if (idx < 0) return { ok: false, error: "Tag not found" };
  const next = [...(sis.tags ?? [])];
  next[idx] = normalizeStudentTag({ ...next[idx]!, ...patch, id: tagId });
  saveSis({ ...sis, tags: next });
  return { ok: true };
}

export function assignStudentTags(
  studentId: string,
  tagIds: string[],
): { ok: true; student: SisStudent } | { ok: false; error: string } {
  const sis = loadSis();
  const idx = sis.students.findIndex((s) => s.id === studentId);
  if (idx < 0) return { ok: false, error: "Student not found" };
  const valid = new Set(
    (sis.tags ?? []).filter((t) => t.isActive).map((t) => t.id),
  );
  const cleaned = [...new Set(tagIds.filter((tid) => valid.has(tid)))];
  const students = [...sis.students];
  const student = { ...students[idx]!, tagIds: cleaned };
  students[idx] = student;
  saveSis({ ...sis, students });
  return { ok: true, student };
}

export function toggleStudentTag(
  studentId: string,
  tagId: string,
): { ok: true; student: SisStudent } | { ok: false; error: string } {
  const sis = loadSis();
  const student = sis.students.find((s) => s.id === studentId);
  if (!student) return { ok: false, error: "Student not found" };
  const has = (student.tagIds ?? []).includes(tagId);
  const next = has
    ? (student.tagIds ?? []).filter((tid) => tid !== tagId)
    : [...(student.tagIds ?? []), tagId];
  return assignStudentTags(studentId, next);
}

/**
 * Ensure RTE / EWS tags exist; return ids to attach when admitting from govt list.
 */
export function ensureRteEwsTagIds(input?: {
  type?: "RTE" | "EWS" | "SCHOLARSHIP";
  category?: string;
}): string[] {
  let sis = ensureDefaultTags(loadSis());
  const codes = new Set<string>(["RTE"]);
  if (
    input?.type === "EWS" ||
    (input?.category || "").toUpperCase() === "EWS"
  ) {
    codes.add("EWS");
  }
  const catalog: Record<string, { name: string; color: string }> = {
    RTE: { name: "RTE", color: "#c62828" },
    EWS: { name: "EWS", color: "#ef6c00" },
  };
  let tags = [...(sis.tags ?? [])];
  let dirty = false;
  for (const code of codes) {
    const meta = catalog[code]!;
    const existing = tags.find((t) => t.code === code);
    if (!existing) {
      tags.push(
        normalizeStudentTag({
          name: meta.name,
          code,
          color: meta.color,
          isActive: true,
        }),
      );
      dirty = true;
    } else if (!existing.isActive) {
      tags = tags.map((t) =>
        t.id === existing.id ? { ...t, isActive: true } : t,
      );
      dirty = true;
    }
  }
  if (dirty) {
    sis = { ...sis, tags };
    saveSis(sis);
  }
  return [...codes]
    .map(
      (code) =>
        (sis.tags ?? []).find((t) => t.code === code && t.isActive)?.id,
    )
    .filter((x): x is string => !!x);
}

export { TAG_COLORS };
