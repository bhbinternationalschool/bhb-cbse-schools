/**
 * One member of staff's month, day by day — the calendar on "My pay &
 * attendance". Pure, and deliberately the SAME order of rules as
 * buildPayrollDraft (lib/payroll.ts), so what the calendar shows is what
 * payroll will count: holiday → the register's mark → (no mark) exempt /
 * future / approved leave / otherwise ABSENT.
 * Self-tested in staffMonthCalendar.selftest.ts.
 */

export type CalendarDayKind =
  | "present"
  | "late"
  | "half_day"
  | "absent"
  | "leave"
  | "holiday"
  | "unpaid_holiday"
  | "not_marked"
  | "exempt"
  | "future";

export type CalendarDay = {
  date: string;
  kind: CalendarDayKind;
  label: string;
  inTime?: string;
  outTime?: string;
  way?: string;
};

export type CalendarCounts = {
  present: number;
  late: number;
  halfDay: number;
  absent: number;
  notMarked: number;
  leave: number;
  holidays: number;
  /** What payroll counts as loss of pay days (absent + not marked + ½ per half day). */
  lwpDays: number;
};

type MarkLike = { status: string; inTime?: string; outTime?: string; punchWay?: string; note?: string };

export function daysOfMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return [];
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

export function staffMonthCalendar(opts: {
  month: string;
  today: string;
  markOn: (date: string) => MarkLike | null;
  holidayOn: (date: string) => { status: "working" | "holiday" | "half_holiday"; label: string; paidForStaff: boolean };
  approvedLeaveOn: (date: string) => boolean;
  surveyOn?: (date: string) => boolean;
  exempt: boolean;
  wayLabel?: (way: string) => string;
}): { days: CalendarDay[]; counts: CalendarCounts } {
  const counts: CalendarCounts = {
    present: 0, late: 0, halfDay: 0, absent: 0, notMarked: 0, leave: 0, holidays: 0, lwpDays: 0,
  };
  const days: CalendarDay[] = [];
  for (const date of daysOfMonth(opts.month)) {
    const hol = opts.holidayOn(date);
    if (hol.status === "holiday") {
      if (hol.paidForStaff) {
        counts.holidays += 1;
        days.push({ date, kind: "holiday", label: hol.label || "Holiday" });
      } else {
        counts.absent += 1;
        counts.lwpDays += 1;
        days.push({ date, kind: "unpaid_holiday", label: `${hol.label || "Holiday"} (unpaid)` });
      }
      continue;
    }
    const mark = opts.markOn(date);
    if (mark) {
      const base = {
        date,
        inTime: mark.inTime || undefined,
        outTime: mark.outTime || undefined,
        way: mark.punchWay ? opts.wayLabel?.(mark.punchWay) ?? mark.punchWay : undefined,
      };
      if (mark.status === "A" && opts.surveyOn?.(date)) {
        counts.present += 1;
        days.push({ ...base, kind: "present", label: "Present (field survey)" });
      } else if (mark.status === "P") {
        counts.present += 1;
        days.push({ ...base, kind: "present", label: "Present" });
      } else if (mark.status === "L") {
        counts.present += 1;
        counts.late += 1;
        days.push({ ...base, kind: "late", label: "Late" });
      } else if (mark.status === "HD") {
        counts.halfDay += 1;
        counts.lwpDays += 0.5;
        days.push({ ...base, kind: "half_day", label: "Half day" });
      } else if (mark.status === "LE") {
        counts.leave += 1;
        days.push({ ...base, kind: "leave", label: mark.note || "Leave" });
      } else if (mark.status === "A") {
        counts.absent += 1;
        counts.lwpDays += 1;
        days.push({ ...base, kind: "absent", label: mark.note || "Absent" });
      } else {
        counts.present += 1;
        days.push({ ...base, kind: "present", label: "Present" });
      }
      continue;
    }
    if (opts.exempt) {
      counts.present += 1;
      days.push({ date, kind: "exempt", label: "Keeps no attendance" });
    } else if (opts.surveyOn?.(date)) {
      counts.present += 1;
      days.push({ date, kind: "present", label: "Present (field survey)" });
    } else if (date > opts.today) {
      days.push({ date, kind: "future", label: "" });
    } else if (opts.approvedLeaveOn(date)) {
      counts.leave += 1;
      days.push({ date, kind: "leave", label: "Approved leave" });
    } else {
      counts.notMarked += 1;
      counts.lwpDays += 1;
      days.push({ date, kind: "not_marked", label: "Not marked — counts as absent" });
    }
  }
  return { days, counts };
}
