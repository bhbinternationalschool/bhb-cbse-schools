/**
 * Staff attendance — the month register and the month's leave (director,
 * 15 Oct 2026).
 *
 * "Staff attendance report in a month register view": staff down, the days
 * of the month across, each cell the day's mark as the register holds it,
 * per-staff totals at the end. Plus the month's leave: each approved leave
 * that falls in the month, and every balance as it stood at month end.
 *
 * Pure: the route (app/api/v1/attendance/staff-month) reads the month's
 * registers, the HR desk and Masters from the database and hands them here;
 * the screen and the exports only lay the answer out.
 *
 * The marks are the shared attendance codes, spelled out for staff:
 *   P present · A absent · L LATE (present, came late — never "leave")
 *   HD half day · LE on leave (the leave type is shown in the cell: CL, ML…)
 * A day with no saved mark is blank and counted "unmarked"; when an approved
 * leave covers it, the leave is shown (and counted as leave) — the same
 * overlay the day register applies when it opens a date.
 */

import type { AttendanceStatus } from "@/lib/attendance";
import type { StaffRecord } from "@/lib/foundationMasters";
import { classifyStaffHolidayDay } from "@/lib/holidayPolicy";
import type { MastersState } from "@/lib/masters";
import {
  HALF_DAY_LEAVE_NOTE,
  type StaffAttendanceMark,
  type StaffAttendanceRegister,
} from "@/lib/staffAttendance";
import type { LeaveBalance, LeaveEncashment, LeaveRequest, LeaveType } from "@/lib/staffHr";
import { sessionEndFor, sessionStartFor } from "@/lib/studentWorkingDays";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const STATUSES: AttendanceStatus[] = ["P", "A", "L", "HD", "LE"];

export const STAFF_MARK_LABEL: Record<AttendanceStatus, string> = {
  P: "Present",
  A: "Absent",
  L: "Late",
  HD: "Half day",
  LE: "On leave",
};

export type StaffDaySide = {
  /** A holiday (or Sunday) for this stream: shaded, not a working day. */
  off: boolean;
  /** "Sunday", "Diwali", "Working day", "Holi (half day)". */
  label: string;
};

export type StaffMonthDay = {
  date: string;
  /** 0 = Sunday. */
  weekday: number;
  /** After today (IST): nothing to count yet. */
  future: boolean;
  teaching: StaffDaySide;
  nonTeaching: StaffDaySide;
};

export type StaffMonthCell = {
  /** The saved mark; "" = none saved. */
  s: AttendanceStatus | "";
  /** The leave type (CL, ML, LWP…) for LE, or for a half-day leave. */
  leaveType?: string;
  inTime?: string;
  outTime?: string;
  /** How it was marked: self, QR, WhatsApp GPS, direct … (punchWay code). */
  way?: string;
  note?: string;
  /** Not saved on the register: an approved leave covers the day. */
  fromLeave?: boolean;
  /** Worked on a holiday / Sunday for this person's stream. */
  extra?: boolean;
  /** Before joining or after leaving. */
  outside?: boolean;
};

export type StaffMonthTotals = {
  /** Working days so far this month (today included), inside the person's service. */
  working: number;
  /** P + L + ½ HD. */
  present: number;
  P: number;
  L: number;
  HD: number;
  A: number;
  LE: number;
  /** Leave days by type (a half-day leave counts ½). */
  leaveByType: Record<string, number>;
  /** Days worked on a holiday or Sunday (½ for a half day). */
  extra: number;
  /** Working days with no mark and no approved leave. */
  unmarked: number;
};

export type StaffMonthRow = {
  id: string;
  empCode: string;
  name: string;
  designation: string;
  stream: "teaching" | "non_teaching";
  cells: Record<string, StaffMonthCell>;
  totals: StaffMonthTotals;
};

export type StaffLeaveRow = {
  id: string;
  staffId: string;
  empCode: string;
  name: string;
  typeCode: string;
  typeName: string;
  fromDate: string;
  toDate: string;
  /** Days of this leave that fall in the month (½ for a half day). */
  daysInMonth: number;
  /** The whole leave, as filed. */
  days: number;
  halfDay: boolean;
  halfDaySession: string;
  /** Who approved it (or entered it directly), and when. */
  approvedBy: string;
  approvedAt: string;
  /** request = applied and approved; direct = entered by the office / register; adjusted. */
  origin: string;
  reason: string;
};

export type StaffLeaveBalanceCell = {
  allotted: number;
  carriedForward: number;
  encashed: number;
  /** Approved days up to and including month end, this session. */
  usedToMonthEnd: number;
  /** allotted + carried − encashed − used (never below 0). */
  balance: number;
  /** Days of this type taken in the month itself. */
  inMonth: number;
};

export type StaffLeaveBalanceRow = {
  staffId: string;
  empCode: string;
  name: string;
  byType: Record<string, StaffLeaveBalanceCell>;
};

export type StaffMonthView = {
  academicYearCode: string;
  month: string;
  today: string;
  /** First and last day shown (the month cut to the session). */
  from: string;
  to: string;
  days: StaffMonthDay[];
  staff: StaffMonthRow[];
  leaveTypes: { code: string; name: string; paid: boolean }[];
  leaves: StaffLeaveRow[];
  balances: StaffLeaveBalanceRow[];
};

/** The session's months up to (and including) the current one, newest first. */
export function staffSessionMonths(masters: Pick<MastersState, "academicYears">, ay: string, today: string): string[] {
  const start = sessionStartFor(masters, ay).slice(0, 7);
  const end = [sessionEndFor(masters, ay), today].sort()[0]!.slice(0, 7);
  const out: string[] = [];
  let [y, m] = start.split("-").map(Number) as [number, number];
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

function monthDates(from: string, to: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (cur <= end && out.length < 32) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function side(masters: MastersState, date: string, ay: string, stream: "teaching" | "non_teaching", weekday: number): StaffDaySide {
  const c = classifyStaffHolidayDay(masters, date, ay, stream);
  if (c.status === "holiday") return { off: true, label: c.label };
  // Sundays are off even where Masters has no "every Sunday" rule; a
  // working-day override in Masters (c.holiday set) still makes one working.
  if (weekday === 0 && c.status === "working" && !c.holiday) return { off: true, label: "Sunday" };
  return { off: false, label: c.label };
}

/** "On leave (CL)", "Half-day leave (ML, morning off) · …" → the type code. */
export function leaveTypeFromNote(note: string | undefined): string {
  const m = /\(([A-Za-z]{1,6})[,)]/.exec(note || "");
  return m ? m[1]!.toUpperCase() : "";
}

function round(n: number): number {
  return Math.round(n * 2) / 2;
}

/** Calendar days of [from, to] that fall in [a, b]. */
function overlapDays(from: string, to: string, a: string, b: string): number {
  const lo = from > a ? from : a;
  const hi = to < b ? to : b;
  if (lo > hi) return 0;
  return monthDates(lo, hi).length || 0;
}

function approvedOn(leaves: LeaveRequest[], staffId: string, date: string): LeaveRequest | null {
  return leaves.find((r) => r.staffId === staffId && r.fromDate <= date && r.toDate >= date) ?? null;
}

export function buildStaffMonthView(input: {
  masters: MastersState;
  ay: string;
  month: string;
  today: string;
  /** The registers of this month (any order; other dates are ignored). */
  registers: StaffAttendanceRegister[];
  /** Everyone who keeps attendance: the roster minus the exempt (owner etc.). */
  staff: StaffRecord[];
  /** Only these people (a teacher sees their own row); undefined = everyone. */
  onlyStaffIds?: Set<string>;
  leaveTypes: LeaveType[];
  leaveRequests: LeaveRequest[];
  leaveBalances: LeaveBalance[];
  leaveEncashments: LeaveEncashment[];
  /** Overlay approved leave on days with no saved mark (settings.syncLeaveToAttendance). */
  overlayLeave: boolean;
}): StaffMonthView | { error: string } {
  const { masters, ay, month, today } = input;
  if (!MONTH.test(month)) return { error: "Month must be YYYY-MM" };
  const [y, mo] = month.split("-").map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const monthFrom = `${month}-01`;
  const monthTo = `${month}-${String(lastDay).padStart(2, "0")}`;
  const from = [monthFrom, sessionStartFor(masters, ay)].sort()[1]!;
  const to = [monthTo, sessionEndFor(masters, ay)].sort()[0]!;
  if (from > to) return { error: "That month is not in this session" };

  const days: StaffMonthDay[] = monthDates(from, to).map((date) => {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    return {
      date,
      weekday,
      future: date > today,
      teaching: side(masters, date, ay, "teaching", weekday),
      nonTeaching: side(masters, date, ay, "non_teaching", weekday),
    };
  });

  // date → staffId → mark (the register for this session's date).
  const byDate = new Map<string, Map<string, StaffAttendanceMark>>();
  for (const r of input.registers) {
    if (r.academicYearCode !== ay || r.date < from || r.date > to) continue;
    const m = byDate.get(r.date) ?? new Map<string, StaffAttendanceMark>();
    for (const mk of r.marks ?? []) m.set(mk.staffId, mk);
    byDate.set(r.date, m);
  }
  const markedIds = new Set<string>();
  for (const m of byDate.values()) for (const id of m.keys()) markedIds.add(id);

  const approved = input.leaveRequests.filter((r) => r.status === "approved" && r.academicYearCode === ay);
  const designation = new Map((masters.designations ?? []).map((d) => [d.id, d.name]));

  // Who is on the month register: everyone keeping attendance who was in
  // service during the month (visiting staff only if they punched), and
  // anyone who has a mark this month even if they have left since.
  const people = input.staff
    .filter((s) => !input.onlyStaffIds || input.onlyStaffIds.has(s.id))
    .filter((s) => {
      if (markedIds.has(s.id)) return true;
      if (s.category === "visiting") return false;
      if (s.status !== "active") return false;
      const joined = (s.joiningDate || "").slice(0, 10);
      if (joined && joined > to) return false;
      return true;
    })
    .sort((a, z) => a.empCode.localeCompare(z.empCode, undefined, { numeric: true }) || a.fullName.localeCompare(z.fullName));

  const rows: StaffMonthRow[] = people.map((s) => {
    const stream: "teaching" | "non_teaching" = s.stream === "non_teaching" ? "non_teaching" : "teaching";
    const joined = (s.joiningDate || "").slice(0, 10);
    const left = (s.leavingDate || "").slice(0, 10);
    const totals: StaffMonthTotals = { working: 0, present: 0, P: 0, L: 0, HD: 0, A: 0, LE: 0, leaveByType: {}, extra: 0, unmarked: 0 };
    const addLeave = (type: string, n: number) => {
      const k = type || "—";
      totals.leaveByType[k] = round((totals.leaveByType[k] ?? 0) + n);
    };
    const cells: Record<string, StaffMonthCell> = {};
    for (const d of days) {
      const mark = byDate.get(d.date)?.get(s.id);
      const outside = (!!joined && d.date < joined) || (!!left && d.date > left);
      const off = (stream === "teaching" ? d.teaching : d.nonTeaching).off;
      const status = mark && STATUSES.includes(mark.status) ? mark.status : "";
      const cell: StaffMonthCell = { s: status };
      if (mark) {
        if (mark.inTime) cell.inTime = mark.inTime;
        if (mark.outTime) cell.outTime = mark.outTime;
        if (mark.punchWay) cell.way = mark.punchWay;
        if (mark.note) cell.note = mark.note;
      }
      const halfLeave = !!mark && (mark.note || "").startsWith(HALF_DAY_LEAVE_NOTE);
      const leave = approvedOn(approved, s.id, d.date);
      if (status === "LE" || halfLeave) {
        cell.leaveType = leave?.typeCode || leaveTypeFromNote(mark?.note);
      }
      if (outside && !status) {
        cell.outside = true;
        cells[d.date] = cell;
        continue;
      }
      if (d.future) {
        cells[d.date] = cell;
        continue;
      }
      if (off) {
        if (status === "P" || status === "L" || status === "HD") {
          cell.extra = true;
          totals.extra = round(totals.extra + (status === "HD" ? 0.5 : 1));
        }
        cells[d.date] = cell;
        continue;
      }
      totals.working += 1;
      if (!status && leave && input.overlayLeave) {
        cell.fromLeave = true;
        cell.leaveType = leave.typeCode;
        if (leave.halfDay) {
          // Half-day leave and no punch for the other half: absent for that half.
          cell.s = "";
          totals.unmarked += 1;
          addLeave(leave.typeCode, 0.5);
        } else {
          cell.s = "LE";
          totals.LE += 1;
          addLeave(leave.typeCode, 1);
        }
        cells[d.date] = cell;
        continue;
      }
      switch (status) {
        case "P":
          totals.P += 1;
          totals.present += 1;
          break;
        case "L":
          totals.L += 1;
          totals.present += 1;
          break;
        case "HD":
          totals.HD += 1;
          totals.present += 0.5;
          if (halfLeave) addLeave(cell.leaveType || "", 0.5);
          break;
        case "A":
          totals.A += 1;
          if (halfLeave) addLeave(cell.leaveType || "", 0.5);
          break;
        case "LE":
          totals.LE += 1;
          addLeave(cell.leaveType || "", 1);
          break;
        default:
          totals.unmarked += 1;
      }
      cells[d.date] = cell;
    }
    totals.present = round(totals.present);
    return {
      id: s.id,
      empCode: s.empCode,
      name: s.fullName,
      designation: designation.get(s.designationId || "") || "",
      stream,
      cells,
      totals,
    };
  });

  const shown = new Map(rows.map((r) => [r.id, r]));
  const typeName = new Map(input.leaveTypes.map((t) => [t.code, t.name]));

  const leaves: StaffLeaveRow[] = approved
    .filter((r) => shown.has(r.staffId) && r.fromDate <= to && r.toDate >= from)
    .map((r) => {
      const row = shown.get(r.staffId)!;
      const inMonth = r.halfDay ? (r.fromDate >= from && r.fromDate <= to ? 0.5 : 0) : overlapDays(r.fromDate, r.toDate, from, to);
      return {
        id: r.id,
        staffId: r.staffId,
        empCode: row.empCode,
        name: row.name,
        typeCode: r.typeCode,
        typeName: typeName.get(r.typeCode) || r.typeCode,
        fromDate: r.fromDate,
        toDate: r.toDate,
        daysInMonth: inMonth,
        days: r.days,
        halfDay: !!r.halfDay,
        halfDaySession: r.halfDaySession || "",
        approvedBy: r.decidedBy || r.level1By || r.appliedBy || "",
        approvedAt: (r.decidedAt || r.appliedAt || "").slice(0, 10),
        origin: r.origin,
        reason: r.reason,
      };
    })
    .filter((r) => r.daysInMonth > 0)
    .sort((a, z) => a.empCode.localeCompare(z.empCode, undefined, { numeric: true }) || a.fromDate.localeCompare(z.fromDate));

  const balances: StaffLeaveBalanceRow[] = rows.map((row) => {
    const byType: Record<string, StaffLeaveBalanceCell> = {};
    for (const t of input.leaveTypes) {
      const b = input.leaveBalances.find((x) => x.staffId === row.id && x.typeCode === t.code && x.academicYearCode === ay);
      const enc = input.leaveEncashments
        .filter((e) => e.staffId === row.id && e.typeCode === t.code && e.academicYearCode === ay)
        .reduce((n, e) => n + (Number(e.days) || 0), 0);
      const mine = approved.filter((r) => r.staffId === row.id && r.typeCode === t.code);
      const used = mine.reduce((n, r) => {
        if (r.halfDay) return n + (r.fromDate <= to ? 0.5 : 0);
        return n + overlapDays(r.fromDate, r.toDate, "0000-01-01", to);
      }, 0);
      const inMonth = mine.reduce((n, r) => {
        if (r.halfDay) return n + (r.fromDate >= from && r.fromDate <= to ? 0.5 : 0);
        return n + overlapDays(r.fromDate, r.toDate, from, to);
      }, 0);
      const allotted = b ? Number(b.allotted) || 0 : t.defaultDaysPerYear;
      const carriedForward = b ? Number(b.carriedForward) || 0 : 0;
      const encashed = b ? Math.max(Number(b.encashed) || 0, enc) : enc;
      byType[t.code] = {
        allotted,
        carriedForward,
        encashed,
        usedToMonthEnd: round(used),
        balance: Math.max(0, round(allotted + carriedForward - encashed - used)),
        inMonth: round(inMonth),
      };
    }
    return { staffId: row.id, empCode: row.empCode, name: row.name, byType };
  });

  return {
    academicYearCode: ay,
    month,
    today,
    from,
    to,
    days,
    staff: rows,
    leaveTypes: input.leaveTypes.map((t) => ({ code: t.code, name: t.name, paid: !!t.paid })),
    leaves,
    balances,
  };
}

/* ─── What a cell shows ─────────────────────────────────────────── */

/** The short text in a register cell: P / A / L / HD / the leave type / blank. */
export function staffCellText(c: StaffMonthCell | undefined): string {
  if (!c) return "";
  if (c.outside) return "–";
  if (c.s === "LE") return c.leaveType || "LE";
  if (c.s === "" && c.fromLeave && c.leaveType) return `½${c.leaveType}`;
  return c.s;
}

/* ─── Exports (Excel / CSV / PDF) ───────────────────────────────── */

export type StaffExportColumn = { key: string; header: string; width?: number; align?: "left" | "right" };
export type StaffExportRow = Record<string, string | number | null>;

const WD = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/**
 * The month register as a sheet: one row per member of staff in the order
 * the screen shows, one column per day — the mark, the leave type for leave,
 * "H" on their stream's holiday (with the mark if they worked it), "–"
 * outside their service — then the totals.
 */
export function staffMonthRegisterExport(view: Pick<StaffMonthView, "days" | "staff" | "leaveTypes">, rows: StaffMonthRow[] = view.staff): {
  columns: StaffExportColumn[];
  rows: StaffExportRow[];
} {
  const dayKey = (d: StaffMonthDay) => `d${d.date.slice(8)}`;
  const typeCodes = leaveTypeCodes(view);
  const columns: StaffExportColumn[] = [
    { key: "empCode", header: "Emp code", width: 0.9 },
    { key: "name", header: "Staff", width: 2.4 },
    { key: "designation", header: "Designation", width: 1.4 },
    ...view.days.map((d) => ({
      key: dayKey(d),
      header: `${Number(d.date.slice(8))} ${d.teaching.off && d.nonTeaching.off ? "H" : WD[d.weekday]}`,
      width: 0.45,
    })),
    { key: "working", header: "Working", width: 0.8, align: "right" as const },
    { key: "present", header: "Present", width: 0.8, align: "right" as const },
    { key: "late", header: "Late", width: 0.6, align: "right" as const },
    { key: "half", header: "Half day", width: 0.7, align: "right" as const },
    { key: "absent", header: "Absent", width: 0.7, align: "right" as const },
    ...typeCodes.map((c) => ({ key: `lv_${c}`, header: `Leave ${c}`, width: 0.7, align: "right" as const })),
    { key: "extra", header: "Extra days", width: 0.8, align: "right" as const },
    { key: "unmarked", header: "Unmarked", width: 0.8, align: "right" as const },
  ];
  const out: StaffExportRow[] = rows.map((r) => {
    const row: StaffExportRow = { empCode: r.empCode, name: r.name, designation: r.designation };
    for (const d of view.days) {
      const off = (r.stream === "teaching" ? d.teaching : d.nonTeaching).off;
      const text = staffCellText(r.cells[d.date]);
      row[dayKey(d)] = off ? (text ? `H/${text}` : "H") : text;
    }
    row.working = r.totals.working;
    row.present = r.totals.present;
    row.late = r.totals.L;
    row.half = r.totals.HD;
    row.absent = r.totals.A;
    for (const c of typeCodes) row[`lv_${c}`] = r.totals.leaveByType[c] ?? 0;
    row.extra = r.totals.extra;
    row.unmarked = r.totals.unmarked;
    return row;
  });
  return { columns, rows: out };
}

/** The leave types to show: the configured ones, plus any found on the marks. */
export function leaveTypeCodes(view: Pick<StaffMonthView, "staff" | "leaveTypes">): string[] {
  const codes = view.leaveTypes.map((t) => t.code);
  for (const r of view.staff) for (const k of Object.keys(r.totals.leaveByType)) if (!codes.includes(k)) codes.push(k);
  return codes;
}

/** The month's leave as a sheet: each leave, then nothing else (balances are their own sheet). */
export function staffLeaveMonthExport(view: Pick<StaffMonthView, "leaves">): { columns: StaffExportColumn[]; rows: StaffExportRow[] } {
  return {
    columns: [
      { key: "empCode", header: "Emp code", width: 0.9 },
      { key: "name", header: "Staff", width: 2.2 },
      { key: "type", header: "Leave type", width: 1.4 },
      { key: "from", header: "From", width: 1 },
      { key: "to", header: "To", width: 1 },
      { key: "daysInMonth", header: "Days this month", width: 0.9, align: "right" },
      { key: "days", header: "Days (whole leave)", width: 0.9, align: "right" },
      { key: "approvedBy", header: "Approved by", width: 1.5 },
      { key: "approvedAt", header: "Approved on", width: 1 },
      { key: "reason", header: "Reason", width: 2.2 },
    ],
    rows: view.leaves.map((l) => ({
      empCode: l.empCode,
      name: l.name,
      type: `${l.typeCode}${l.halfDay ? ` (half day${l.halfDaySession ? `, ${l.halfDaySession} off` : ""})` : ""}`,
      from: l.fromDate,
      to: l.toDate,
      daysInMonth: l.daysInMonth,
      days: l.days,
      approvedBy: l.approvedBy,
      approvedAt: l.approvedAt,
      reason: l.reason,
    })),
  };
}

/** Balances at month end: per staff, per type — taken this month, used to date, balance. */
export function staffLeaveBalanceExport(view: Pick<StaffMonthView, "balances" | "leaveTypes">): { columns: StaffExportColumn[]; rows: StaffExportRow[] } {
  const codes = view.leaveTypes.map((t) => t.code);
  return {
    columns: [
      { key: "empCode", header: "Emp code", width: 0.9 },
      { key: "name", header: "Staff", width: 2.2 },
      ...codes.flatMap((c) => [
        { key: `${c}_month`, header: `${c} this month`, width: 0.8, align: "right" as const },
        { key: `${c}_used`, header: `${c} used to date`, width: 0.8, align: "right" as const },
        { key: `${c}_bal`, header: `${c} balance`, width: 0.8, align: "right" as const },
      ]),
    ],
    rows: view.balances.map((b) => {
      const row: StaffExportRow = { empCode: b.empCode, name: b.name };
      for (const c of codes) {
        const x = b.byType[c];
        row[`${c}_month`] = x?.inMonth ?? 0;
        row[`${c}_used`] = x?.usedToMonthEnd ?? 0;
        row[`${c}_bal`] = x?.balance ?? 0;
      }
      return row;
    }),
  };
}
