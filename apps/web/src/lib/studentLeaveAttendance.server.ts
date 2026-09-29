/**
 * Putting approved student leave onto the attendance registers, server-side,
 * for ONE child (2026-09-29).
 *
 * The browser's `applyLeaveToAttendance` rebuilds the whole section register
 * for every date of the leave and marks every *other* child present where
 * no mark exists. On a date nobody has taken attendance yet — any leave
 * approved in advance, or a day the register was simply never filled — that
 * invents a class full of "present" marks, and the section then reads as
 * "attendance done" in the principal's snapshot (it counts registers).
 * Unknown must not become fact.
 *
 * So this touches only registers that already exist, read fresh from the
 * database (never from this instance's cached desk, which can be minutes
 * old and would put back other children's stale marks), and changes only
 * the leave child's mark. Dates with no register are returned as `unmarked`
 * for the teacher to mark in the normal way; the approved request stays on
 * record for them (and for the "present on leave" exception check).
 */

import {
  findRegister,
  loadAttendance,
  writeAttendanceLocalRaw,
  type AttendanceMark,
  type AttendanceStatus,
} from "@/lib/attendance";
import { STUDENT_LEAVE_TYPES, type StudentLeaveRequest } from "@/lib/studentLeave";

export type ApplyLeaveResult = {
  /** Registers that now carry the leave mark in the database. */
  appliedDates: string[];
  /** No register exists yet — nothing was created. */
  unmarkedDates: string[];
  /** A register exists but could not be read or saved. */
  failedDates: string[];
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function leaveDates(fromDate: string, toDate: string): string[] {
  const out: string[] = [];
  if (!ISO_DAY.test(fromDate)) return out;
  const end = ISO_DAY.test(toDate) ? toDate : fromDate;
  const d = new Date(`${fromDate}T00:00:00Z`);
  const stop = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(stop.getTime())) return out;
  // A runaway range must not spin forever; a term's leave is well under this.
  for (let i = 0; i <= 120 && d <= stop; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export async function applyApprovedLeaveToRegisters(input: {
  request: StudentLeaveRequest;
  sectionId: string;
}): Promise<ApplyLeaveResult> {
  const { request: req, sectionId } = input;
  const { fetchAttendanceRegisterFromDb, pushAttendanceRegisterToDb } =
    await import("@/lib/attendanceNormalized.server");
  const typeMeta = STUDENT_LEAVE_TYPES.find((t) => t.code === req.leaveType);
  const status: AttendanceStatus = typeMeta?.attendance ?? "LE";
  const note = `Leave ${req.leaveType}: ${req.reason}`.slice(0, 120);

  const result: ApplyLeaveResult = { appliedDates: [], unmarkedDates: [], failedDates: [] };
  for (const date of leaveDates(req.fromDate, req.toDate)) {
    const found = await fetchAttendanceRegisterFromDb(req.academicYearCode, sectionId, date);
    if (!found.ok || found.ambiguous) {
      if (!found.ok) console.warn("[leaveAttendance] register read failed", date, found.error);
      result.failedDates.push(date);
      continue;
    }
    const reg = found.register;
    if (!reg) {
      result.unmarkedDates.push(date);
      continue;
    }

    const mine: AttendanceMark = { studentId: req.studentId, status, note };
    const marks = reg.marks.some((m) => m.studentId === req.studentId)
      ? reg.marks.map((m) => (m.studentId === req.studentId ? mine : m))
      : [...reg.marks, mine];
    // Header (markedBy / markedAt / remark) stays the teacher's: they took
    // this register; the leave changed one line of it.
    const next = { ...reg, marks };
    const push = await pushAttendanceRegisterToDb(next).catch((e: unknown) => ({
      ok: false as const,
      error: (e as Error)?.message || String(e),
    }));
    if (!push.ok) {
      console.warn("[leaveAttendance] register push failed", date, push.error);
      result.failedDates.push(date);
      continue;
    }
    result.appliedDates.push(date);

    // Keep this instance's cached desk in step — but only replace a register
    // it already holds. Adding one to an empty/cold cache would make the
    // cache look like a (tiny) whole desk to the next writer.
    const cur = loadAttendance();
    if (findRegister(reg.academicYearCode, sectionId, date, cur)?.id === reg.id) {
      writeAttendanceLocalRaw({
        ...cur,
        registers: cur.registers.map((r) => (r.id === reg.id ? next : r)),
      });
    }
  }
  return result;
}
