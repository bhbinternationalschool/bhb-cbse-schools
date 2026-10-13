/**
 * Teaching reports (Reports Center → Teaching), 14 Oct 2026.
 *
 * Syllabus coverage and teacher period delivery were on screen only (the
 * Teaching desk's coverage tab and the syllabus plan's bars) — nothing a
 * head of school could download or send. Same measures as those screens:
 *  - coverage per chapter from computeSyllabusProgress / syllabusCoverage
 *    (a chapter taught with no planned periods counts half, never done);
 *  - delivery from the published timetable's expected periods against the
 *    period logs (computeDelivery / summarizeCoverage). Days with no
 *    published timetable are counted and named, never read as delivered.
 */

import { exportFilterReport, type ReportColumn } from "@/lib/reportExport";
import { currentAcademicYearCode, loadMasters, type MastersState } from "@/lib/masters";
import {
  computeDelivery,
  computeSyllabusProgress,
  istDateOf,
  loadTeaching,
  resolveExpectedPeriods,
  summarizeByTeacher,
  summarizeCoverage,
  syllabusCoverage,
  type PeriodDelivery,
  type TeachingState,
} from "@/lib/teaching";
import { loadTimetable, type TimetableState } from "@/lib/timetable";
import { TENANT } from "@/lib/types";
import { refuseReportBeforeLoad } from "@/lib/reportDataGuard";
import { reportDesksFor } from "@/lib/reportDesks";

export type TeachingReportId = "syllabus_coverage" | "chapter_status" | "period_delivery";
export type TeachingReportFormat = "excel" | "pdf";

export const TEACHING_REPORTS: { id: TeachingReportId; label: string; category: string; hint?: string }[] = [
  {
    id: "syllabus_coverage",
    label: "Syllabus coverage",
    category: "syllabus",
    hint: "Per class and subject: chapters complete, in progress, not started, %",
  },
  {
    id: "chapter_status",
    label: "Chapter status",
    category: "syllabus",
    hint: "Each chapter: status, periods taught vs planned, last taught",
  },
  {
    id: "period_delivery",
    label: "Period delivery by teacher",
    category: "delivery",
    hint: "Timetabled periods taught, substituted, missed, not logged",
  },
];

export type TeachingReportFilters = {
  academicYearCode?: string;
  classId?: string;
  fromDate?: string;
  toDate?: string;
  /** Limit period delivery to one teacher (a teacher sees their own). */
  staffId?: string;
  format: TeachingReportFormat;
  masters?: MastersState;
  teaching?: TeachingState;
  timetable?: TimetableState;
};

const name = (list: { id: string; name?: string; nameEn?: string; fullName?: string }[] | undefined, id: string) => {
  const x = (list ?? []).find((r) => r.id === id);
  return x?.name || x?.nameEn || x?.fullName || id;
};

const STATUS_LABEL: Record<string, string> = {
  complete: "Complete",
  in_progress: "In progress",
  not_started: "Not started",
  unknown: "Taught (no plan)",
};

/** IST calendar dates from..to (inclusive), capped at 400 days. */
function istDates(from: string, to: string): string[] {
  const out: string[] = [];
  if (!from || !to || to < from) return out;
  const cursor = new Date(`${from}T12:00:00Z`);
  while (out.length < 400) {
    const d = cursor.toISOString().slice(0, 10);
    if (d > to) break;
    out.push(d);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export function runTeachingReport(
  id: TeachingReportId,
  filters: TeachingReportFilters,
): { ok: true; message: string } | { ok: false; error: string } {
  // Not from a copy this page has not loaded (lib/reportDataGuard).
  const notLoaded = refuseReportBeforeLoad(reportDesksFor("teaching", id));
  if (notLoaded) return { ok: false, error: notLoaded };

  const masters = filters.masters ?? loadMasters();
  const state = filters.teaching ?? loadTeaching();
  const ay = filters.academicYearCode || currentAcademicYearCode(masters);
  const def = TEACHING_REPORTS.find((r) => r.id === id);
  if (!def) return { ok: false, error: "Unknown report" };

  let columns: ReportColumn[] = [];
  let rows: Record<string, string | number>[] = [];
  const noteParts = [`Session ${ay}`, filters.classId ? `Class ${name(masters.classes, filters.classId)}` : "All classes"];

  const plans = [
    ...new Map(
      state.units
        .filter((u) => u.isActive && u.academicYearCode === ay && (!filters.classId || u.classId === filters.classId))
        .map((u) => [`${u.classId}|${u.subjectId}`, { classId: u.classId, subjectId: u.subjectId }]),
    ).values(),
  ];
  const classOrder = (cid: string) => masters.classes.find((c) => c.id === cid)?.sortOrder ?? 9999;
  plans.sort((a, b) => classOrder(a.classId) - classOrder(b.classId) || name(masters.subjects, a.subjectId).localeCompare(name(masters.subjects, b.subjectId)));

  if (id === "syllabus_coverage") {
    columns = [
      { key: "className", header: "Class" },
      { key: "subject", header: "Subject" },
      { key: "chapters", header: "Chapters", align: "right" },
      { key: "complete", header: "Complete", align: "right" },
      { key: "partial", header: "In progress", align: "right" },
      { key: "notStarted", header: "Not started", align: "right" },
      { key: "periods", header: "Periods taught", align: "right" },
      { key: "percent", header: "Coverage %", align: "right" },
    ];
    rows = plans.map((p) => {
      const prog = computeSyllabusProgress({ state, academicYearCode: ay, classId: p.classId, subjectId: p.subjectId });
      const cover = syllabusCoverage(prog.units);
      return {
        className: name(masters.classes, p.classId),
        subject: name(masters.subjects, p.subjectId),
        chapters: cover.total,
        complete: cover.complete,
        partial: cover.partial,
        notStarted: cover.notStarted,
        periods: prog.units.reduce((s, u) => s + u.periodsTaught, 0),
        percent: `${cover.percent}%`,
      };
    });
  } else if (id === "chapter_status") {
    columns = [
      { key: "className", header: "Class" },
      { key: "subject", header: "Subject" },
      { key: "code", header: "Ch." },
      { key: "chapter", header: "Chapter", width: 2 },
      { key: "status", header: "Status" },
      { key: "source", header: "Set by" },
      { key: "taught", header: "Periods taught", align: "right" },
      { key: "planned", header: "Planned", align: "right" },
      { key: "last", header: "Last taught" },
    ];
    for (const p of plans) {
      const prog = computeSyllabusProgress({ state, academicYearCode: ay, classId: p.classId, subjectId: p.subjectId });
      for (const u of prog.units) {
        rows.push({
          className: name(masters.classes, p.classId),
          subject: name(masters.subjects, p.subjectId),
          code: u.unit.code || "",
          chapter: u.unit.title,
          status: STATUS_LABEL[u.status] ?? u.status,
          source: u.statusSource === "marked" ? "Teacher" : "Period logs",
          taught: u.periodsTaught,
          planned: u.unit.plannedPeriods > 0 ? u.unit.plannedPeriods : "—",
          last: u.lastTaughtOn || "",
        });
      }
    }
  } else {
    const timetable = filters.timetable ?? loadTimetable();
    const today = istDateOf();
    const from = filters.fromDate || `${today.slice(0, 7)}-01`;
    const to = [filters.toDate || today, today].sort()[0]!;
    const all: PeriodDelivery[] = [];
    const skipped: string[] = [];
    for (const d of istDates(from, to)) {
      const res = resolveExpectedPeriods({ timetable, masters, academicYearCode: ay, date: d, staffId: filters.staffId || undefined });
      if (!res.ok) {
        if (res.reason === "no_published_timetable") skipped.push(d);
        continue;
      }
      all.push(
        ...computeDelivery({ expected: res.periods, logs: state.logs, academicYearCode: ay, policy: state.policy }).filter(
          (r) => !filters.classId || r.expected.classId === filters.classId,
        ),
      );
    }
    if (all.length === 0 && skipped.length > 0) {
      return { ok: false, error: `No published timetable for ${skipped.length} day(s) in this range — delivery cannot be measured.` };
    }
    noteParts.push(`${from} → ${to}`);
    if (skipped.length) noteParts.push(`${skipped.length} day(s) with no published timetable left out`);
    columns = [
      { key: "teacher", header: "Teacher" },
      { key: "expected", header: "Timetabled periods", align: "right" },
      { key: "delivered", header: "Taught", align: "right" },
      { key: "substituted", header: "Substituted", align: "right" },
      { key: "notDelivered", header: "Not taught", align: "right" },
      { key: "unlogged", header: "Not logged", align: "right" },
      { key: "percent", header: "Delivery %", align: "right" },
      { key: "late", header: "Late starts", align: "right" },
    ];
    const staff = (masters as { staff?: { id: string; fullName: string }[] }).staff;
    rows = summarizeByTeacher(all).map(({ staffId, summary }) => ({
      teacher: name(staff, staffId),
      expected: summary.expectedPeriods,
      delivered: summary.delivered,
      substituted: summary.substituted,
      notDelivered: summary.notDelivered,
      unlogged: summary.unlogged,
      percent: summary.deliveryPercent === null ? "—" : `${summary.deliveryPercent}%`,
      late: summary.lateStarts,
    }));
    const school = summarizeCoverage(all);
    if (rows.length > 1) {
      rows.push({
        teacher: "TOTAL",
        expected: school.expectedPeriods,
        delivered: school.delivered,
        substituted: school.substituted,
        notDelivered: school.notDelivered,
        unlogged: school.unlogged,
        percent: school.deliveryPercent === null ? "—" : `${school.deliveryPercent}%`,
        late: school.lateStarts,
      });
    }
  }

  if (rows.length === 0) {
    return {
      ok: false,
      error: id === "period_delivery" ? "No timetabled periods in this range" : "No syllabus plan entered for this scope yet",
    };
  }
  const r = exportFilterReport(
    {
      title: def.label,
      subtitle: `${TENANT.shortName} · Teaching`,
      filterNote: noteParts.join(" · "),
      columns,
      rows,
      fileBaseName: `teaching_${id}`,
    },
    filters.format,
  );
  return r.ok ? { ok: true, message: `${def.label}: ${rows.length} row(s)` } : r;
}
