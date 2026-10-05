/**
 * Is a section's result ready for one exam — and if not, what is missing?
 *
 * Pure: the caller resolves the roster, the subjects each child takes, the
 * subject × component columns and the co-scholastic areas exactly as the
 * marks-entry grid does, and passes the saved sheet. This only counts, so
 * the dashboard and the grid can never disagree about what "filled" means.
 *
 * A cell is filled when the grid would show something in it: a mark (or a
 * grade, in a grade-only scheme), or the child marked absent for that
 * subject. Absent is an answer, not a gap. A subject the child does not take
 * is not a cell at all.
 */

import type { MarkSheet } from "@/lib/exams";

export type ReadinessColumn = {
  subjectId: string;
  subjectName: string;
  /** SchemeComponent code, "" for the whole subject. */
  component: string;
};

export type SectionReadinessInput = {
  studentIds: string[];
  columns: ReadinessColumn[];
  /** studentId → exam-subject ids on that child's curriculum. A student
   * missing from the map takes every subject. */
  takes: Map<string, Set<string>>;
  areas: { code: string; label: string }[];
  sheet: Pick<MarkSheet, "marks" | "absences" | "coScholastic" | "lockedAt"> | null;
  entryMode: "marks" | "grades";
};

export type ReadinessStatus = "ready" | "partial" | "not_started" | "no_students" | "nothing_to_enter";

export type PendingItem = {
  kind: "subject" | "co_scholastic";
  /** Exam subject id, or the co-scholastic area code. */
  key: string;
  label: string;
  filled: number;
  total: number;
};

export type SectionReadiness = {
  status: ReadinessStatus;
  filled: number;
  total: number;
  /** Only the parts still short, in column order — subjects, then areas. */
  pending: PendingItem[];
  locked: boolean;
  /** Students with at least one gap. */
  studentsPending: number;
};

export function sectionReadiness(input: SectionReadinessInput): SectionReadiness {
  const sheet = input.sheet;
  const locked = !!sheet?.lockedAt;
  if (input.studentIds.length === 0) {
    return { status: "no_students", filled: 0, total: 0, pending: [], locked, studentsPending: 0 };
  }

  const markKey = (st: string, sub: string, comp: string) => `${st}\u0000${sub}\u0000${comp}`;
  const entered = new Set<string>();
  for (const m of sheet?.marks ?? []) {
    const has =
      input.entryMode === "grades"
        ? !!m.grade && m.grade.trim() !== "" && m.grade !== "—"
        : m.marksObtained != null;
    if (has) entered.add(markKey(m.studentId, m.subjectId, m.component ?? ""));
  }
  const absent = new Set((sheet?.absences ?? []).map((a) => `${a.studentId}\u0000${a.subjectId}`));
  const rated = new Set(
    (sheet?.coScholastic ?? [])
      .filter((e) => e.rating != null)
      .map((e) => `${e.studentId}\u0000${e.domain}`),
  );

  const order: string[] = [];
  const bySubject = new Map<string, PendingItem>();
  const byArea = new Map<string, PendingItem>();
  const studentsWithGap = new Set<string>();
  let filled = 0;
  let total = 0;

  for (const st of input.studentIds) {
    const takes = input.takes.get(st);
    for (const col of input.columns) {
      if (takes && !takes.has(col.subjectId)) continue;
      let item = bySubject.get(col.subjectId);
      if (!item) {
        item = { kind: "subject", key: col.subjectId, label: col.subjectName, filled: 0, total: 0 };
        bySubject.set(col.subjectId, item);
        order.push(col.subjectId);
      }
      item.total += 1;
      total += 1;
      if (absent.has(`${st}\u0000${col.subjectId}`) || entered.has(markKey(st, col.subjectId, col.component))) {
        item.filled += 1;
        filled += 1;
      } else {
        studentsWithGap.add(st);
      }
    }
    for (const area of input.areas) {
      let item = byArea.get(area.code);
      if (!item) {
        item = { kind: "co_scholastic", key: area.code, label: area.label, filled: 0, total: 0 };
        byArea.set(area.code, item);
      }
      item.total += 1;
      total += 1;
      if (rated.has(`${st}\u0000${area.code}`)) {
        item.filled += 1;
        filled += 1;
      } else {
        studentsWithGap.add(st);
      }
    }
  }

  const pending = [
    ...order.map((id) => bySubject.get(id)!),
    ...input.areas.map((a) => byArea.get(a.code)).filter((x): x is PendingItem => !!x),
  ].filter((p) => p.filled < p.total);

  const status: ReadinessStatus =
    total === 0 ? "nothing_to_enter" : filled === 0 ? "not_started" : filled === total ? "ready" : "partial";
  return { status, filled, total, pending, locked, studentsPending: studentsWithGap.size };
}

export function readinessStatusLabel(r: SectionReadiness): string {
  switch (r.status) {
    case "ready":
      return r.locked ? "Ready · locked" : "Ready";
    case "partial":
      return "Partial";
    case "not_started":
      return "Not started";
    case "no_students":
      return "No students";
    case "nothing_to_enter":
      return "No subjects";
  }
}
