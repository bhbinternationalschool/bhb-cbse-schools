/**
 * Working days and present days for a student, the way the school counts
 * them (director, 8 Oct 2026):
 *  - a WORKING day is any day the Masters holiday calendar leaves open for
 *    the student's class — Sundays, the pre-primary Saturday off and every
 *    published holiday are not; a half holiday still is;
 *  - a student is counted from the working day AFTER their admission date
 *    (`joinedOn`), and never before the session starts;
 *  - present = P and L count 1, HD counts ½ (the same weights as every
 *    other attendance figure in the ERP).
 *
 * Until this, report cards divided by "days a register was marked", so a
 * class whose teacher skipped a week showed 100% for a child who was never
 * there, and a child admitted in August was counted absent for April.
 * Pure — callers pass masters and registers.
 */

import type { AttendanceRegister, AttendanceStatus } from "@/lib/attendance";
import { classifyClassHolidayDay } from "@/lib/holidayPolicy";
import type { MastersState } from "@/lib/masters";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Every date from `from` to `to`, inclusive. Empty when the range is backwards. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  if (!ISO.test(from) || !ISO.test(to) || from > to) return out;
  for (let d = from; d <= to; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

/** The session's first day from Masters; 1 April of its first year if Masters has no dates. */
export function sessionStartFor(masters: Pick<MastersState, "academicYears">, ay: string): string {
  const row = (masters.academicYears ?? []).find((y) => y.code === ay);
  const s = (row?.startsOn || "").slice(0, 10);
  return ISO.test(s) ? s : `${ay.slice(0, 4)}-04-01`;
}

/** The session's last day from Masters; 31 March of its second year if Masters has no dates. */
export function sessionEndFor(masters: Pick<MastersState, "academicYears">, ay: string): string {
  const row = (masters.academicYears ?? []).find((y) => y.code === ay);
  const e = (row?.endsOn || "").slice(0, 10);
  return ISO.test(e) ? e : `${Number(ay.slice(0, 4)) + 1}-03-31`;
}

/**
 * The first day a student can be marked: the day after admission, never
 * before the session. An unreadable admission date counts from the session
 * start — unknown is not "admitted today".
 */
export function attendanceStartFor(joinedOn: string | undefined, sessionStart: string): string {
  const j = (joinedOn || "").slice(0, 10);
  if (!ISO.test(j)) return sessionStart;
  const next = addDaysIso(j, 1);
  return next > sessionStart ? next : sessionStart;
}

export type ClassDay = {
  date: string;
  /** Open for this class (a half holiday is still a working day). */
  working: boolean;
  half: boolean;
  /** Why it is not a full working day ("Sunday Holiday", "Diwali"…). */
  label: string;
};

/** The class's calendar over a range, from the Masters holiday rules. */
export function classCalendar(
  masters: MastersState,
  ay: string,
  classId: string,
  from: string,
  to: string,
): ClassDay[] {
  return datesBetween(from, to).map((date) => {
    const c = classifyClassHolidayDay(masters, date, ay, classId);
    return {
      date,
      working: c.status !== "holiday",
      half: c.status === "half_holiday",
      label: c.status === "working" ? "" : c.label,
    };
  });
}

/**
 * One student's mark per date this session — the latest-saved register wins
 * when a child appears on two sections' registers the same day (a section
 * change mid-year).
 */
export function marksByDateFor(
  registers: AttendanceRegister[],
  studentId: string,
  ay: string,
): Map<string, AttendanceStatus> {
  const best = new Map<string, { status: AttendanceStatus; at: string }>();
  for (const r of registers) {
    if (r.academicYearCode !== ay) continue;
    const m = r.marks.find((x) => x.studentId === studentId);
    if (!m) continue;
    const prev = best.get(r.date);
    if (!prev || (r.markedAt || "") >= prev.at) best.set(r.date, { status: m.status, at: r.markedAt || "" });
  }
  return new Map([...best].map(([d, v]) => [d, v.status]));
}

export function presentWeight(status: AttendanceStatus | undefined): number {
  if (status === "P" || status === "L") return 1;
  if (status === "HD") return 0.5;
  return 0;
}

export type StudentDaysSummary = {
  /** Working days from the student's start to `until`. */
  workingDays: number;
  /** P/L = 1, HD = ½, on working days only. */
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  /** Working days nobody marked — shown so a gap is never read as presence. */
  unmarkedDays: number;
  /** presentDays / workingDays, one decimal; null with no working days yet. */
  percent: number | null;
  from: string;
  to: string;
};

/**
 * The summary over the class calendar. Marks on holidays or before the
 * student's start are ignored — they are not working days for this child.
 */
export function studentDaysSummary(input: {
  calendar: ClassDay[];
  start: string;
  until: string;
  marks: Map<string, AttendanceStatus>;
}): StudentDaysSummary {
  let workingDays = 0;
  let presentDays = 0;
  let absentDays = 0;
  let leaveDays = 0;
  let unmarkedDays = 0;
  for (const day of input.calendar) {
    if (!day.working || day.date < input.start || day.date > input.until) continue;
    workingDays += 1;
    const s = input.marks.get(day.date);
    if (!s) unmarkedDays += 1;
    else if (s === "A") absentDays += 1;
    else if (s === "LE") leaveDays += 1;
    presentDays += presentWeight(s);
  }
  return {
    workingDays,
    presentDays,
    absentDays,
    leaveDays,
    unmarkedDays,
    percent: workingDays > 0 ? Math.round((presentDays / workingDays) * 1000) / 10 : null,
    from: input.start,
    to: input.until,
  };
}

/** Session-to-date summary for one student in one class: the usual entry point. */
export function sessionDaysSummary(input: {
  masters: MastersState;
  ay: string;
  classId: string;
  studentId: string;
  joinedOn: string | undefined;
  registers: AttendanceRegister[];
  /** Last day counted (a result date); capped to `today` and the session end. */
  until?: string;
  today: string;
}): StudentDaysSummary {
  const start = attendanceStartFor(input.joinedOn, sessionStartFor(input.masters, input.ay));
  const caps = [input.today, sessionEndFor(input.masters, input.ay), input.until || input.today].filter((d) => ISO.test(d));
  const until = caps.sort()[0];
  return studentDaysSummary({
    calendar: classCalendar(input.masters, input.ay, input.classId, start, until),
    start,
    until,
    marks: marksByDateFor(input.registers, input.studentId, input.ay),
  });
}
