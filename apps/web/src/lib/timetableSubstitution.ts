/**
 * Substitute-teacher arrangement for a calendar date.
 *
 * Absent teachers are auto-detected from the staff attendance register
 * (A / LE / HD marks) and approved staff leave. The auto-arranger then finds
 * a free, preferably subject-qualified teacher for every affected period.
 * The school can always override each row manually before saving.
 */

import type { MastersState } from "@/lib/masters";
import type { StaffRecord } from "@/lib/foundationMasters";
import { findStaffRegister, loadStaffAttendance } from "@/lib/staffAttendance";
import { loadStaffHr } from "@/lib/staffHr";
import { examBlocksForClassDate, isoDateWeekday } from "@/lib/examTimetable";
import {
  loadTimetable,
  normalizeSubstitution,
  normalizeTeacherTimeBlock,
  saveTimetable,
  teachingPeriods,
  type TeacherTimeBlock,
  type TimetableGrid,
  type TimetableState,
  type TimetableSubstitution,
} from "@/lib/timetable";

export type AbsentTeacher = {
  staffId: string;
  /** Where the absence came from */
  source: "attendance" | "leave" | "manual";
  reason: string;
};

export type AffectedPeriod = {
  weekday: number;
  periodNo: number;
  classId: string;
  sectionId: string;
  subjectId: string;
  absentTeacherId: string;
  /** Exam sitting already masks this period on that date — no substitute needed */
  examMasked: boolean;
};

export type SubstituteCandidate = {
  staff: StaffRecord;
  /** true = teaches this subject (class match ranks higher) */
  subjectMatch: boolean;
  classMatch: boolean;
  /** Periods already taught on this weekday (regular grid) */
  dayLoad: number;
  /** Substitutions already given for this date */
  subLoad: number;
  score: number;
};

function teachesSubject(
  staff: StaffRecord,
  subjectId: string,
  classId: string,
  academicYearCode: string,
): { subjectMatch: boolean; classMatch: boolean } {
  let subjectMatch = false;
  let classMatch = false;
  for (const l of staff.subjectTeachingLinks ?? []) {
    if (l.subjectId !== subjectId) continue;
    if (l.academicYearCode && l.academicYearCode !== academicYearCode) continue;
    subjectMatch = true;
    if (l.classId === classId) classMatch = true;
  }
  return { subjectMatch, classMatch };
}

/**
 * Teachers absent on a date: staff attendance marks A / LE / HD for that
 * day, plus approved leave requests covering the date.
 */
export function absentTeachersForDate(
  masters: MastersState,
  academicYearCode: string,
  date: string,
): AbsentTeacher[] {
  const out = new Map<string, AbsentTeacher>();
  const activeIds = new Set(
    (masters.staff ?? []).filter((s) => s.status === "active").map((s) => s.id),
  );

  const register = findStaffRegister(
    loadStaffAttendance(),
    date,
    academicYearCode,
  );
  for (const mark of register?.marks ?? []) {
    if (!activeIds.has(mark.staffId)) continue;
    if (mark.status === "A") {
      out.set(mark.staffId, {
        staffId: mark.staffId,
        source: "attendance",
        reason: "Marked absent (staff attendance)",
      });
    } else if (mark.status === "LE") {
      out.set(mark.staffId, {
        staffId: mark.staffId,
        source: "attendance",
        reason: "On leave (staff attendance)",
      });
    } else if (mark.status === "HD") {
      out.set(mark.staffId, {
        staffId: mark.staffId,
        source: "attendance",
        reason: "Half day (staff attendance)",
      });
    }
  }

  for (const req of loadStaffHr().leaveRequests) {
    if (req.status !== "approved") continue;
    if (req.academicYearCode !== academicYearCode) continue;
    if (!req.fromDate || !req.toDate) continue;
    if (date < req.fromDate || date > req.toDate) continue;
    if (!activeIds.has(req.staffId)) continue;
    if (out.has(req.staffId)) continue;
    out.set(req.staffId, {
      staffId: req.staffId,
      source: "leave",
      reason: `Approved ${req.typeCode} leave${req.halfDay ? " (half day)" : ""}`,
    });
  }

  return [...out.values()];
}

function sessionGrids(
  state: TimetableState,
  academicYearCode: string,
): TimetableGrid[] {
  return state.grids.filter((g) => g.academicYearCode === academicYearCode);
}

/** Periods on `date` normally taught by any of the absent teachers. */
export function affectedPeriodsForDate(input: {
  state?: TimetableState;
  academicYearCode: string;
  date: string;
  absentTeacherIds: string[];
}): AffectedPeriod[] {
  const weekday = isoDateWeekday(input.date);
  if (weekday == null || !input.absentTeacherIds.length) return [];
  const state = input.state ?? loadTimetable();
  const absent = new Set(input.absentTeacherIds);
  const out: AffectedPeriod[] = [];
  const examCache = new Map<string, Set<number>>();

  for (const grid of sessionGrids(state, input.academicYearCode)) {
    for (const slot of grid.slots) {
      if (slot.weekday !== weekday) continue;
      if (!slot.teacherId || !absent.has(slot.teacherId)) continue;
      if (!examCache.has(grid.classId)) {
        const blocks = examBlocksForClassDate({
          academicYearCode: input.academicYearCode,
          classId: grid.classId,
          date: input.date,
          bellTemplate: state.bellTemplate,
        });
        examCache.set(
          grid.classId,
          new Set(blocks.flatMap((b) => b.periodNos)),
        );
      }
      out.push({
        weekday,
        periodNo: slot.periodNo,
        classId: grid.classId,
        sectionId: grid.sectionId,
        subjectId: slot.subjectId,
        absentTeacherId: slot.teacherId,
        examMasked: examCache.get(grid.classId)!.has(slot.periodNo),
      });
    }
  }
  return out.sort((a, b) => a.periodNo - b.periodNo);
}

/**
 * Ranked substitute candidates for one affected period.
 * `taken` = teacherIds already substituting at the same weekday|period today.
 */
export function substituteCandidates(input: {
  masters: MastersState;
  state: TimetableState;
  academicYearCode: string;
  period: Pick<
    AffectedPeriod,
    "weekday" | "periodNo" | "classId" | "subjectId"
  >;
  absentTeacherIds: Set<string>;
  takenTeacherIds: Set<string>;
  subLoadByTeacher: Map<string, number>;
}): SubstituteCandidate[] {
  const busy = new Set<string>();
  const dayLoad = new Map<string, number>();
  for (const g of sessionGrids(input.state, input.academicYearCode)) {
    for (const s of g.slots) {
      if (!s.teacherId || s.weekday !== input.period.weekday) continue;
      dayLoad.set(s.teacherId, (dayLoad.get(s.teacherId) || 0) + 1);
      if (s.periodNo === input.period.periodNo) busy.add(s.teacherId);
    }
  }

  const out: SubstituteCandidate[] = [];
  for (const staff of input.masters.staff ?? []) {
    if (staff.status !== "active") continue;
    if (input.absentTeacherIds.has(staff.id)) continue;
    if (busy.has(staff.id)) continue;
    if (input.takenTeacherIds.has(staff.id)) continue;
    const { subjectMatch, classMatch } = teachesSubject(
      staff,
      input.period.subjectId,
      input.period.classId,
      input.academicYearCode,
    );
    const load = dayLoad.get(staff.id) || 0;
    const subs = input.subLoadByTeacher.get(staff.id) || 0;
    const score =
      (classMatch ? 60 : 0) +
      (subjectMatch ? 40 : 0) -
      load * 6 -
      subs * 12;
    out.push({
      staff,
      subjectMatch,
      classMatch,
      dayLoad: load,
      subLoad: subs,
      score,
    });
  }
  return out.sort(
    (a, b) => b.score - a.score || a.staff.fullName.localeCompare(b.staff.fullName),
  );
}

export type AutoArrangeResult = {
  substitutions: TimetableSubstitution[];
  /** Periods where no free teacher could be found (left free) */
  uncovered: AffectedPeriod[];
  /** Periods skipped because an exam sitting already blocks them */
  examSkipped: AffectedPeriod[];
};

/**
 * Arrange substitutes for an already-resolved list of affected periods.
 * Pure computation — the school reviews/edits, then saves explicitly.
 * `source` tags the resulting rows: "auto" for whole-day absence-driven
 * runs, "block" for a partial-day TeacherTimeBlock (see
 * planSubstitutionsForTimeBlock).
 */
export function arrangeSubstitutesForPeriods(input: {
  masters: MastersState;
  state: TimetableState;
  academicYearCode: string;
  date: string;
  weekday: number;
  periods: AffectedPeriod[];
  source?: TimetableSubstitution["source"];
}): AutoArrangeResult {
  const { masters, state, academicYearCode, date, weekday, periods } = input;
  const source = input.source ?? "auto";
  const absentSet = new Set(periods.map((p) => p.absentTeacherId));
  const subLoad = new Map<string, number>();
  const takenByPeriod = new Map<number, Set<string>>();
  const substitutions: TimetableSubstitution[] = [];
  const uncovered: AffectedPeriod[] = [];
  const examSkipped: AffectedPeriod[] = [];
  const label = source === "block" ? "Reassigned" : "Auto";

  for (const period of periods) {
    if (period.examMasked) {
      examSkipped.push(period);
      continue;
    }
    const taken = takenByPeriod.get(period.periodNo) ?? new Set<string>();
    takenByPeriod.set(period.periodNo, taken);
    const [best] = substituteCandidates({
      masters,
      state,
      academicYearCode,
      period,
      absentTeacherIds: absentSet,
      takenTeacherIds: taken,
      subLoadByTeacher: subLoad,
    });
    const sub = normalizeSubstitution({
      academicYearCode,
      date,
      weekday,
      periodNo: period.periodNo,
      classId: period.classId,
      sectionId: period.sectionId,
      subjectId: period.subjectId,
      absentTeacherId: period.absentTeacherId,
      substituteTeacherId: best?.staff.id || "",
      source,
      note: best
        ? best.classMatch || best.subjectMatch
          ? `${label} — subject teacher`
          : `${label} — free teacher`
        : "No free teacher — period left free",
    })!;
    substitutions.push(sub);
    if (best) {
      taken.add(best.staff.id);
      subLoad.set(best.staff.id, (subLoad.get(best.staff.id) || 0) + 1);
    } else {
      uncovered.push(period);
    }
  }

  return { substitutions, uncovered, examSkipped };
}

/**
 * Auto-arrange substitutes for all affected periods on `date`.
 * Pure computation — the school reviews/edits, then saves explicitly.
 */
export function autoArrangeSubstitutes(input: {
  masters: MastersState;
  academicYearCode: string;
  date: string;
  absentTeacherIds: string[];
  state?: TimetableState;
}): AutoArrangeResult {
  const state = input.state ?? loadTimetable();
  const weekday = isoDateWeekday(input.date);
  const periods = affectedPeriodsForDate({
    state,
    academicYearCode: input.academicYearCode,
    date: input.date,
    absentTeacherIds: input.absentTeacherIds,
  });
  return arrangeSubstitutesForPeriods({
    masters: input.masters,
    state,
    academicYearCode: input.academicYearCode,
    date: input.date,
    weekday: weekday ?? 0,
    periods,
  });
}

/**
 * Periods on `date` normally taught by `staffId` that fall inside
 * [startTime, endTime) — the subset of their day affected by a
 * TeacherTimeBlock, not the whole day. Uses the same exam-masking as
 * affectedPeriodsForDate. Overlap is inclusive of any partial overlap: a
 * period is affected unless it ends at/before the block starts or starts
 * at/after the block ends.
 */
export function affectedPeriodsForTimeBlock(input: {
  state?: TimetableState;
  academicYearCode: string;
  date: string;
  staffId: string;
  startTime: string;
  endTime: string;
}): AffectedPeriod[] {
  const state = input.state ?? loadTimetable();
  const periods = affectedPeriodsForDate({
    state,
    academicYearCode: input.academicYearCode,
    date: input.date,
    absentTeacherIds: [input.staffId],
  });
  if (!periods.length) return periods;
  const bellByNo = new Map(
    teachingPeriods(state.bellTemplate).map((p) => [p.no, p]),
  );
  return periods.filter((p) => {
    const bell = bellByNo.get(p.periodNo);
    if (!bell) return false;
    return bell.startTime < input.endTime && bell.endTime > input.startTime;
  });
}

/**
 * Find substitutes for just the periods of `staffId`'s day that overlap
 * [startTime, endTime) — the partial-day counterpart to
 * autoArrangeSubstitutes. Pure computation — does not save.
 */
export function planSubstitutionsForTimeBlock(input: {
  masters: MastersState;
  academicYearCode: string;
  date: string;
  staffId: string;
  startTime: string;
  endTime: string;
  state?: TimetableState;
}): AutoArrangeResult {
  const state = input.state ?? loadTimetable();
  const weekday = isoDateWeekday(input.date);
  const periods = affectedPeriodsForTimeBlock({
    state,
    academicYearCode: input.academicYearCode,
    date: input.date,
    staffId: input.staffId,
    startTime: input.startTime,
    endTime: input.endTime,
  });
  return arrangeSubstitutesForPeriods({
    masters: input.masters,
    state,
    academicYearCode: input.academicYearCode,
    date: input.date,
    weekday: weekday ?? 0,
    periods,
    source: "block",
  });
}

/** Record a teacher's partial-day unavailability. Does not touch
 * substitutions — pair with planSubstitutionsForTimeBlock +
 * saveSubstitutionsForDate to actually arrange cover. */
export function saveTeacherTimeBlock(
  block: Partial<TeacherTimeBlock>,
): { ok: true; block: TeacherTimeBlock } | { ok: false; error: string } {
  const normalized = normalizeTeacherTimeBlock(block);
  if (!normalized) return { ok: false, error: "Pick a teacher and date" };
  const state = loadTimetable();
  saveTimetable({
    ...state,
    teacherTimeBlocks: [...state.teacherTimeBlocks, normalized],
  });
  return { ok: true, block: normalized };
}

/** Identity key for "same class+section+period+day" — used to dedupe a
 * freshly-computed batch of substitutions against what's already saved for
 * a date, so a confirm action can safely merge instead of overwrite. */
export function substitutionSlotKey(s: {
  weekday: number;
  periodNo: number;
  classId: string;
  sectionId: string;
}): string {
  return `${s.weekday}|${s.periodNo}|${s.classId}|${s.sectionId}`;
}

export function listSubstitutionsForDate(
  academicYearCode: string,
  date: string,
  state?: TimetableState,
): TimetableSubstitution[] {
  const s = state ?? loadTimetable();
  return (s.substitutions ?? [])
    .filter((x) => x.academicYearCode === academicYearCode && x.date === date)
    .sort((a, b) => a.periodNo - b.periodNo);
}

/** Replace the saved arrangement for one date (school's edited final list). */
export function saveSubstitutionsForDate(
  academicYearCode: string,
  date: string,
  substitutions: TimetableSubstitution[],
): { ok: true } | { ok: false; error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: "Pick a valid date" };
  }
  const state = loadTimetable();
  const rest = (state.substitutions ?? []).filter(
    (x) => !(x.academicYearCode === academicYearCode && x.date === date),
  );
  const cleaned = substitutions
    .map((s) =>
      normalizeSubstitution({ ...s, academicYearCode, date }),
    )
    .filter((x): x is TimetableSubstitution => !!x);
  saveTimetable({ ...state, substitutions: [...rest, ...cleaned] });
  return { ok: true };
}

export function clearSubstitutionsForDate(
  academicYearCode: string,
  date: string,
): { ok: true } {
  const state = loadTimetable();
  saveTimetable({
    ...state,
    substitutions: (state.substitutions ?? []).filter(
      (x) => !(x.academicYearCode === academicYearCode && x.date === date),
    ),
  });
  return { ok: true };
}
