/**
 * The month register (director, 8 Oct 2026): a class teacher fills a whole
 * month of attendance — every child, every working day — on one register
 * table and saves it at once, including back-dated days.
 *
 * Pure: buildMonthView lays the month out; planMonthSave turns the edited
 * cells into one register write per day, refusing what must not be written.
 * The route does the reading and writing (app/api/v1/attendance/month).
 */

import type { AttendanceMark, AttendanceRegister, AttendanceStatus } from "@/lib/attendance";
import type { MastersState } from "@/lib/masters";
import type { SisStudent } from "@/lib/sis";
import {
  attendanceStartFor,
  classCalendar,
  marksByDateFor,
  sessionEndFor,
  sessionStartFor,
  studentDaysSummary,
  type ClassDay,
  type StudentDaysSummary,
} from "@/lib/studentWorkingDays";

export const MONTH_STATUSES: AttendanceStatus[] = ["P", "A", "L", "HD", "LE"];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export type MonthDay = ClassDay & {
  /** After today (IST) — nothing can be marked yet. */
  future: boolean;
};

export type MonthStudent = {
  id: string;
  name: string;
  rollNo: string;
  admissionNo: string;
  joinedOn: string;
  /** First markable day: the day after admission, or the session start. */
  startsOn: string;
  /** date → status for this month. */
  marks: Record<string, AttendanceStatus>;
  month: Pick<StudentDaysSummary, "workingDays" | "presentDays" | "unmarkedDays" | "percent">;
  session: Pick<StudentDaysSummary, "workingDays" | "presentDays" | "unmarkedDays" | "percent">;
};

export type MonthView = {
  month: string;
  /** The month's days inside the session. */
  days: MonthDay[];
  students: MonthStudent[];
};

/** The session's months up to (and including) the current one, newest first. */
export function sessionMonths(masters: MastersState, ay: string, today: string): string[] {
  const start = sessionStartFor(masters, ay).slice(0, 7);
  const end = [sessionEndFor(masters, ay), today].sort()[0].slice(0, 7);
  const out: string[] = [];
  let [y, m] = start.split("-").map(Number);
  for (let guard = 0; guard < 24; guard++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key > end) break;
    out.push(key);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out.reverse();
}

function monthBounds(month: string, masters: MastersState, ay: string): { from: string; to: string } | null {
  if (!MONTH.test(month)) return null;
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const from = [`${month}-01`, sessionStartFor(masters, ay)].sort()[1];
  const to = [`${month}-${String(last).padStart(2, "0")}`, sessionEndFor(masters, ay)].sort()[0];
  return from <= to ? { from, to } : null;
}

const pick = (s: StudentDaysSummary) => ({
  workingDays: s.workingDays,
  presentDays: s.presentDays,
  unmarkedDays: s.unmarkedDays,
  percent: s.percent,
});

export function buildMonthView(input: {
  masters: MastersState;
  ay: string;
  classId: string;
  month: string;
  students: SisStudent[];
  registers: AttendanceRegister[];
  today: string;
}): MonthView | { error: string } {
  const b = monthBounds(input.month, input.masters, input.ay);
  if (!b) return { error: "That month is not in this session" };
  const sessionStart = sessionStartFor(input.masters, input.ay);
  const calendar = classCalendar(input.masters, input.ay, input.classId, b.from, b.to);
  const sessionCal = classCalendar(input.masters, input.ay, input.classId, sessionStart, [input.today, sessionEndFor(input.masters, input.ay)].sort()[0]);
  const days: MonthDay[] = calendar.map((d) => ({ ...d, future: d.date > input.today }));
  const sorted = [...input.students].sort(
    (a, z) =>
      (Number(a.rollNo) || 9999) - (Number(z.rollNo) || 9999) ||
      a.fullName.localeCompare(z.fullName),
  );
  const students = sorted.map((s): MonthStudent => {
    const byDate = marksByDateFor(input.registers, s.id, input.ay);
    const startsOn = attendanceStartFor(s.joinedOn, sessionStart);
    const marks: Record<string, AttendanceStatus> = {};
    for (const d of calendar) {
      const st = byDate.get(d.date);
      if (st) marks[d.date] = st;
    }
    const monthUntil = [b.to, input.today].sort()[0];
    return {
      id: s.id,
      name: s.fullName,
      rollNo: s.rollNo || "",
      admissionNo: s.admissionNo || "",
      joinedOn: s.joinedOn || "",
      startsOn,
      marks,
      month: pick(studentDaysSummary({ calendar, start: startsOn, until: monthUntil, marks: byDate })),
      session: pick(studentDaysSummary({ calendar: sessionCal, start: startsOn, until: input.today, marks: byDate })),
    };
  });
  return { month: input.month, days, students };
}

export type MonthSaveDay = {
  date: string;
  /** Status per student; "" clears that child's mark for the day. */
  marks: { studentId: string; status: AttendanceStatus | "" }[];
};

export type PlannedDay = { date: string; marks: AttendanceMark[] };

/**
 * One full register per day to write, merged over what is already saved
 * (a child not in the request keeps their mark). Refused, per day: outside
 * this month or session, after today, a holiday for this class. Refused,
 * per mark: a child not in this section, a day before the child's start, an
 * unknown status. Every refusal is reported — none is silently written.
 */
export function planMonthSave(input: {
  masters: MastersState;
  ay: string;
  classId: string;
  sectionId: string;
  month: string;
  students: Pick<SisStudent, "id" | "joinedOn" | "fullName">[];
  registers: AttendanceRegister[];
  days: MonthSaveDay[];
  today: string;
}): { plan: PlannedDay[]; refused: string[] } {
  const refused: string[] = [];
  const plan: PlannedDay[] = [];
  const b = monthBounds(input.month, input.masters, input.ay);
  if (!b) return { plan, refused: ["That month is not in this session"] };
  const sessionStart = sessionStartFor(input.masters, input.ay);
  const byId = new Map(input.students.map((s) => [s.id, s]));
  const calendar = new Map(classCalendar(input.masters, input.ay, input.classId, b.from, b.to).map((d) => [d.date, d]));
  const seen = new Set<string>();
  for (const day of input.days) {
    const date = (day.date || "").slice(0, 10);
    if (seen.has(date)) continue;
    seen.add(date);
    const cal = calendar.get(date);
    if (!cal) {
      refused.push(`${date}: not in ${input.month} of this session`);
      continue;
    }
    if (date > input.today) {
      refused.push(`${date}: in the future`);
      continue;
    }
    if (!cal.working) {
      refused.push(`${date}: holiday (${cal.label || "school closed"})`);
      continue;
    }
    const existing = input.registers.find(
      (r) => r.academicYearCode === input.ay && r.sectionId === input.sectionId && r.date === date,
    );
    const merged = new Map<string, AttendanceMark>((existing?.marks ?? []).map((m) => [m.studentId, m]));
    let changed = false;
    for (const m of day.marks) {
      const stu = byId.get(m.studentId);
      if (!stu) {
        refused.push(`${date}: a child not in this section`);
        continue;
      }
      if (m.status !== "" && !MONTH_STATUSES.includes(m.status)) {
        refused.push(`${date}: unknown mark for ${stu.fullName}`);
        continue;
      }
      if (date < attendanceStartFor(stu.joinedOn, sessionStart)) {
        if (m.status !== "") refused.push(`${date}: ${stu.fullName} was not admitted yet`);
        continue;
      }
      const prev = merged.get(m.studentId);
      if (m.status === "") {
        if (prev) {
          merged.delete(m.studentId);
          changed = true;
        }
        continue;
      }
      if (prev?.status !== m.status) changed = true;
      merged.set(m.studentId, { studentId: m.studentId, status: m.status, note: prev?.note ?? "" });
    }
    if (!changed) continue;
    if (merged.size === 0) {
      refused.push(`${date}: every mark cleared — a register cannot be empty, so it was left as it was`);
      continue;
    }
    plan.push({ date, marks: [...merged.values()] });
  }
  plan.sort((a, z) => a.date.localeCompare(z.date));
  return { plan, refused };
}
