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
    void import("@/lib/localModulesPersistence").then((m) => m.scheduleModuleStateSync("exam_invigilation", next));
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
