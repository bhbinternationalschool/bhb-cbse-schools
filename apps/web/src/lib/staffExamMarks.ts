/**
 * What the staff app may write into a section's mark sheet, and how its
 * entries merge into the sheet — pure, so the refusals are pinned by a
 * self-test rather than discovered on a teacher's phone.
 *
 * The app enters ONE number per subject (the whole mark). Since 2026-10-11
 * it may also pick the letter for a subject's graded part (Handwriting A/B/C)
 * by sending `component` + `grade`. Since 2026-10-28 it may enter the numeric
 * marks parts of a split subject (Oral 20 + Written 80) too, sending a number
 * per part keyed by `component`, each validated against that part's own max.
 * Grade-only schemes still stay on the exams desk, where those columns exist.
 *
 * Old app builds know nothing of graded parts: they send
 * `{ studentId, marksObtained }`, which is always the whole mark. They can
 * neither write a number into a graded part nor wipe one — the merge keys
 * rows by student, subject AND part, so the graded rows ride through.
 */

import type { SchemeComponent, GradedPart } from "@/lib/examSchemes";
import { parsePartGrade } from "@/lib/examSchemes";
import type { StudentSubjectMark } from "@/lib/exams";

export type StaffAppMarkEntry = {
  studentId: string;
  marksObtained?: number | null;
  /** "" / absent = the whole subject mark; else a graded part's code. */
  component?: string;
  /** Graded parts only: a letter from the part's list, "" to clear. */
  grade?: string;
};

export type StaffAppSubjectRules = {
  subjectName: string;
  termLabel: string;
  /** componentsForSubject for this exam — the marks parts. */
  marksParts: SchemeComponent[];
  /** gradedPartsForSubject for this exam. */
  gradedParts: GradedPart[];
  /** The scheme assesses whole subjects by grade (grade-only / descriptors). */
  gradeOnlyScheme: boolean;
};

/** Why these entries cannot be saved from the app, or null when they can. */
export function staffAppEntriesProblem(
  entries: StaffAppMarkEntry[],
  rules: StaffAppSubjectRules,
): string | null {
  const graded = new Map(rules.gradedParts.map((g) => [g.code, g]));
  const marksByCode = new Map(rules.marksParts.map((c) => [c.code, c]));
  let wantsWhole = false;
  for (const e of entries) {
    if (!e || typeof e.studentId !== "string" || !e.studentId) return "Every entry needs a studentId";
    const component = String(e.component ?? "").trim().toUpperCase();
    const n = e.marksObtained;
    if (!component) {
      if (n != null && (typeof n !== "number" || !Number.isFinite(n) || n < 0)) {
        return "Marks must be a number ≥ 0 or blank";
      }
      wantsWhole = true;
      continue;
    }
    const part = graded.get(component);
    if (part) {
      if (n != null) {
        return `${rules.subjectName} (${part.label}) is graded (${part.grades.join(", ")}), not marked — send a grade, not a number`;
      }
      const g = parsePartGrade(part.grades, e.grade);
      if (!g.ok) return `${rules.subjectName} (${part.label}): ${g.error}`;
      continue;
    }
    const marksPart = marksByCode.get(component);
    if (marksPart) {
      // A numeric marks part (Written 80, Oral 20): a number of its own, 0..max.
      if (String(e.grade ?? "").trim()) {
        return `${rules.subjectName} (${marksPart.label}) is marked, not graded — send a number, not a grade`;
      }
      if (n != null && (typeof n !== "number" || !Number.isFinite(n) || n < 0)) {
        return "Marks must be a number ≥ 0 or blank";
      }
      if (n != null && n > marksPart.maxMarks) {
        return `${rules.subjectName} (${marksPart.label}): marks cannot exceed ${marksPart.maxMarks}`;
      }
      continue;
    }
    return `${rules.subjectName}: "${component}" is not one of its parts for ${rules.termLabel}`;
  }
  if (wantsWhole && rules.marksParts.length > 0) {
    return `${rules.subjectName} is marked in parts for ${rules.termLabel} (${rules.marksParts
      .map((c) => `${c.label} ${c.maxMarks}`)
      .join(" + ")}). Enter a mark in each part, not one whole mark.`;
  }
  if (wantsWhole && rules.gradeOnlyScheme) {
    return "This class is assessed by grades, not marks. Enter them on the exams desk.";
  }
  return null;
}

/**
 * The sheet's marks with the app's entries applied: one row per student ×
 * subject × part, every other row exactly as stored. Run
 * staffAppEntriesProblem first.
 */
export function mergeStaffAppEntries(
  existing: StudentSubjectMark[],
  subjectId: string,
  entries: StaffAppMarkEntry[],
): StudentSubjectMark[] {
  const key = (studentId: string, sub: string, component: string) => `${studentId}:${sub}:${component}`;
  const byKey = new Map(existing.map((m) => [key(m.studentId, m.subjectId, m.component || ""), m]));
  for (const e of entries) {
    const component = String(e.component ?? "").trim().toUpperCase();
    const k = key(e.studentId, subjectId, component);
    const prev = byKey.get(k);
    if (component) {
      // A graded part carries a `grade` key (Handwriting A/B/C); a numeric
      // marks part (Written 80, Oral 20) carries a number. The grade of a
      // numeric row is recomputed by prepareMarkSheet from its marks.
      if (e.grade !== undefined) {
        byKey.set(k, {
          studentId: e.studentId,
          subjectId,
          component,
          marksObtained: null,
          grade: String(e.grade ?? "").trim() || "—",
          remark: prev?.remark ?? "",
          remarkSource: prev?.remarkSource ?? "manual",
        });
        continue;
      }
      byKey.set(k, {
        studentId: e.studentId,
        subjectId,
        component,
        marksObtained: e.marksObtained == null ? null : Math.round(e.marksObtained * 2) / 2,
        grade: prev?.grade ?? "",
        remark: prev?.remark ?? "",
        remarkSource: prev?.remarkSource ?? "manual",
      });
      continue;
    }
    byKey.set(k, {
      studentId: e.studentId,
      subjectId,
      component: "",
      marksObtained: e.marksObtained == null ? null : Math.round(e.marksObtained * 2) / 2,
      grade: prev?.grade ?? "",
      remark: prev?.remark ?? "",
      remarkSource: prev?.remarkSource ?? "manual",
    });
  }
  return [...byKey.values()];
}
