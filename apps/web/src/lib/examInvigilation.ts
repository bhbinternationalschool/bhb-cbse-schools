/**
 * Exam invigilation duty — who watches which room during which exam sitting.
 *
 * Nothing in the codebase assigned invigilators before this: the datesheet
 * (lib/exams.ts) has no room/invigilator concept, and Masters → Staff duty
 * only carries a static year-long "exam_incharge" tag, not a dated
 * per-sitting assignment. This is a new, separate record keyed by exam
 * datesheet entry + teacher, mirroring the timetable substitution engine's
 * conflict-checking approach (lib/timetableSubstitution.ts) — reusing
 * absentTeachersForDate() and the "already busy at this time" check.
 *
 * Room is a free-text label (e.g. "Room 12", "Hall A"), not a capacity-aware
 * master — seating-plan / room-capacity logic is deliberately out of scope
 * for this pass (a separate, larger feature).
 *
 * Storage: localStorage only for now, no server dual-write — unlike most of
 * this app's modules. Wiring this into the desk-slice sync pattern (see
 * lib/deskSliceRegistry.ts) needs a new Supabase migration, which wasn't
 * done here; duty assignments made in one browser won't be visible from
 * another device until that lands.
 */

import type { ExamDateSheetEntry, ExamsState } from "@/lib/exams";
import type { MastersState } from "@/lib/masters";
import type { TimetableState } from "@/lib/timetable";
import { teacherLabel, teachingPeriods } from "@/lib/timetable";
import { isoDateWeekday } from "@/lib/examTimetable";
import { absentTeachersForDate, type AbsentTeacher } from "@/lib/timetableSubstitution";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";
import { trackServerWork } from "@/lib/serverWork";

export type InvigilationAssignment = {
  id: string;
  academicYearCode: string;
  examEntryId: string;
  roomLabel: string;
  teacherId: string;
  note: string;
  createdAt: string;
  createdBy: string;
};

export type InvigilationState = {
  version: 1;
  assignments: InvigilationAssignment[];
};

const STORAGE_KEY = "bhb_exam_invigilation_v1";

function nid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function emptyInvigilationState(): InvigilationState {
  return { version: 1, assignments: [] };
}

function normalizeAssignment(
  a: Partial<InvigilationAssignment> | null | undefined,
): InvigilationAssignment | null {
  if (!a?.id || !a.examEntryId || !a.teacherId) return null;
  return {
    id: a.id,
    academicYearCode: String(a.academicYearCode || ""),
    examEntryId: a.examEntryId,
    roomLabel: String(a.roomLabel || "").trim(),
    teacherId: a.teacherId,
    note: String(a.note || ""),
    createdAt: a.createdAt || nowIso(),
    createdBy: String(a.createdBy || ""),
  };
}

export function normalizeInvigilationState(raw: unknown): InvigilationState {
  if (!raw || typeof raw !== "object") return emptyInvigilationState();
  const r = raw as Partial<InvigilationState>;
  const assignments = Array.isArray(r.assignments)
    ? r.assignments
        .map((a) => normalizeAssignment(a as Partial<InvigilationAssignment>))
        .filter((x): x is InvigilationAssignment => !!x)
    : [];
  return { version: 1, assignments };
}

export function loadInvigilation(): InvigilationState {
  if (typeof window === "undefined") return emptyInvigilationState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyInvigilationState();
    return normalizeInvigilationState(JSON.parse(raw));
  } catch {
    return emptyInvigilationState();
  }
}

export function saveInvigilation(state: InvigilationState): InvigilationState {
  const next = normalizeInvigilationState(state);
  if (typeof window !== "undefined") {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(next));
    void trackServerWork(import("@/lib/localModulesPersistence").then((m) => m.scheduleModuleStateSync("exam_invigilation", next)));
    window.dispatchEvent(new CustomEvent("bhb-invigilation"));
  }
  return next;
}

/** Hydrate path (module_local_state) — cache write only, no RBAC, no push. */
export function writeInvigilationLocalRaw(state: InvigilationState): void {
  if (typeof window === "undefined") return;
  try {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota — the server copy is the truth anyway */
  }
  window.dispatchEvent(new CustomEvent("bhb-invigilation"));
}

export function assignmentsForEntry(
  state: InvigilationState,
  examEntryId: string,
): InvigilationAssignment[] {
  return state.assignments.filter((a) => a.examEntryId === examEntryId);
}

export function upsertInvigilationAssignment(
  state: InvigilationState,
  input: {
    id?: string;
    academicYearCode: string;
    examEntryId: string;
    roomLabel: string;
    teacherId: string;
    note?: string;
    createdBy: string;
  },
): { state: InvigilationState; assignment: InvigilationAssignment } {
  const existing = input.id
    ? state.assignments.find((a) => a.id === input.id)
    : undefined;
  const assignment: InvigilationAssignment = {
    id: existing?.id || nid("invig"),
    academicYearCode: input.academicYearCode,
    examEntryId: input.examEntryId,
    roomLabel: input.roomLabel.trim(),
    teacherId: input.teacherId,
    note: input.note || "",
    createdAt: existing?.createdAt || nowIso(),
    createdBy: existing?.createdBy || input.createdBy,
  };
  const assignments = existing
    ? state.assignments.map((a) => (a.id === assignment.id ? assignment : a))
    : [...state.assignments, assignment];
  return { state: saveInvigilation({ version: 1, assignments }), assignment };
}

export function deleteInvigilationAssignment(
  state: InvigilationState,
  id: string,
): InvigilationState {
  return saveInvigilation({
    version: 1,
    assignments: state.assignments.filter((a) => a.id !== id),
  });
}

export type InvigilationConflict =
  | { kind: "double_booked"; detail: string }
  | { kind: "teaching"; detail: string }
  | { kind: "absent"; detail: string };

function entryTimeRange(entry: ExamDateSheetEntry): { start: number; end: number } {
  const [h, m] = entry.startTime.split(":").map(Number);
  const start = (h || 0) * 60 + (m || 0);
  return { start, end: start + entry.durationMinutes };
}

function rangesOverlap(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Every reason `teacherId` should not invigilate `entry` — checked against
 * other invigilation duty already assigned, the regular weekly timetable
 * (they might be teaching another class right now), and today's staff
 * attendance/leave.
 */
export function invigilationConflictsFor(input: {
  state: InvigilationState;
  masters: MastersState;
  examsState: ExamsState;
  timetableState: TimetableState;
  entry: ExamDateSheetEntry;
  teacherId: string;
  excludeAssignmentId?: string;
}): InvigilationConflict[] {
  const { state, masters, examsState, timetableState, entry, teacherId, excludeAssignmentId } =
    input;
  const conflicts: InvigilationConflict[] = [];
  const myRange = entryTimeRange(entry);

  const otherAssignmentsToday = state.assignments.filter(
    (a) =>
      a.teacherId === teacherId &&
      a.id !== excludeAssignmentId &&
      a.examEntryId !== entry.id,
  );
  for (const a of otherAssignmentsToday) {
    const otherEntry = examsState.dateSheet.find((e) => e.id === a.examEntryId);
    if (!otherEntry || otherEntry.date !== entry.date) continue;
    if (rangesOverlap(myRange, entryTimeRange(otherEntry))) {
      conflicts.push({
        kind: "double_booked",
        detail: `Already invigilating another sitting ${otherEntry.startTime}–same day, room ${a.roomLabel || "—"}`,
      });
    }
  }

  const weekday = isoDateWeekday(entry.date);
  if (weekday != null) {
    const teaching = teachingPeriods(timetableState.bellTemplate);
    const busyPeriod = teaching.find((p) => {
      const pStart = Number(p.startTime.split(":")[0]) * 60 + Number(p.startTime.split(":")[1]);
      const pEnd = Number(p.endTime.split(":")[0]) * 60 + Number(p.endTime.split(":")[1]);
      return rangesOverlap(myRange, { start: pStart, end: pEnd });
    });
    if (busyPeriod) {
      const teaching_ = timetableState.grids.some(
        (g) =>
          g.academicYearCode === entry.academicYearCode &&
          g.slots.some(
            (s) => s.teacherId === teacherId && s.weekday === weekday && s.periodNo === busyPeriod.no,
          ),
      );
      if (teaching_) {
        conflicts.push({
          kind: "teaching",
          detail: `Scheduled to teach period ${busyPeriod.no} (${busyPeriod.label}) on the regular timetable`,
        });
      }
    }
  }

  const absent = absentTeachersForDate(masters, entry.academicYearCode, entry.date).find(
    (a) => a.staffId === teacherId,
  );
  if (absent) {
    conflicts.push({ kind: "absent", detail: absent.reason });
  }

  return conflicts;
}

export type InvigilationCandidate = {
  teacherId: string;
  name: string;
  conflicts: InvigilationConflict[];
  dutyLoadToday: number;
};

/** Free teachers first, ranked by how light their invigilation load is
 * today — spreads duty rather than reusing the same few teachers. */
export function invigilationCandidates(input: {
  state: InvigilationState;
  masters: MastersState;
  examsState: ExamsState;
  timetableState: TimetableState;
  entry: ExamDateSheetEntry;
}): InvigilationCandidate[] {
  const { state, masters, entry } = input;
  const activeTeaching = (masters.staff ?? []).filter(
    (s) => s.status === "active" && s.stream === "teaching",
  );
  const loadToday = new Map<string, number>();
  for (const a of state.assignments) {
    const e = input.examsState.dateSheet.find((x) => x.id === a.examEntryId);
    if (e?.date === entry.date) {
      loadToday.set(a.teacherId, (loadToday.get(a.teacherId) ?? 0) + 1);
    }
  }
  return activeTeaching
    .map((s) => ({
      teacherId: s.id,
      name: teacherLabel(masters, s.id),
      conflicts: invigilationConflictsFor({ ...input, teacherId: s.id }),
      dutyLoadToday: loadToday.get(s.id) ?? 0,
    }))
    .sort((a, b) => {
      const freeA = a.conflicts.length === 0 ? 0 : 1;
      const freeB = b.conflicts.length === 0 ? 0 : 1;
      if (freeA !== freeB) return freeA - freeB;
      return a.dutyLoadToday - b.dutyLoadToday;
    });
}

export type { AbsentTeacher };

/* -------------------------------------------------------------------------- */
/* The duty chart                                                             */
/* -------------------------------------------------------------------------- */

export type InvigilationCell = {
  entry: ExamDateSheetEntry;
  assignments: InvigilationAssignment[];
};

export type InvigilationGrid = {
  /** Exam days, ascending — the columns. */
  dates: string[];
  /** Classes that actually sit a paper, in the order given — the rows. */
  classIds: string[];
  /** Keyed `classId|date`. A list, because one class can sit two papers in a day. */
  cells: Map<string, InvigilationCell[]>;
  /** Sittings with nobody watching them, per date. */
  unwatchedByDate: Map<string, number>;
  sittings: number;
  unwatched: number;
  /**
   * Duties whose sitting no longer exists — a paper was deleted or moved to
   * another term after someone was put on it. They are invisible in a chart
   * drawn from the date sheet, so they are counted here rather than quietly
   * dropped: a teacher who thinks they are on duty is worse than one who
   * knows they are not.
   */
  orphans: InvigilationAssignment[];
};

/**
 * Arrange invigilation duty the way a date sheet is read: a class per row, an
 * exam day per column, who is watching in the cell.
 *
 * The flat list this replaces was one row per sitting — 103 of them for this
 * school's half-yearly — which cannot answer the two questions the office
 * actually asks: is anybody watching Tuesday, and is one teacher on duty all
 * day. Both are visible at a glance in a chart and in neither in a list.
 */
export function buildInvigilationGrid(input: {
  state: InvigilationState;
  entries: ExamDateSheetEntry[];
  /** Class order from masters, so the chart reads like the date sheet. */
  classOrder?: string[];
}): InvigilationGrid {
  const { state, entries, classOrder = [] } = input;

  const byEntry = new Map<string, InvigilationAssignment[]>();
  for (const a of state.assignments) {
    const list = byEntry.get(a.examEntryId);
    if (list) list.push(a);
    else byEntry.set(a.examEntryId, [a]);
  }

  const dates = [...new Set(entries.map((e) => e.date))].sort();
  const seen = new Set(entries.map((e) => e.classId));
  const classIds = [
    ...classOrder.filter((id) => seen.has(id)),
    ...[...seen].filter((id) => !classOrder.includes(id)),
  ];

  const cells = new Map<string, InvigilationCell[]>();
  const unwatchedByDate = new Map<string, number>();
  let unwatched = 0;

  for (const entry of entries) {
    const assignments = byEntry.get(entry.id) ?? [];
    const key = `${entry.classId}|${entry.date}`;
    const cell = cells.get(key);
    if (cell) cell.push({ entry, assignments });
    else cells.set(key, [{ entry, assignments }]);
    if (!assignments.length) {
      unwatched += 1;
      unwatchedByDate.set(entry.date, (unwatchedByDate.get(entry.date) ?? 0) + 1);
    }
  }

  // Two papers in one morning are shown in the order they start, not the
  // order they were typed.
  for (const cell of cells.values()) {
    cell.sort((a, b) => a.entry.startTime.localeCompare(b.entry.startTime));
  }

  const live = new Set(entries.map((e) => e.id));
  const orphans = state.assignments.filter((a) => !live.has(a.examEntryId));

  return {
    dates,
    classIds,
    cells,
    unwatchedByDate,
    sittings: entries.length,
    unwatched,
    orphans,
  };
}
