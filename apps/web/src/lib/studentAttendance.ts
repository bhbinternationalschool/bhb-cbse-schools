/**
 * One child's attendance, read out of the class registers.
 *
 * Attendance is stored per class per day, so answering "how often is this
 * girl in school?" meant opening the Attendance desk and reading down a
 * month at a time. The profile is where that question is asked — by a
 * teacher before a PTM, by the office before a fee call, by the principal
 * before signing a leaving certificate.
 *
 * Two rules this file exists to hold:
 *
 *   * A percentage needs its denominator. With nothing marked the answer
 *     is `null` — "not marked yet" — never 0%. A child shown at 0% because
 *     the register was never opened is an accusation the school cannot
 *     support.
 *   * One day counts once. A section change mid-year leaves the child in
 *     two registers for the same date, and a class re-marked in the
 *     evening leaves two versions of it. Both would inflate the day count
 *     and quietly change the percentage; the latest marking of a date wins.
 *
 * The present-day arithmetic (late counts full, half day counts half)
 * matches the school's own monthly percentage report, so the profile and
 * the report never disagree in front of a parent.
 */

import type {
  AttendanceMark,
  AttendanceRegister,
  AttendanceStatus,
} from "@/lib/attendance";

export type StudentAttendanceDay = {
  date: string;
  status: AttendanceStatus;
  note: string;
  classId: string;
  sectionId: string;
  markedAt: string;
};

export type StudentAttendanceMonth = {
  /** YYYY-MM */
  month: string;
  marked: number;
  presentDays: number;
  absent: number;
  /** null when nothing is marked in that month. */
  percent: number | null;
};

export type StudentAttendanceSummary = {
  /** Newest first, one row per date. */
  days: StudentAttendanceDay[];
  marked: number;
  present: number;
  late: number;
  halfDay: number;
  leave: number;
  absent: number;
  /** P + L + half of HD — the school's own report arithmetic. */
  presentDays: number;
  /** null = nothing marked. Never 0 for an unmarked register. */
  percent: number | null;
  /** Newest month first. */
  months: StudentAttendanceMonth[];
  /** Consecutive absent days ending at the most recent marked day. */
  absentStreak: number;
  lastMarkedDate: string;
};

function presentWeight(status: AttendanceStatus): number {
  if (status === "P" || status === "L") return 1;
  if (status === "HD") return 0.5;
  return 0;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Every marked day for one student, newest first, plus the totals.
 *
 * `registers` is the whole desk; filtering by year or window is done here
 * so every caller applies the same "one day counts once" rule.
 */
export function studentAttendanceSummary(
  registers: AttendanceRegister[],
  studentId: string,
  opts?: {
    academicYearCode?: string;
    /** Inclusive YYYY-MM-DD bounds. */
    from?: string;
    to?: string;
  },
): StudentAttendanceSummary {
  const ay = (opts?.academicYearCode || "").trim();
  const byDate = new Map<string, StudentAttendanceDay>();

  for (const reg of registers || []) {
    if (ay && (reg.academicYearCode || "").trim() !== ay) continue;
    const date = (reg.date || "").trim();
    if (!date) continue;
    if (opts?.from && date < opts.from) continue;
    if (opts?.to && date > opts.to) continue;
    const mark: AttendanceMark | undefined = (reg.marks || []).find(
      (m) => m.studentId === studentId,
    );
    if (!mark) continue;

    const candidate: StudentAttendanceDay = {
      date,
      status: mark.status,
      note: mark.note || "",
      classId: reg.classId || "",
      sectionId: reg.sectionId || "",
      markedAt: reg.markedAt || "",
    };
    const held = byDate.get(date);
    // Two registers for one date — a re-mark, or the child sitting in two
    // sections across a transfer. The one marked later is the truth.
    if (!held || (candidate.markedAt || "") >= (held.markedAt || "")) {
      byDate.set(date, candidate);
    }
  }

  const days = [...byDate.values()].sort((a, b) =>
    b.date.localeCompare(a.date),
  );

  let present = 0;
  let late = 0;
  let halfDay = 0;
  let leave = 0;
  let absent = 0;
  let presentDays = 0;
  const monthAcc = new Map<
    string,
    { marked: number; presentDays: number; absent: number }
  >();

  for (const d of days) {
    if (d.status === "P") present += 1;
    else if (d.status === "L") late += 1;
    else if (d.status === "HD") halfDay += 1;
    else if (d.status === "LE") leave += 1;
    else if (d.status === "A") absent += 1;
    presentDays += presentWeight(d.status);

    const key = d.date.slice(0, 7);
    const m = monthAcc.get(key) ?? { marked: 0, presentDays: 0, absent: 0 };
    m.marked += 1;
    m.presentDays += presentWeight(d.status);
    if (d.status === "A") m.absent += 1;
    monthAcc.set(key, m);
  }

  const marked = days.length;
  const months: StudentAttendanceMonth[] = [...monthAcc.entries()]
    .map(([month, m]) => ({
      month,
      marked: m.marked,
      presentDays: round1(m.presentDays),
      absent: m.absent,
      percent: m.marked > 0 ? round1((m.presentDays / m.marked) * 100) : null,
    }))
    .sort((a, b) => b.month.localeCompare(a.month));

  let absentStreak = 0;
  for (const d of days) {
    if (d.status !== "A") break;
    absentStreak += 1;
  }

  return {
    days,
    marked,
    present,
    late,
    halfDay,
    leave,
    absent,
    presentDays: round1(presentDays),
    percent: marked > 0 ? round1((presentDays / marked) * 100) : null,
    months,
    absentStreak,
    lastMarkedDate: days[0]?.date || "",
  };
}

/** "92.9% · 104 of 112 days" — or why there is no number. */
export function attendancePercentText(s: StudentAttendanceSummary): string {
  if (s.percent === null) return "Not marked yet";
  return `${s.percent}% · ${s.presentDays} of ${s.marked} days`;
}

/** Month key to something the office reads: "2026-09" → "Sep 2026". */
export function attendanceMonthLabel(month: string): string {
  const [y, m] = month.split("-");
  const names = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const idx = Number(m) - 1;
  if (!y || !names[idx]) return month;
  return `${names[idx]} ${y}`;
}
