/**
 * Which exam marks are still to be entered, and by whom — for the staff
 * marks reminder (lib/staffReminders.ts).
 *
 * "Filled" is the Exams → Readiness dashboard's definition, computed with
 * the same functions (sectionReadiness over the grid's subject × component
 * columns, the subjects each child takes), so the reminder and the screen a
 * teacher opens can never disagree. Co-scholastic areas are left out: they
 * are the class teacher's, not a subject teacher's marks.
 *
 * Who enters a subject: the section's subject teachers for it (Staff →
 * Duties / Allocate teaching / the published timetable, matched by subject
 * code — the rule the staff app's marks route checks), else its class
 * teacher(s), who may enter every subject of their section.
 */
import { rosterForSection } from "@/lib/attendance";
import {
  componentsForSubject,
  findMarkSheet,
  gradedPartsForSubject,
  schemeForClassId,
  subjectsForMarkEntry,
  subjectTakeMap,
  type ExamsState,
  type MarkSheet,
} from "@/lib/exams";
import { sectionReadiness, type ReadinessColumn } from "@/lib/examReadiness";
import type { MastersState } from "@/lib/masters";
import type { SisState } from "@/lib/sis";
import { teachingSectionsFor } from "@/lib/staffTeachingScope";
import type { TimetableGrid } from "@/lib/timetable";
import { marksWindow, type MarksGap } from "@/lib/staffReminders";

/** Overdue exams are still reported this long after their deadline. */
export const MARKS_OVERDUE_DAYS = 30;

/** The exams whose deadline makes them relevant on `date`. */
export function termsInMarksWindow(
  exams: Pick<ExamsState, "terms" | "policy">,
  ay: string,
  date: string,
  leadDays: number,
): { termId: string; label: string; code: string; dueOn: string }[] {
  const due = exams.policy.marksDueByTerm ?? {};
  const out: { termId: string; label: string; code: string; dueOn: string }[] = [];
  for (const t of exams.terms) {
    if (!t.isActive || (ay && t.academicYearCode !== ay)) continue;
    const dueOn = due[t.id];
    if (!dueOn) continue;
    if (marksWindow(date, dueOn, leadDays) === "before") continue;
    const age = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${dueOn}T00:00:00Z`)) / 86_400_000;
    if (age > MARKS_OVERDUE_DAYS) continue;
    out.push({ termId: t.id, label: t.label || t.code, code: t.code, dueOn });
  }
  return out;
}

export function computeMarksGaps(input: {
  ay: string;
  masters: MastersState;
  sis: SisState;
  exams: ExamsState;
  terms: { termId: string; label: string; code: string; dueOn: string }[];
  /** Sheets of those terms (the strict reader); other terms' sheets are ignored. */
  sheets: readonly MarkSheet[];
  grids: readonly TimetableGrid[];
}): MarksGap[] {
  const { ay, masters, sis } = input;
  const state: ExamsState = { ...input.exams, sheets: [...input.sheets] };
  const deps = { state, masters, sis };

  // Who teaches what, per section, computed once per member of staff.
  const subjectTeachers = new Map<string, Map<string, Set<string>>>(); // "c|s" → code → staff
  const classTeachers = new Map<string, Set<string>>();
  for (const s of masters.staff ?? []) {
    if (s.status !== "active") continue;
    for (const t of teachingSectionsFor({ staffId: s.id, masters, grids: [...input.grids], academicYearCodes: [ay] })) {
      const key = `${t.classId}|${t.sectionId}`;
      if (t.isClassTeacher) {
        const set = classTeachers.get(key) ?? new Set<string>();
        set.add(s.id);
        classTeachers.set(key, set);
        continue;
      }
      const byCode = subjectTeachers.get(key) ?? new Map<string, Set<string>>();
      for (const sub of t.subjects) {
        const code = (sub.code || "").trim().toUpperCase();
        if (!code) continue;
        const set = byCode.get(code) ?? new Set<string>();
        set.add(s.id);
        byCode.set(code, set);
      }
      subjectTeachers.set(key, byCode);
    }
  }

  const classes = (masters.classes ?? [])
    .filter((c) => c.isActive !== false)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
  const gaps: MarksGap[] = [];
  for (const term of input.terms) {
    for (const cls of classes) {
      const sections = (masters.sections ?? [])
        .filter((x) => x.classId === cls.id && x.isActive !== false)
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const sec of sections) {
        const roster = rosterForSection(sis.students, sec.id, { classId: cls.id, academicYearCode: ay });
        if (roster.length === 0) continue;
        const subjects = subjectsForMarkEntry(cls.id, roster, state, deps);
        if (subjects.length === 0) continue;
        const scheme = schemeForClassId(cls.id, state.policy);
        const columns: ReadinessColumn[] = subjects.flatMap((subject) => {
          const parts = componentsForSubject(scheme, term.code, subject.code);
          const name = subject.name || subject.code;
          const graded = gradedPartsForSubject(scheme, term.code, subject.code).map((g) => ({
            subjectId: subject.id,
            subjectName: name,
            component: g.code,
            graded: true,
          }));
          return [
            ...(parts.length === 0
              ? [{ subjectId: subject.id, subjectName: name, component: "" }]
              : parts.map((p) => ({ subjectId: subject.id, subjectName: name, component: p.code }))),
            ...graded,
          ];
        });
        const sheet = findMarkSheet(ay, term.termId, sec.id, state) ?? null;
        if (sheet?.lockedAt) continue; // locked by the exams desk: nothing left to enter
        const readiness = sectionReadiness({
          studentIds: roster.map((s) => s.id),
          columns,
          takes: subjectTakeMap(roster, subjects, state, deps),
          areas: [],
          sheet,
          entryMode: scheme.displayMode !== "marks_grade" ? "grades" : "marks",
        });
        const key = `${cls.id}|${sec.id}`;
        const seen = new Set<string>();
        for (const p of readiness.pending) {
          if (p.kind !== "subject" || seen.has(p.key)) continue;
          seen.add(p.key);
          const subject = subjects.find((x) => x.id === p.key);
          const code = (subject?.code || "").trim().toUpperCase();
          const teachers = [...(subjectTeachers.get(key)?.get(code) ?? classTeachers.get(key) ?? [])];
          if (teachers.length === 0) continue;
          gaps.push({
            termId: term.termId,
            termLabel: term.label,
            dueOn: term.dueOn,
            classId: cls.id,
            sectionId: sec.id,
            sectionLabel: `Class ${cls.name}${sec.name ? ` · ${sec.name}` : ""}`,
            subjectName: subject?.name || p.label,
            teacherIds: teachers.sort(),
          });
        }
      }
    }
  }
  return gaps;
}
