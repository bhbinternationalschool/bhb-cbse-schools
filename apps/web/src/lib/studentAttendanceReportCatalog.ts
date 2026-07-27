/**
 * Student attendance report catalog — filters + tabular export.
 */

import {
  attendanceStatusLabel,
  loadAttendance,
  type AttendanceState,
  type AttendanceStatus,
} from "@/lib/attendance";
import {
  loadMasters,
  type MastersState,
} from "@/lib/masters";
import {
  exportFilterReport,
  describeFilters,
  type ReportColumn,
} from "@/lib/reportExport";
import { loadSis, type SisState, type SisStudent } from "@/lib/sis";
import { TENANT } from "@/lib/types";

export type StudentAttReportFormat = "excel" | "pdf" | "preview";

export type StudentAttReportId =
  | "day_wise"
  | "student_wise"
  | "month_wise"
  | "class_section_wise"
  | "student_absent"
  | "monthly_percentage"
  | "leave_excused";

export type StudentAttReportDef = {
  id: StudentAttReportId;
  label: string;
  hint?: string;
  filters: Array<
    | "date"
    | "fromTo"
    | "month"
    | "class"
    | "section"
    | "student"
    | "status"
    | "gender"
  >;
};

export const STUDENT_ATT_REPORTS: StudentAttReportDef[] = [
  {
    id: "day_wise",
    label: "Day Wise Student Attendance Report",
    hint: "All marked students for one date",
    filters: ["date", "class", "section", "status", "gender"],
  },
  {
    id: "student_wise",
    label: "Student Wise Attendance Report",
    hint: "Daily marks for one student",
    filters: ["student", "fromTo", "month", "class", "section", "status"],
  },
  {
    id: "month_wise",
    label: "Month Wise Attendance Report",
    hint: "P/A/L/HD/LE counts per student for a month",
    filters: ["month", "class", "section", "gender"],
  },
  {
    id: "class_section_wise",
    label: "Class / Section Wise Attendance Report",
    hint: "Section totals for a date or month",
    filters: ["date", "month", "class", "section"],
  },
  {
    id: "student_absent",
    label: "Student Absent Report",
    hint: "Students marked absent (A)",
    filters: ["date", "fromTo", "month", "class", "section", "student", "gender"],
  },
  {
    id: "monthly_percentage",
    label: "Monthly Attendance Percentage Report",
    hint: "Attendance % from marked days in a month",
    filters: ["month", "class", "section", "student", "gender"],
  },
  {
    id: "leave_excused",
    label: "Leave / Excused Report",
    hint: "Students marked LE in range",
    filters: ["date", "fromTo", "month", "class", "section", "student"],
  },
];

export type StudentAttReportFilters = {
  academicYearCode: string;
  date?: string;
  fromDate?: string;
  toDate?: string;
  month?: string;
  classId?: string;
  sectionId?: string;
  studentId?: string;
  status?: "all" | AttendanceStatus;
  gender?: "" | "M" | "F" | "O";
  masters?: MastersState;
  sis?: SisState;
  attendance?: AttendanceState;
  format?: StudentAttReportFormat;
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

function className(masters: MastersState, classId: string): string {
  return masters.classes.find((c) => c.id === classId)?.name ?? classId;
}

function sectionName(masters: MastersState, sectionId: string): string {
  return masters.sections.find((s) => s.id === sectionId)?.name ?? sectionId;
}

function filterStudents(
  sis: SisState,
  f: StudentAttReportFilters,
): SisStudent[] {
  return (sis.students ?? []).filter((s) => {
    if (s.status !== "active") return false;
    if (f.academicYearCode && s.academicYearCode && s.academicYearCode !== f.academicYearCode) {
      return false;
    }
    if (f.classId && s.classId !== f.classId) return false;
    if (f.sectionId && s.sectionId !== f.sectionId) return false;
    if (f.studentId && s.id !== f.studentId) return false;
    if (f.gender && s.gender !== f.gender) return false;
    return true;
  });
}

type Built = {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null | undefined>[];
};

function buildReport(
  id: StudentAttReportId,
  f: StudentAttReportFilters,
): { ok: true; built: Built } | { ok: false; error: string } {
  const masters = f.masters ?? loadMasters();
  const sis = f.sis ?? loadSis();
  const attendance = f.attendance ?? loadAttendance();
  const students = filterStudents(sis, f);
  const byId = new Map(students.map((s) => [s.id, s]));
  // Include selected student even if filtered out of active set
  if (f.studentId && !byId.has(f.studentId)) {
    const s = (sis.students ?? []).find((x) => x.id === f.studentId);
    if (s) {
      students.push(s);
      byId.set(s.id, s);
    }
  }

  const regs = attendance.registers.filter(
    (r) => r.academicYearCode === f.academicYearCode,
  );

  switch (id) {
    case "day_wise": {
      const date = f.date || todayIso();
      const dayRegs = regs.filter((r) => {
        if (r.date !== date) return false;
        if (f.classId && r.classId !== f.classId) return false;
        if (f.sectionId && r.sectionId !== f.sectionId) return false;
        return true;
      });
      const rows: Record<string, string | number>[] = [];
      for (const reg of dayRegs) {
        for (const m of reg.marks) {
          const s = byId.get(m.studentId);
          if (!s) continue;
          if (f.status && f.status !== "all" && m.status !== f.status) continue;
          rows.push({
            admissionNo: s.admissionNo,
            student: s.fullName,
            rollNo: s.rollNo,
            className: className(masters, reg.classId || s.classId),
            section: sectionName(masters, reg.sectionId || s.sectionId),
            status: m.status,
            statusLabel: attendanceStatusLabel(m.status),
            note: m.note,
          });
        }
      }
      rows.sort((a, b) => {
        const c = String(a.className).localeCompare(String(b.className));
        if (c) return c;
        const s = String(a.section).localeCompare(String(b.section));
        if (s) return s;
        return String(a.rollNo).localeCompare(String(b.rollNo), undefined, {
          numeric: true,
        });
      });
      return {
        ok: true,
        built: {
          title: `Day Wise Student Attendance — ${date}`,
          columns: [
            { key: "admissionNo", header: "Adm no" },
            { key: "student", header: "Student" },
            { key: "rollNo", header: "Roll" },
            { key: "className", header: "Class" },
            { key: "section", header: "Section" },
            { key: "status", header: "Code" },
            { key: "statusLabel", header: "Status" },
            { key: "note", header: "Note" },
          ],
          rows,
        },
      };
    }

    case "student_wise": {
      if (!f.studentId) return { ok: false, error: "Select a student" };
      const s = byId.get(f.studentId);
      if (!s) return { ok: false, error: "Student not found" };
      const month = f.month;
      const bounds = month ? monthBounds(month) : null;
      const from =
        f.fromDate || bounds?.from || `${f.academicYearCode.slice(0, 4)}-04-01`;
      const to = f.toDate || bounds?.to || todayIso();
      const rows: Record<string, string | number>[] = [];
      for (const reg of regs) {
        if (reg.date < from || reg.date > to) continue;
        if (f.classId && reg.classId !== f.classId) continue;
        if (f.sectionId && reg.sectionId !== f.sectionId) continue;
        const m = reg.marks.find((x) => x.studentId === f.studentId);
        if (!m) continue;
        if (f.status && f.status !== "all" && m.status !== f.status) continue;
        rows.push({
          date: reg.date,
          className: className(masters, reg.classId),
          section: sectionName(masters, reg.sectionId),
          status: m.status,
          statusLabel: attendanceStatusLabel(m.status),
          note: m.note,
        });
      }
      rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      return {
        ok: true,
        built: {
          title: `Student Wise Attendance — ${s.admissionNo} · ${s.fullName}`,
          columns: [
            { key: "date", header: "Date" },
            { key: "className", header: "Class" },
            { key: "section", header: "Section" },
            { key: "status", header: "Code" },
            { key: "statusLabel", header: "Status" },
            { key: "note", header: "Note" },
          ],
          rows,
        },
      };
    }

    case "month_wise": {
      const month = f.month || ymOf(todayIso());
      const bounds = monthBounds(month);
      if (!bounds) return { ok: false, error: "Select a valid month" };
      const monthRegs = regs.filter(
        (r) =>
          r.date >= bounds.from &&
          r.date <= bounds.to &&
          (!f.classId || r.classId === f.classId) &&
          (!f.sectionId || r.sectionId === f.sectionId),
      );
      const rows = students.map((s) => {
        const counts = { P: 0, A: 0, L: 0, HD: 0, LE: 0 };
        for (const reg of monthRegs) {
          const m = reg.marks.find((x) => x.studentId === s.id);
          if (m && m.status in counts) {
            counts[m.status as keyof typeof counts] += 1;
          }
        }
        const marked =
          counts.P + counts.A + counts.L + counts.HD + counts.LE;
        return {
          admissionNo: s.admissionNo,
          student: s.fullName,
          rollNo: s.rollNo,
          className: className(masters, s.classId),
          section: sectionName(masters, s.sectionId),
          present: counts.P,
          absent: counts.A,
          late: counts.L,
          halfDay: counts.HD,
          leave: counts.LE,
          marked,
        };
      });
      return {
        ok: true,
        built: {
          title: `Month Wise Attendance — ${month}`,
          columns: [
            { key: "admissionNo", header: "Adm no" },
            { key: "student", header: "Student" },
            { key: "rollNo", header: "Roll" },
            { key: "className", header: "Class" },
            { key: "section", header: "Section" },
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

    case "class_section_wise": {
      const month = f.month;
      const bounds = month ? monthBounds(month) : null;
      const date = f.date;
      const scoped = regs.filter((r) => {
        if (f.classId && r.classId !== f.classId) return false;
        if (f.sectionId && r.sectionId !== f.sectionId) return false;
        if (date) return r.date === date;
        if (bounds) return r.date >= bounds.from && r.date <= bounds.to;
        return r.date === todayIso();
      });
      const keyMap = new Map<
        string,
        { classId: string; sectionId: string; P: number; A: number; L: number; HD: number; LE: number; days: Set<string> }
      >();
      for (const reg of scoped) {
        const key = `${reg.classId}|${reg.sectionId}`;
        let row = keyMap.get(key);
        if (!row) {
          row = {
            classId: reg.classId,
            sectionId: reg.sectionId,
            P: 0,
            A: 0,
            L: 0,
            HD: 0,
            LE: 0,
            days: new Set(),
          };
          keyMap.set(key, row);
        }
        row.days.add(reg.date);
        for (const m of reg.marks) {
          if (m.status === "P") row.P += 1;
          else if (m.status === "A") row.A += 1;
          else if (m.status === "L") row.L += 1;
          else if (m.status === "HD") row.HD += 1;
          else if (m.status === "LE") row.LE += 1;
        }
      }
      const rows = [...keyMap.values()]
        .map((r) => ({
          className: className(masters, r.classId),
          section: sectionName(masters, r.sectionId),
          days: r.days.size,
          present: r.P,
          absent: r.A,
          late: r.L,
          halfDay: r.HD,
          leave: r.LE,
          total: r.P + r.A + r.L + r.HD + r.LE,
        }))
        .sort((a, b) => {
          const c = a.className.localeCompare(b.className);
          if (c) return c;
          return a.section.localeCompare(b.section);
        });
      return {
        ok: true,
        built: {
          title: date
            ? `Class / Section Attendance — ${date}`
            : `Class / Section Attendance — ${month || "range"}`,
          columns: [
            { key: "className", header: "Class" },
            { key: "section", header: "Section" },
            { key: "days", header: "Days", align: "right" },
            { key: "present", header: "P", align: "right" },
            { key: "absent", header: "A", align: "right" },
            { key: "late", header: "L", align: "right" },
            { key: "halfDay", header: "HD", align: "right" },
            { key: "leave", header: "LE", align: "right" },
            { key: "total", header: "Total marks", align: "right" },
          ],
          rows,
        },
      };
    }

    case "student_absent": {
      const month = f.month;
      const bounds = month ? monthBounds(month) : null;
      const single =
        f.date && !f.fromDate && !f.toDate && !month ? f.date : "";
      const from =
        single ||
        f.fromDate ||
        bounds?.from ||
        `${f.academicYearCode.slice(0, 4)}-04-01`;
      const to = single || f.toDate || bounds?.to || todayIso();
      const rows: Record<string, string | number>[] = [];
      for (const reg of regs) {
        if (reg.date < from || reg.date > to) continue;
        if (f.classId && reg.classId !== f.classId) continue;
        if (f.sectionId && reg.sectionId !== f.sectionId) continue;
        for (const m of reg.marks) {
          if (m.status !== "A") continue;
          const s = byId.get(m.studentId);
          if (!s) continue;
          if (f.studentId && s.id !== f.studentId) continue;
          rows.push({
            date: reg.date,
            admissionNo: s.admissionNo,
            student: s.fullName,
            rollNo: s.rollNo,
            className: className(masters, reg.classId || s.classId),
            section: sectionName(masters, reg.sectionId || s.sectionId),
            note: m.note,
          });
        }
      }
      rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      return {
        ok: true,
        built: {
          title: "Student Absent Report",
          columns: [
            { key: "date", header: "Date" },
            { key: "admissionNo", header: "Adm no" },
            { key: "student", header: "Student" },
            { key: "rollNo", header: "Roll" },
            { key: "className", header: "Class" },
            { key: "section", header: "Section" },
            { key: "note", header: "Note" },
          ],
          rows,
        },
      };
    }

    case "monthly_percentage": {
      const month = f.month || ymOf(todayIso());
      const bounds = monthBounds(month);
      if (!bounds) return { ok: false, error: "Select a valid month" };
      const monthRegs = regs.filter(
        (r) =>
          r.date >= bounds.from &&
          r.date <= bounds.to &&
          (!f.classId || r.classId === f.classId) &&
          (!f.sectionId || r.sectionId === f.sectionId),
      );
      const people = f.studentId
        ? students.filter((s) => s.id === f.studentId)
        : students;
      const rows = people.map((s) => {
        let presentish = 0;
        let marked = 0;
        for (const reg of monthRegs) {
          const m = reg.marks.find((x) => x.studentId === s.id);
          if (!m) continue;
          marked += 1;
          if (m.status === "P" || m.status === "L" || m.status === "HD") {
            presentish += m.status === "HD" ? 0.5 : 1;
          }
        }
        const pct =
          marked > 0 ? Math.round((presentish / marked) * 1000) / 10 : 0;
        return {
          admissionNo: s.admissionNo,
          student: s.fullName,
          rollNo: s.rollNo,
          className: className(masters, s.classId),
          section: sectionName(masters, s.sectionId),
          marked,
          presentDays: Math.round(presentish * 10) / 10,
          percent: pct,
        };
      });
      return {
        ok: true,
        built: {
          title: `Monthly Attendance % — ${month}`,
          columns: [
            { key: "admissionNo", header: "Adm no" },
            { key: "student", header: "Student" },
            { key: "rollNo", header: "Roll" },
            { key: "className", header: "Class" },
            { key: "section", header: "Section" },
            { key: "marked", header: "Days marked", align: "right" },
            { key: "presentDays", header: "Present days", align: "right" },
            { key: "percent", header: "%", align: "right" },
          ],
          rows,
        },
      };
    }

    case "leave_excused": {
      const month = f.month;
      const bounds = month ? monthBounds(month) : null;
      const single =
        f.date && !f.fromDate && !f.toDate && !month ? f.date : "";
      const from =
        single ||
        f.fromDate ||
        bounds?.from ||
        `${f.academicYearCode.slice(0, 4)}-04-01`;
      const to = single || f.toDate || bounds?.to || todayIso();
      const rows: Record<string, string | number>[] = [];
      for (const reg of regs) {
        if (reg.date < from || reg.date > to) continue;
        if (f.classId && reg.classId !== f.classId) continue;
        if (f.sectionId && reg.sectionId !== f.sectionId) continue;
        for (const m of reg.marks) {
          if (m.status !== "LE") continue;
          const s = byId.get(m.studentId);
          if (!s) continue;
          if (f.studentId && s.id !== f.studentId) continue;
          rows.push({
            date: reg.date,
            admissionNo: s.admissionNo,
            student: s.fullName,
            rollNo: s.rollNo,
            className: className(masters, reg.classId || s.classId),
            section: sectionName(masters, reg.sectionId || s.sectionId),
            note: m.note,
          });
        }
      }
      rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      return {
        ok: true,
        built: {
          title: "Leave / Excused Report",
          columns: [
            { key: "date", header: "Date" },
            { key: "admissionNo", header: "Adm no" },
            { key: "student", header: "Student" },
            { key: "rollNo", header: "Roll" },
            { key: "className", header: "Class" },
            { key: "section", header: "Section" },
            { key: "note", header: "Note" },
          ],
          rows,
        },
      };
    }

    default:
      return { ok: false, error: "Unknown report" };
  }
}

export function runStudentAttReport(
  id: StudentAttReportId,
  filters: StudentAttReportFilters,
):
  | { ok: true; message: string; preview?: Built }
  | { ok: false; error: string } {
  const def = STUDENT_ATT_REPORTS.find((r) => r.id === id);
  if (!def) return { ok: false, error: "Unknown report" };

  const result = buildReport(id, filters);
  if (!result.ok) return result;

  const format = filters.format ?? "preview";
  const masters = filters.masters ?? loadMasters();
  const filterNote = describeFilters([
    filters.date ? `Date ${filters.date}` : "",
    filters.fromDate ? `From ${filters.fromDate}` : "",
    filters.toDate ? `To ${filters.toDate}` : "",
    filters.month ? `Month ${filters.month}` : "",
    filters.classId ? `Class ${className(masters, filters.classId)}` : "",
    filters.sectionId
      ? `Section ${sectionName(masters, filters.sectionId)}`
      : "",
    filters.studentId
      ? `Student ${(filters.sis ?? loadSis()).students.find((s) => s.id === filters.studentId)?.fullName || filters.studentId}`
      : "",
    filters.status && filters.status !== "all"
      ? `Status ${filters.status}`
      : "",
    filters.gender ? `Gender ${filters.gender}` : "",
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
      fileBaseName: `student_att_${id}`,
    },
    format === "pdf" ? "pdf" : "excel",
  );

  return {
    ok: true,
    message: `Exported ${result.built.rows.length} row(s) as ${format.toUpperCase()}`,
    preview: result.built,
  };
}

export function studentReportNeedsStudent(id: StudentAttReportId): boolean {
  return id === "student_wise";
}
