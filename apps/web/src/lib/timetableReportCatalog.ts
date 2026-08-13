/**
 * Timetable reports — teacher load, free-period register, substitution
 * register. Timetable was absent from the Reports Center catalog entirely
 * (lib/reportsCenterCatalog.ts): the module has a rich solver/substitution
 * engine (lib/timetable.ts, lib/timetableSubstitution.ts) but nothing
 * printable came out of it — an office needing "who's free period 4 on
 * Thursday" or a monthly substitution audit had no report to run.
 */

import {
  describeFilters,
  exportFilterReport,
  type ReportColumn,
} from "@/lib/reportExport";
import { currentAcademicYearCode, loadMasters, type MastersState } from "@/lib/masters";
import { TENANT } from "@/lib/types";
import {
  WEEKDAY_SHORT,
  classSectionLabel,
  loadTimetable,
  subjectLabel,
  teacherLabel,
  teachingPeriods,
  type TimetableState,
} from "@/lib/timetable";

export type TimetableReportFormat = "excel" | "pdf";

export type TimetableReportId =
  | "teacher_load"
  | "free_periods"
  | "substitution_register";

export type TimetableReportCategory = "load" | "substitution";

export type TimetableReportDef = {
  id: TimetableReportId;
  category: TimetableReportCategory;
  label: string;
  hint?: string;
};

export const TIMETABLE_REPORT_CATEGORIES: {
  id: TimetableReportCategory;
  title: string;
  headerClass: string;
}[] = [
  { id: "load", title: "Teaching load", headerClass: "bg-[#1565c0]" },
  { id: "substitution", title: "Substitution", headerClass: "bg-[#b45309]" },
];

export const TIMETABLE_REPORTS: TimetableReportDef[] = [
  {
    id: "teacher_load",
    category: "load",
    label: "Teacher load",
    hint: "Periods/week per teacher, this session",
  },
  {
    id: "free_periods",
    category: "load",
    label: "Free-period register",
    hint: "Who's unassigned at each period, by weekday",
  },
  {
    id: "substitution_register",
    category: "substitution",
    label: "Substitution register",
    hint: "Auto + manual arrangements over a date range",
  },
];

export type TimetableReportFilters = {
  academicYearCode?: string;
  /** 0=Sun..6=Sat. Omit on free_periods to cover every working weekday. */
  weekday?: number;
  fromDate?: string;
  toDate?: string;
  format: TimetableReportFormat;
  masters?: MastersState;
  timetable?: TimetableState;
};

function teachingStaff(masters: MastersState) {
  return (masters.staff ?? []).filter(
    (s) => s.stream === "teaching" && s.status === "active",
  );
}

function runTeacherLoad(masters: MastersState, tt: TimetableState, ay: string) {
  const counts = new Map<string, { periods: number; classes: Set<string> }>();
  for (const g of tt.grids) {
    if (g.academicYearCode !== ay) continue;
    for (const s of g.slots) {
      if (!s.teacherId) continue;
      const cur = counts.get(s.teacherId) ?? { periods: 0, classes: new Set() };
      cur.periods += 1;
      cur.classes.add(classSectionLabel(masters, g.classId, g.sectionId));
      counts.set(s.teacherId, cur);
    }
  }
  const rows = teachingStaff(masters)
    .map((s) => {
      const c = counts.get(s.id);
      return {
        empCode: s.empCode,
        name: s.fullName,
        periodsPerWeek: c?.periods ?? 0,
        classesCovered: c ? c.classes.size : 0,
        classList: c ? [...c.classes].sort().join(", ") : "",
      };
    })
    .sort((a, b) => b.periodsPerWeek - a.periodsPerWeek);

  return {
    columns: [
      { key: "empCode", header: "Emp code", width: 0.8 },
      { key: "name", header: "Teacher", width: 1.4 },
      { key: "periodsPerWeek", header: "Periods/week", width: 0.9, align: "right" as const },
      { key: "classesCovered", header: "Classes", width: 0.7, align: "right" as const },
      { key: "classList", header: "Class · section list", width: 2 },
    ],
    rows,
  };
}

export type FreeTeacherSlot = {
  weekday: number;
  weekdayLabel: string;
  periodNo: number;
  periodLabel: string;
  teacherId: string;
  empCode: string;
  teacherName: string;
};

/**
 * Every (weekday, period, teacher) combination where that teacher has no
 * timetable slot — the computation behind the "Free-period register"
 * export AND the live on-screen lookup in TimetableWorkspace's "Free
 * periods" tab. Kept here, not duplicated, so both stay in sync.
 */
export function computeFreeTeacherSlots(
  masters: MastersState,
  tt: TimetableState,
  ay: string,
  weekday?: number,
): FreeTeacherSlot[] {
  const weekdays =
    weekday != null ? [weekday] : tt.workingWeekdays.length ? tt.workingWeekdays : [1, 2, 3, 4, 5, 6];
  const periods = teachingPeriods(tt.bellTemplate);
  const staff = teachingStaff(masters);

  const busy = new Set<string>();
  for (const g of tt.grids) {
    if (g.academicYearCode !== ay) continue;
    for (const s of g.slots) {
      if (!s.teacherId) continue;
      busy.add(`${s.teacherId}|${s.weekday}|${s.periodNo}`);
    }
  }

  const out: FreeTeacherSlot[] = [];
  for (const wd of weekdays) {
    for (const p of periods) {
      for (const s of staff) {
        if (busy.has(`${s.id}|${wd}|${p.no}`)) continue;
        out.push({
          weekday: wd,
          weekdayLabel: WEEKDAY_SHORT[wd] ?? String(wd),
          periodNo: p.no,
          periodLabel: p.label,
          teacherId: s.id,
          empCode: s.empCode,
          teacherName: s.fullName,
        });
      }
    }
  }
  return out;
}

function runFreePeriods(
  masters: MastersState,
  tt: TimetableState,
  ay: string,
  weekday?: number,
) {
  const slots = computeFreeTeacherSlots(masters, tt, ay, weekday);
  return {
    columns: [
      { key: "weekday", header: "Day", width: 0.6 },
      { key: "period", header: "Period", width: 0.5, align: "right" as const },
      { key: "periodLabel", header: "Time", width: 0.9 },
      { key: "empCode", header: "Emp code", width: 0.8 },
      { key: "name", header: "Free teacher", width: 1.4 },
    ],
    rows: slots.map((s) => ({
      weekday: s.weekdayLabel,
      period: s.periodNo,
      periodLabel: s.periodLabel,
      empCode: s.empCode,
      name: s.teacherName,
    })),
  };
}

function runSubstitutionRegister(
  masters: MastersState,
  tt: TimetableState,
  fromDate?: string,
  toDate?: string,
) {
  const rows = tt.substitutions
    .filter((s) => (!fromDate || s.date >= fromDate) && (!toDate || s.date <= toDate))
    .sort((a, b) => a.date.localeCompare(b.date) || a.periodNo - b.periodNo)
    .map((s) => ({
      date: s.date,
      day: WEEKDAY_SHORT[s.weekday] ?? String(s.weekday),
      period: s.periodNo,
      classSection: classSectionLabel(masters, s.classId, s.sectionId),
      subject: subjectLabel(masters, s.subjectId),
      absentTeacher: teacherLabel(masters, s.absentTeacherId),
      substituteTeacher: s.substituteTeacherId
        ? teacherLabel(masters, s.substituteTeacherId)
        : "UNCOVERED",
      source: s.source,
      note: s.note,
    }));

  return {
    columns: [
      { key: "date", header: "Date", width: 0.9 },
      { key: "day", header: "Day", width: 0.5 },
      { key: "period", header: "Period", width: 0.5, align: "right" as const },
      { key: "classSection", header: "Class · Sec", width: 0.9 },
      { key: "subject", header: "Subject", width: 1 },
      { key: "absentTeacher", header: "Absent", width: 1.2 },
      { key: "substituteTeacher", header: "Substitute", width: 1.2 },
      { key: "source", header: "Source", width: 0.6 },
      { key: "note", header: "Note", width: 1.2 },
    ],
    rows,
  };
}

export function runTimetableReport(
  id: TimetableReportId,
  filters: TimetableReportFilters,
): { ok: true; message: string } | { ok: false; error: string } {
  const masters = filters.masters ?? loadMasters();
  const tt = filters.timetable ?? loadTimetable();
  const ay = filters.academicYearCode || currentAcademicYearCode(masters);
  const def = TIMETABLE_REPORTS.find((r) => r.id === id);
  const title = def?.label ?? id;

  const note = describeFilters([
    `Session ${ay}`,
    filters.weekday != null ? `Day ${WEEKDAY_SHORT[filters.weekday]}` : "",
    filters.fromDate ? `From ${filters.fromDate}` : "",
    filters.toDate ? `To ${filters.toDate}` : "",
  ]);

  let built: { columns: ReportColumn[]; rows: Record<string, string | number>[] };
  switch (id) {
    case "teacher_load":
      built = runTeacherLoad(masters, tt, ay);
      break;
    case "free_periods":
      built = runFreePeriods(masters, tt, ay, filters.weekday);
      break;
    case "substitution_register":
      built = runSubstitutionRegister(masters, tt, filters.fromDate, filters.toDate);
      break;
    default:
      return { ok: false, error: "Unknown report" };
  }

  if (!built.rows.length) {
    return { ok: false, error: "No data matches these filters" };
  }

  const result = exportFilterReport(
    {
      title,
      subtitle: `${TENANT.shortName} · Timetable`,
      filterNote: note,
      columns: built.columns,
      rows: built.rows,
      fileBaseName: `timetable_${id}`,
    },
    filters.format,
  );
  if (!result.ok) return result;
  return {
    ok: true,
    message: `${title} · ${filters.format.toUpperCase()} · ${built.rows.length} row(s)`,
  };
}
