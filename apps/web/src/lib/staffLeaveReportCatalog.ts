/**
 * Staff leave & attendance report catalog — filters + tabular export.
 */

import type { StaffRecord } from "@/lib/foundationMasters";
import {
  loadMasters,
  type MastersState,
} from "@/lib/masters";
import {
  exportFilterReport,
  describeFilters,
  type ReportColumn,
} from "@/lib/reportExport";
import {
  loadStaffAttendance,
  punchWayLabel,
  type StaffAttendanceState,
} from "@/lib/staffAttendance";
import { hoursBetween } from "@/lib/schoolTiming";
import {
  loadStaffHr,
  remainingBalance,
  type LeaveRequest,
  type LeaveStatus,
  type StaffHrState,
} from "@/lib/staffHr";
import { TENANT } from "@/lib/types";

export type StaffLeaveReportFormat = "excel" | "pdf" | "preview";

export type StaffLeaveReportCategory = "leave" | "attendance";

export type StaffLeaveReportId =
  | "staff_on_leave_today"
  | "staff_wise_leave"
  | "month_wise_leave"
  | "staff_wise_month_leave"
  | "leave_type_wise_month"
  | "staff_wise_leave_summary"
  | "staff_wise_leave_adjustment"
  | "monthly_balance_leave"
  | "day_wise_attendance"
  | "staff_wise_attendance"
  | "month_wise_attendance"
  | "extra_day"
  | "outdoor"
  | "staff_absent"
  | "monthly_work_duration";

export type StaffLeaveReportDef = {
  id: StaffLeaveReportId;
  category: StaffLeaveReportCategory;
  label: string;
  hint?: string;
  /** Which filter controls this report needs */
  filters: Array<
    | "date"
    | "fromTo"
    | "month"
    | "staff"
    | "leaveType"
    | "status"
    | "department"
    | "stream"
  >;
};

export const STAFF_LEAVE_REPORT_CATEGORIES: {
  id: StaffLeaveReportCategory;
  title: string;
}[] = [
  { id: "leave", title: "Leave reports" },
  { id: "attendance", title: "Attendance reports" },
];

/** Reports shown under Staff → Reports (leave only). */
export function leaveReportDefs() {
  return STAFF_LEAVE_REPORTS.filter((r) => r.category === "leave");
}

/** Reports shown under Attendance → Reports (attendance only). */
export function attendanceReportDefs() {
  return STAFF_LEAVE_REPORTS.filter((r) => r.category === "attendance");
}

export const STAFF_LEAVE_REPORTS: StaffLeaveReportDef[] = [
  {
    id: "staff_on_leave_today",
    category: "leave",
    label: "Staff OnLeave Today",
    hint: "Approved leave covering a date",
    filters: ["date", "department", "stream", "leaveType"],
  },
  {
    id: "staff_wise_leave",
    category: "leave",
    label: "Staff Wise Leave Report",
    hint: "Leave rows for one staff (or all)",
    filters: ["staff", "fromTo", "leaveType", "status", "department", "stream"],
  },
  {
    id: "month_wise_leave",
    category: "leave",
    label: "Month Wise Leave Report",
    hint: "All leave overlapping a month",
    filters: ["month", "leaveType", "status", "department", "stream"],
  },
  {
    id: "staff_wise_month_leave",
    category: "leave",
    label: "Staff Wise Month Leave Report",
    hint: "One staff × one month",
    filters: ["staff", "month", "leaveType", "status"],
  },
  {
    id: "leave_type_wise_month",
    category: "leave",
    label: "Leave Type Wise Month Leave Report",
    hint: "Totals by leave type for a month",
    filters: ["month", "leaveType", "department", "stream"],
  },
  {
    id: "staff_wise_leave_summary",
    category: "leave",
    label: "Staff Wise Leave Summary",
    hint: "Days used / remaining by type",
    filters: ["staff", "fromTo", "department", "stream"],
  },
  {
    id: "staff_wise_leave_adjustment",
    category: "leave",
    label: "Staff Wise Leave Adjustment Report",
    hint: "Leaves marked as adjusted / direct",
    filters: ["staff", "fromTo", "department", "stream"],
  },
  {
    id: "monthly_balance_leave",
    category: "leave",
    label: "Monthly Balance Leave Report",
    hint: "Balance snapshot (allotted / used / remaining)",
    filters: ["staff", "department", "stream", "leaveType"],
  },
  {
    id: "day_wise_attendance",
    category: "attendance",
    label: "Day Wise Staff Attendance Report",
    hint: "Full staff register for one date",
    filters: ["date", "department", "stream"],
  },
  {
    id: "staff_wise_attendance",
    category: "attendance",
    label: "Staff Wise Attendance Report",
    hint: "Daily marks for one staff",
    filters: ["staff", "fromTo", "month"],
  },
  {
    id: "month_wise_attendance",
    category: "attendance",
    label: "Month Wise Attendance Report",
    hint: "Attendance summary for a month",
    filters: ["month", "department", "stream"],
  },
  {
    id: "extra_day",
    category: "attendance",
    label: "Extra Day Report",
    hint: "Present / late on Sunday or note=extra",
    filters: ["month", "fromTo", "department", "stream"],
  },
  {
    id: "outdoor",
    category: "attendance",
    label: "Outdoor Report",
    hint: "Notes mentioning outdoor / OD / field",
    filters: ["month", "fromTo", "department", "stream"],
  },
  {
    id: "staff_absent",
    category: "attendance",
    label: "Staff Absent Report",
    hint: "Staff marked absent (A) in range",
    filters: ["date", "fromTo", "month", "department", "stream", "staff"],
  },
  {
    id: "monthly_work_duration",
    category: "attendance",
    label: "Monthly Work Duration Report",
    hint: "Hours worked from punch in/out for a month",
    filters: ["month", "staff", "department", "stream"],
  },
];

export type StaffLeaveReportFilters = {
  academicYearCode: string;
  date?: string;
  fromDate?: string;
  toDate?: string;
  month?: string; // YYYY-MM
  staffId?: string;
  leaveType?: string;
  status?: "all" | LeaveStatus;
  departmentId?: string;
  stream?: "" | "teaching" | "non_teaching";
  masters?: MastersState;
  hr?: StaffHrState;
  attendance?: StaffAttendanceState;
  format?: StaffLeaveReportFormat;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function ymOf(iso: string): string {
  return iso.slice(0, 7);
}

function monthBounds(month: string): { from: string; to: string } | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(last).padStart(2, "0")}`,
  };
}

function overlapsRange(
  fromDate: string,
  toDate: string,
  rangeFrom: string,
  rangeTo: string,
): boolean {
  return fromDate <= rangeTo && toDate >= rangeFrom;
}

function coversDate(r: LeaveRequest, date: string): boolean {
  return r.fromDate <= date && r.toDate >= date;
}

function staffLabel(s: StaffRecord | undefined, id: string): string {
  return s ? `${s.empCode} · ${s.fullName}` : id;
}

function filterRoster(
  masters: MastersState,
  f: StaffLeaveReportFilters,
): StaffRecord[] {
  return (masters.staff ?? []).filter((s) => {
    if (s.status !== "active" && f.staffId !== s.id) return false;
    if (f.staffId && s.id !== f.staffId) return false;
    if (f.departmentId && s.departmentId !== f.departmentId) return false;
    if (f.stream && s.stream !== f.stream) return false;
    return true;
  });
}

function leaveRows(
  hr: StaffHrState,
  f: StaffLeaveReportFilters,
  masters: MastersState,
): LeaveRequest[] {
  const rosterIds = new Set(filterRoster(masters, f).map((s) => s.id));
  let rows = hr.leaveRequests.filter(
    (r) => r.academicYearCode === f.academicYearCode && rosterIds.has(r.staffId),
  );
  if (f.leaveType) rows = rows.filter((r) => r.typeCode === f.leaveType);
  if (f.status && f.status !== "all") {
    rows = rows.filter((r) => r.status === f.status);
  }
  if (f.staffId) rows = rows.filter((r) => r.staffId === f.staffId);
  return rows;
}

type Built = {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null | undefined>[];
};

function buildReport(
  id: StaffLeaveReportId,
  f: StaffLeaveReportFilters,
): { ok: true; built: Built } | { ok: false; error: string } {
  const masters = f.masters ?? loadMasters();
  const hr = f.hr ?? loadStaffHr();
  const attendance = f.attendance ?? loadStaffAttendance();
  const roster = filterRoster(masters, f);
  const byId = new Map(roster.map((s) => [s.id, s]));
  // include inactive matched staff for staff-wise when selected
  if (f.staffId && !byId.has(f.staffId)) {
    const s = (masters.staff ?? []).find((x) => x.id === f.staffId);
    if (s) {
      roster.push(s);
      byId.set(s.id, s);
    }
  }

  const deptName = (id: string | null) =>
    masters.departments.find((d) => d.id === id)?.name ?? "";

  switch (id) {
    case "staff_on_leave_today": {
      const date = f.date || todayIso();
      const rows = leaveRows(hr, { ...f, status: f.status || "approved" }, masters)
        .filter((r) => r.status === "approved" && coversDate(r, date))
        .map((r) => {
          const s = byId.get(r.staffId);
          return {
            empCode: s?.empCode ?? "",
            staff: s?.fullName ?? r.staffId,
            department: deptName(s?.departmentId ?? null),
            type: r.typeCode,
            from: r.fromDate,
            to: r.toDate,
            days: r.days,
            halfDay: r.halfDay ? "Yes" : "No",
            reason: r.reason,
          };
        });
      return {
        ok: true,
        built: {
          title: `Staff On Leave — ${date}`,
          columns: [
            { key: "empCode", header: "Emp code" },
            { key: "staff", header: "Staff" },
            { key: "department", header: "Department" },
            { key: "type", header: "Leave type" },
            { key: "from", header: "From" },
            { key: "to", header: "To" },
            { key: "days", header: "Days", align: "right" },
            { key: "halfDay", header: "Half day" },
            { key: "reason", header: "Reason" },
          ],
          rows,
        },
      };
    }

    case "staff_wise_leave": {
      const from = f.fromDate || `${f.academicYearCode.slice(0, 4)}-04-01`;
      const to = f.toDate || todayIso();
      const rows = leaveRows(hr, f, masters)
        .filter((r) => overlapsRange(r.fromDate, r.toDate, from, to))
        .sort((a, b) => b.fromDate.localeCompare(a.fromDate))
        .map((r) => {
          const s = byId.get(r.staffId) ?? (masters.staff ?? []).find((x) => x.id === r.staffId);
          return {
            empCode: s?.empCode ?? "",
            staff: s?.fullName ?? r.staffId,
            type: r.typeCode,
            from: r.fromDate,
            to: r.toDate,
            days: r.days,
            halfDay: r.halfDay ? "Yes" : "No",
            status: r.status,
            origin: r.origin,
            reason: r.reason,
            appliedBy: r.appliedBy,
            decidedBy: r.decidedBy,
          };
        });
      return {
        ok: true,
        built: {
          title: "Staff Wise Leave Report",
          columns: [
            { key: "empCode", header: "Emp code" },
            { key: "staff", header: "Staff" },
            { key: "type", header: "Type" },
            { key: "from", header: "From" },
            { key: "to", header: "To" },
            { key: "days", header: "Days", align: "right" },
            { key: "halfDay", header: "Half" },
            { key: "status", header: "Status" },
            { key: "origin", header: "Origin" },
            { key: "reason", header: "Reason" },
            { key: "appliedBy", header: "Applied by" },
            { key: "decidedBy", header: "Decided by" },
          ],
          rows,
        },
      };
    }

    case "month_wise_leave": {
      const month = f.month || ymOf(todayIso());
      const bounds = monthBounds(month);
      if (!bounds) return { ok: false, error: "Select a valid month (YYYY-MM)" };
      const rows = leaveRows(hr, f, masters)
        .filter((r) =>
          overlapsRange(r.fromDate, r.toDate, bounds.from, bounds.to),
        )
        .sort((a, b) => a.fromDate.localeCompare(b.fromDate))
        .map((r) => {
          const s = byId.get(r.staffId);
          return {
            empCode: s?.empCode ?? "",
            staff: s?.fullName ?? r.staffId,
            type: r.typeCode,
            from: r.fromDate,
            to: r.toDate,
            days: r.days,
            status: r.status,
            halfDay: r.halfDay ? "Yes" : "No",
          };
        });
      return {
        ok: true,
        built: {
          title: `Month Wise Leave — ${month}`,
          columns: [
            { key: "empCode", header: "Emp code" },
            { key: "staff", header: "Staff" },
            { key: "type", header: "Type" },
            { key: "from", header: "From" },
            { key: "to", header: "To" },
            { key: "days", header: "Days", align: "right" },
            { key: "status", header: "Status" },
            { key: "halfDay", header: "Half" },
          ],
          rows,
        },
      };
    }

    case "staff_wise_month_leave": {
      if (!f.staffId) return { ok: false, error: "Select a staff member" };
      const month = f.month || ymOf(todayIso());
      const bounds = monthBounds(month);
      if (!bounds) return { ok: false, error: "Select a valid month" };
      const s = byId.get(f.staffId);
      const rows = leaveRows(hr, f, masters)
        .filter((r) =>
          overlapsRange(r.fromDate, r.toDate, bounds.from, bounds.to),
        )
        .map((r) => ({
          type: r.typeCode,
          from: r.fromDate,
          to: r.toDate,
          days: r.days,
          halfDay: r.halfDay ? "Yes" : "No",
          status: r.status,
          reason: r.reason,
        }));
      return {
        ok: true,
        built: {
          title: `Staff Wise Month Leave — ${staffLabel(s, f.staffId)} · ${month}`,
          columns: [
            { key: "type", header: "Type" },
            { key: "from", header: "From" },
            { key: "to", header: "To" },
            { key: "days", header: "Days", align: "right" },
            { key: "halfDay", header: "Half" },
            { key: "status", header: "Status" },
            { key: "reason", header: "Reason" },
          ],
          rows,
        },
      };
    }

    case "leave_type_wise_month": {
      const month = f.month || ymOf(todayIso());
      const bounds = monthBounds(month);
      if (!bounds) return { ok: false, error: "Select a valid month" };
      const matched = leaveRows(hr, { ...f, status: "approved" }, masters).filter(
        (r) =>
          r.status === "approved" &&
          overlapsRange(r.fromDate, r.toDate, bounds.from, bounds.to),
      );
      const types = f.leaveType
        ? hr.leaveTypes.filter((t) => t.code === f.leaveType)
        : hr.leaveTypes;
      const rows = types.map((t) => {
        const list = matched.filter((r) => r.typeCode === t.code);
        return {
          type: t.code,
          name: t.name,
          applications: list.length,
          days: Math.round(list.reduce((s, r) => s + r.days, 0) * 10) / 10,
          halfDayApps: list.filter((r) => r.halfDay).length,
        };
      });
      return {
        ok: true,
        built: {
          title: `Leave Type Wise Month — ${month}`,
          columns: [
            { key: "type", header: "Code" },
            { key: "name", header: "Leave type" },
            { key: "applications", header: "Applications", align: "right" },
            { key: "days", header: "Days", align: "right" },
            { key: "halfDayApps", header: "Half-day apps", align: "right" },
          ],
          rows,
        },
      };
    }

    case "staff_wise_leave_summary": {
      const from = f.fromDate;
      const to = f.toDate;
      const people = f.staffId
        ? roster.filter((s) => s.id === f.staffId)
        : roster;
      const rows: Record<string, string | number>[] = [];
      for (const s of people) {
        for (const t of hr.leaveTypes) {
          const bal = hr.leaveBalances.find(
            (b) =>
              b.staffId === s.id &&
              b.typeCode === t.code &&
              b.academicYearCode === f.academicYearCode,
          );
          let used = bal?.used ?? 0;
          if (from && to) {
            used = hr.leaveRequests
              .filter(
                (r) =>
                  r.staffId === s.id &&
                  r.typeCode === t.code &&
                  r.academicYearCode === f.academicYearCode &&
                  r.status === "approved" &&
                  overlapsRange(r.fromDate, r.toDate, from, to),
              )
              .reduce((sum, r) => sum + r.days, 0);
          }
          const allotted = bal?.allotted ?? t.defaultDaysPerYear;
          rows.push({
            empCode: s.empCode,
            staff: s.fullName,
            type: t.code,
            allotted,
            used: Math.round(used * 10) / 10,
            remaining: Math.round((allotted - used) * 10) / 10,
          });
        }
      }
      return {
        ok: true,
        built: {
          title: "Staff Wise Leave Summary",
          columns: [
            { key: "empCode", header: "Emp code" },
            { key: "staff", header: "Staff" },
            { key: "type", header: "Type" },
            { key: "allotted", header: "Allotted", align: "right" },
            { key: "used", header: "Used", align: "right" },
            { key: "remaining", header: "Remaining", align: "right" },
          ],
          rows,
        },
      };
    }

    case "staff_wise_leave_adjustment": {
      const from = f.fromDate || "2000-01-01";
      const to = f.toDate || todayIso();
      const rows = leaveRows(hr, f, masters)
        .filter(
          (r) =>
            (r.origin === "adjusted" || r.origin === "direct") &&
            overlapsRange(r.fromDate, r.toDate, from, to),
        )
        .map((r) => {
          const s = byId.get(r.staffId);
          return {
            empCode: s?.empCode ?? "",
            staff: s?.fullName ?? r.staffId,
            type: r.typeCode,
            from: r.fromDate,
            to: r.toDate,
            days: r.days,
            halfDay: r.halfDay ? "Yes" : "No",
            origin: r.origin,
            note: r.decisionNote,
            by: r.decidedBy || r.appliedBy,
            status: r.status,
          };
        });
      return {
        ok: true,
        built: {
          title: "Staff Wise Leave Adjustment Report",
          columns: [
            { key: "empCode", header: "Emp code" },
            { key: "staff", header: "Staff" },
            { key: "type", header: "Type" },
            { key: "from", header: "From" },
            { key: "to", header: "To" },
            { key: "days", header: "Days", align: "right" },
            { key: "halfDay", header: "Half" },
            { key: "origin", header: "Origin" },
            { key: "note", header: "Note" },
            { key: "by", header: "By" },
            { key: "status", header: "Status" },
          ],
          rows,
        },
      };
    }

    case "monthly_balance_leave": {
      const people = f.staffId
        ? roster.filter((s) => s.id === f.staffId)
        : roster;
      const types = f.leaveType
        ? hr.leaveTypes.filter((t) => t.code === f.leaveType)
        : hr.leaveTypes;
      const rows: Record<string, string | number>[] = [];
      for (const s of people) {
        for (const t of types) {
          const bal = hr.leaveBalances.find(
            (b) =>
              b.staffId === s.id &&
              b.typeCode === t.code &&
              b.academicYearCode === f.academicYearCode,
          );
          const allotted = bal?.allotted ?? t.defaultDaysPerYear;
          const used = bal?.used ?? 0;
          rows.push({
            empCode: s.empCode,
            staff: s.fullName,
            department: deptName(s.departmentId),
            type: t.code,
            allotted,
            used,
            remaining: bal ? remainingBalance(bal) : allotted,
          });
        }
      }
      return {
        ok: true,
        built: {
          title: `Monthly Balance Leave — ${f.academicYearCode}`,
          columns: [
            { key: "empCode", header: "Emp code" },
            { key: "staff", header: "Staff" },
            { key: "department", header: "Department" },
            { key: "type", header: "Type" },
            { key: "allotted", header: "Allotted", align: "right" },
            { key: "used", header: "Used", align: "right" },
            { key: "remaining", header: "Remaining", align: "right" },
          ],
          rows,
        },
      };
    }

    case "day_wise_attendance": {
      const date = f.date || todayIso();
      const reg = attendance.registers.find(
        (r) =>
          r.academicYearCode === f.academicYearCode && r.date === date,
      );
      const byMark = new Map((reg?.marks ?? []).map((m) => [m.staffId, m]));
      const rows = roster.map((s) => {
        const m = byMark.get(s.id);
        return {
          empCode: s.empCode,
          staff: s.fullName,
          department: deptName(s.departmentId),
          status: m?.status ?? "—",
          inTime: m?.inTime ?? "",
          outTime: m?.outTime ?? "",
          way: punchWayLabel(m?.punchWay),
          note: m?.note ?? "",
          hours:
            m?.inTime && m?.outTime
              ? hoursBetween(m.inTime, m.outTime)
              : "",
        };
      });
      return {
        ok: true,
        built: {
          title: `Day Wise Staff Attendance — ${date}`,
          columns: [
            { key: "empCode", header: "Emp code" },
            { key: "staff", header: "Staff" },
            { key: "department", header: "Department" },
            { key: "status", header: "Status" },
            { key: "inTime", header: "In" },
            { key: "outTime", header: "Out" },
            { key: "hours", header: "Hours", align: "right" },
            { key: "way", header: "Way" },
            { key: "note", header: "Note" },
          ],
          rows,
        },
      };
    }

    case "staff_wise_attendance": {
      if (!f.staffId) return { ok: false, error: "Select a staff member" };
      const month = f.month;
      const bounds = month ? monthBounds(month) : null;
      const from = f.fromDate || bounds?.from || `${f.academicYearCode.slice(0, 4)}-04-01`;
      const to = f.toDate || bounds?.to || todayIso();
      const s = byId.get(f.staffId);
      const rows = attendance.registers
        .filter(
          (reg) =>
            reg.academicYearCode === f.academicYearCode &&
            reg.date >= from &&
            reg.date <= to,
        )
        .sort((a, b) => a.date.localeCompare(b.date))
        .flatMap((reg) => {
          const m = reg.marks.find((x) => x.staffId === f.staffId);
          if (!m) return [];
          return [
            {
              date: reg.date,
              status: m.status,
              inTime: m.inTime,
              outTime: m.outTime,
              way: punchWayLabel(m.punchWay),
              note: m.note,
            },
          ];
        });
      return {
        ok: true,
        built: {
          title: `Staff Wise Attendance — ${staffLabel(s, f.staffId)}`,
          columns: [
            { key: "date", header: "Date" },
            { key: "status", header: "Status" },
            { key: "inTime", header: "In" },
            { key: "outTime", header: "Out" },
            { key: "way", header: "Way" },
            { key: "note", header: "Note" },
          ],
          rows,
        },
      };
    }

    case "month_wise_attendance": {
      const month = f.month || ymOf(todayIso());
      const bounds = monthBounds(month);
      if (!bounds) return { ok: false, error: "Select a valid month" };
      const regs = attendance.registers.filter(
        (reg) =>
          reg.academicYearCode === f.academicYearCode &&
          reg.date >= bounds.from &&
          reg.date <= bounds.to,
      );
      const rows = roster.map((s) => {
        const counts = { P: 0, A: 0, L: 0, HD: 0, LE: 0 };
        for (const reg of regs) {
          const m = reg.marks.find((x) => x.staffId === s.id);
          if (m && m.status in counts) {
            counts[m.status as keyof typeof counts] += 1;
          }
        }
        return {
          empCode: s.empCode,
          staff: s.fullName,
          department: deptName(s.departmentId),
          present: counts.P,
          absent: counts.A,
          late: counts.L,
          halfDay: counts.HD,
          leave: counts.LE,
          marked:
            counts.P + counts.A + counts.L + counts.HD + counts.LE,
        };
      });
      return {
        ok: true,
        built: {
          title: `Month Wise Attendance — ${month}`,
          columns: [
            { key: "empCode", header: "Emp code" },
            { key: "staff", header: "Staff" },
            { key: "department", header: "Department" },
            { key: "present", header: "P", align: "right" },
            { key: "absent", header: "A", align: "right" },
            { key: "late", header: "L", align: "right" },
            { key: "halfDay", header: "HD", align: "right" },
            { key: "leave", header: "LE", align: "right" },
            { key: "marked", header: "Marked", align: "right" },
          ],
          rows,
        },
      };
    }

    case "extra_day": {
      const month = f.month;
      const bounds = month ? monthBounds(month) : null;
      const from = f.fromDate || bounds?.from || `${f.academicYearCode.slice(0, 4)}-04-01`;
      const to = f.toDate || bounds?.to || todayIso();
      const rows: Record<string, string | number>[] = [];
      for (const reg of attendance.registers) {
        if (reg.academicYearCode !== f.academicYearCode) continue;
        if (reg.date < from || reg.date > to) continue;
        const dow = new Date(`${reg.date}T12:00:00`).getDay();
        const sunday = dow === 0;
        for (const m of reg.marks) {
          if (!byId.has(m.staffId)) continue;
          const noteExtra = /extra|comp.?off|overtime|ot\b/i.test(m.note);
          if (!sunday && !noteExtra) continue;
          if (!["P", "L", "HD"].includes(m.status) && !noteExtra) continue;
          const s = byId.get(m.staffId);
          rows.push({
            date: reg.date,
            weekday: sunday ? "Sunday" : "Other",
            empCode: s?.empCode ?? "",
            staff: s?.fullName ?? m.staffId,
            status: m.status,
            inTime: m.inTime,
            outTime: m.outTime,
            note: m.note,
          });
        }
      }
      rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      return {
        ok: true,
        built: {
          title: "Extra Day Report",
          columns: [
            { key: "date", header: "Date" },
            { key: "weekday", header: "Day" },
            { key: "empCode", header: "Emp code" },
            { key: "staff", header: "Staff" },
            { key: "status", header: "Status" },
            { key: "inTime", header: "In" },
            { key: "outTime", header: "Out" },
            { key: "note", header: "Note" },
          ],
          rows,
        },
      };
    }

    case "outdoor": {
      const month = f.month;
      const bounds = month ? monthBounds(month) : null;
      const from = f.fromDate || bounds?.from || `${f.academicYearCode.slice(0, 4)}-04-01`;
      const to = f.toDate || bounds?.to || todayIso();
      const rows: Record<string, string | number>[] = [];
      for (const reg of attendance.registers) {
        if (reg.academicYearCode !== f.academicYearCode) continue;
        if (reg.date < from || reg.date > to) continue;
        for (const m of reg.marks) {
          if (!byId.has(m.staffId)) continue;
          if (!/outdoor|on\s*duty|\bod\b|field|tour/i.test(m.note)) continue;
          const s = byId.get(m.staffId);
          rows.push({
            date: reg.date,
            empCode: s?.empCode ?? "",
            staff: s?.fullName ?? m.staffId,
            status: m.status,
            note: m.note,
            inTime: m.inTime,
            outTime: m.outTime,
          });
        }
      }
      return {
        ok: true,
        built: {
          title: "Outdoor Report",
          columns: [
            { key: "date", header: "Date" },
            { key: "empCode", header: "Emp code" },
            { key: "staff", header: "Staff" },
            { key: "status", header: "Status" },
            { key: "note", header: "Note" },
            { key: "inTime", header: "In" },
            { key: "outTime", header: "Out" },
          ],
          rows,
        },
      };
    }

    case "staff_absent": {
      const month = f.month;
      const bounds = month ? monthBounds(month) : null;
      const single = f.date && !f.fromDate && !f.toDate && !month ? f.date : "";
      const from =
        single ||
        f.fromDate ||
        bounds?.from ||
        `${f.academicYearCode.slice(0, 4)}-04-01`;
      const to = single || f.toDate || bounds?.to || todayIso();
      const rows: Record<string, string | number>[] = [];
      for (const reg of attendance.registers) {
        if (reg.academicYearCode !== f.academicYearCode) continue;
        if (reg.date < from || reg.date > to) continue;
        for (const m of reg.marks) {
          if (m.status !== "A") continue;
          if (!byId.has(m.staffId)) continue;
          if (f.staffId && m.staffId !== f.staffId) continue;
          const s = byId.get(m.staffId);
          rows.push({
            date: reg.date,
            empCode: s?.empCode ?? "",
            staff: s?.fullName ?? m.staffId,
            department: deptName(s?.departmentId ?? null),
            note: m.note,
            way: punchWayLabel(m.punchWay),
          });
        }
      }
      rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      return {
        ok: true,
        built: {
          title: "Staff Absent Report",
          columns: [
            { key: "date", header: "Date" },
            { key: "empCode", header: "Emp code" },
            { key: "staff", header: "Staff" },
            { key: "department", header: "Department" },
            { key: "way", header: "Way" },
            { key: "note", header: "Note" },
          ],
          rows,
        },
      };
    }

    case "monthly_work_duration": {
      const month = f.month || ymOf(todayIso());
      const bounds = monthBounds(month);
      if (!bounds) return { ok: false, error: "Select a valid month" };
      const regs = attendance.registers.filter(
        (reg) =>
          reg.academicYearCode === f.academicYearCode &&
          reg.date >= bounds.from &&
          reg.date <= bounds.to,
      );
      const people = f.staffId
        ? roster.filter((s) => s.id === f.staffId)
        : roster;

      if (f.staffId) {
        const s = people[0];
        if (!s) return { ok: false, error: "Staff not found" };
        const rows: Record<string, string | number>[] = [];
        let total = 0;
        for (const reg of regs) {
          const m = reg.marks.find((x) => x.staffId === s.id);
          if (!m?.inTime || !m?.outTime) continue;
          const hrs = hoursBetween(m.inTime, m.outTime);
          if (hrs <= 0) continue;
          total += hrs;
          rows.push({
            date: reg.date,
            inTime: m.inTime,
            outTime: m.outTime,
            hours: hrs,
            status: m.status,
            way: punchWayLabel(m.punchWay),
          });
        }
        rows.push({
          date: "TOTAL",
          inTime: "",
          outTime: "",
          hours: Math.round(total * 100) / 100,
          status: "",
          way: "",
        });
        return {
          ok: true,
          built: {
            title: `Monthly Work Duration — ${staffLabel(s, s.id)} · ${month}`,
            columns: [
              { key: "date", header: "Date" },
              { key: "inTime", header: "In" },
              { key: "outTime", header: "Out" },
              { key: "hours", header: "Hours", align: "right" },
              { key: "status", header: "Status" },
              { key: "way", header: "Way" },
            ],
            rows,
          },
        };
      }

      const rows = people.map((s) => {
        let totalHours = 0;
        let daysWithPunch = 0;
        for (const reg of regs) {
          const m = reg.marks.find((x) => x.staffId === s.id);
          if (!m?.inTime || !m?.outTime) continue;
          const hrs = hoursBetween(m.inTime, m.outTime);
          if (hrs <= 0) continue;
          daysWithPunch += 1;
          totalHours += hrs;
        }
        return {
          empCode: s.empCode,
          staff: s.fullName,
          department: deptName(s.departmentId),
          days: daysWithPunch,
          hours: Math.round(totalHours * 100) / 100,
          avgHours:
            daysWithPunch > 0
              ? Math.round((totalHours / daysWithPunch) * 100) / 100
              : 0,
        };
      });
      return {
        ok: true,
        built: {
          title: `Monthly Work Duration — ${month}`,
          columns: [
            { key: "empCode", header: "Emp code" },
            { key: "staff", header: "Staff" },
            { key: "department", header: "Department" },
            { key: "days", header: "Days punched", align: "right" },
            { key: "hours", header: "Total hours", align: "right" },
            { key: "avgHours", header: "Avg hours/day", align: "right" },
          ],
          rows,
        },
      };
    }

    default:
      return { ok: false, error: "Unknown report" };
  }
}

export function runStaffLeaveReport(
  id: StaffLeaveReportId,
  filters: StaffLeaveReportFilters,
):
  | {
      ok: true;
      message: string;
      preview?: Built;
    }
  | { ok: false; error: string } {
  const def = STAFF_LEAVE_REPORTS.find((r) => r.id === id);
  if (!def) return { ok: false, error: "Unknown report" };

  const result = buildReport(id, filters);
  if (!result.ok) return result;

  const format = filters.format ?? "preview";
  const filterNote = describeFilters([
    filters.date ? `Date ${filters.date}` : "",
    filters.fromDate ? `From ${filters.fromDate}` : "",
    filters.toDate ? `To ${filters.toDate}` : "",
    filters.month ? `Month ${filters.month}` : "",
    filters.staffId
      ? `Staff ${(filters.masters ?? loadMasters()).staff.find((s) => s.id === filters.staffId)?.fullName || filters.staffId}`
      : "",
    filters.leaveType ? `Type ${filters.leaveType}` : "",
    filters.status && filters.status !== "all"
      ? `Status ${filters.status}`
      : "",
    `AY ${filters.academicYearCode}`,
  ]);

  if (format === "preview") {
    return {
      ok: true,
      message: `${result.built.rows.length} row(s)`,
      preview: result.built,
    };
  }

  exportFilterReport(
    {
      title: result.built.title,
      subtitle: TENANT.shortName,
      filterNote,
      columns: result.built.columns,
      rows: result.built.rows,
      fileBaseName: `staff_${id}`,
    },
    format === "pdf" ? "pdf" : "excel",
  );

  return {
    ok: true,
    message: `Exported ${result.built.rows.length} row(s) as ${format.toUpperCase()}`,
    preview: result.built,
  };
}

export function reportNeedsStaff(id: StaffLeaveReportId): boolean {
  return (
    id === "staff_wise_month_leave" || id === "staff_wise_attendance"
  );
}
