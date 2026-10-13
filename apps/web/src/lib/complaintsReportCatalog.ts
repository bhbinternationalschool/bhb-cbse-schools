/**
 * Complaints reports (Reports Center → Complaints), 14 Oct 2026. The
 * complaints desk was a plain list with no export at all.
 *  - register: every ticket raised in a period;
 *  - open_ageing: what is still open, how long, and whether past due-by;
 *  - summary: per category — raised, resolved, open, average days to resolve.
 * Days are IST calendar days.
 */

import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_SOURCES,
  COMPLAINT_STATUSES,
  loadComplaints,
  type ComplaintState,
  type ComplaintTicket,
} from "@/lib/complaints";
import { loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, type SisState } from "@/lib/sis";
import { exportFilterReport, type ReportColumn } from "@/lib/reportExport";
import { TENANT } from "@/lib/types";
import { refuseReportBeforeLoad } from "@/lib/reportDataGuard";
import { reportDesksFor } from "@/lib/reportDesks";

export type ComplaintsReportId = "register" | "open_ageing" | "summary";

export const COMPLAINTS_REPORTS: { id: ComplaintsReportId; label: string; category: string; hint?: string }[] = [
  { id: "register", label: "Complaints register", category: "registers", hint: "Every complaint raised in the period, with status and resolution" },
  { id: "open_ageing", label: "Open complaints (ageing)", category: "follow-up", hint: "Still open: days open, past due-by, assigned to" },
  { id: "summary", label: "Complaints by category", category: "analytics", hint: "Raised, resolved, open and average days to resolve" },
];

export type ComplaintsReportFilters = {
  fromDate?: string;
  toDate?: string;
  format: "excel" | "pdf";
  state?: ComplaintState;
  masters?: MastersState;
  sis?: SisState;
};

const OPEN = new Set(["open", "assigned", "in_progress"]);

export function istDay(at: string | number | Date = Date.now()): string {
  return new Date(new Date(at).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/** Whole calendar days from a to b (dates as YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const label = <T extends { value: string; label: string }>(list: T[], v: string) => list.find((x) => x.value === v)?.label ?? v;

/** The rows each report is built from (exported for the self-test). */
export function complaintsReportRows(
  id: ComplaintsReportId,
  tickets: ComplaintTicket[],
  ctx: { staffName: (id: string | null) => string; studentName: (id: string | null) => string; from?: string; to?: string; today: string },
): { columns: ReportColumn[]; rows: Record<string, string | number>[] } {
  const raisedIn = (t: ComplaintTicket) => (!ctx.from || t.date >= ctx.from) && (!ctx.to || t.date <= ctx.to);
  if (id === "register") {
    return {
      columns: [
        { key: "date", header: "Date" },
        { key: "raisedBy", header: "Raised by" },
        { key: "mobile", header: "Mobile" },
        { key: "student", header: "Student" },
        { key: "category", header: "Category" },
        { key: "subject", header: "Subject", width: 1.6 },
        { key: "source", header: "Source" },
        { key: "assignee", header: "Assigned to" },
        { key: "status", header: "Status" },
        { key: "resolvedOn", header: "Resolved on" },
        { key: "days", header: "Days to resolve", align: "right" },
        { key: "resolution", header: "Resolution", width: 1.6 },
      ],
      rows: tickets
        .filter(raisedIn)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((t) => {
          const resolvedOn = t.resolvedAt ? istDay(t.resolvedAt) : "";
          return {
            date: t.date,
            raisedBy: t.raisedByName,
            mobile: t.raisedByMobile,
            student: ctx.studentName(t.studentId),
            category: label(COMPLAINT_CATEGORIES, t.category),
            subject: t.subject,
            source: label(COMPLAINT_SOURCES, t.source),
            assignee: ctx.staffName(t.assignedToStaffId),
            status: label(COMPLAINT_STATUSES, t.status),
            resolvedOn,
            days: resolvedOn ? daysBetween(t.date, resolvedOn) : "",
            resolution: t.resolutionNote,
          };
        }),
    };
  }
  if (id === "open_ageing") {
    return {
      columns: [
        { key: "date", header: "Raised on" },
        { key: "daysOpen", header: "Days open", align: "right" },
        { key: "dueBy", header: "Due by" },
        { key: "overdue", header: "Past due-by" },
        { key: "category", header: "Category" },
        { key: "subject", header: "Subject", width: 1.6 },
        { key: "raisedBy", header: "Raised by" },
        { key: "mobile", header: "Mobile" },
        { key: "assignee", header: "Assigned to" },
        { key: "status", header: "Status" },
      ],
      rows: tickets
        .filter((t) => OPEN.has(t.status))
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((t) => ({
          date: t.date,
          daysOpen: daysBetween(t.date, ctx.today),
          dueBy: t.dueByDate || "",
          overdue: t.dueByDate ? (t.dueByDate < ctx.today ? `Yes · ${daysBetween(t.dueByDate, ctx.today)} day(s)` : "") : "No due date",
          category: label(COMPLAINT_CATEGORIES, t.category),
          subject: t.subject,
          raisedBy: t.raisedByName,
          mobile: t.raisedByMobile,
          assignee: ctx.staffName(t.assignedToStaffId) || "Not assigned",
          status: label(COMPLAINT_STATUSES, t.status),
        })),
    };
  }
  const map = new Map<string, { category: string; raised: number; resolved: number; open: number; days: number }>();
  for (const t of tickets.filter(raisedIn)) {
    const cat = label(COMPLAINT_CATEGORIES, t.category);
    const row = map.get(cat) ?? { category: cat, raised: 0, resolved: 0, open: 0, days: 0 };
    row.raised += 1;
    if (OPEN.has(t.status)) row.open += 1;
    else if (t.resolvedAt) {
      row.resolved += 1;
      row.days += daysBetween(t.date, istDay(t.resolvedAt));
    }
    map.set(cat, row);
  }
  return {
    columns: [
      { key: "category", header: "Category" },
      { key: "raised", header: "Raised", align: "right" },
      { key: "resolved", header: "Resolved", align: "right" },
      { key: "open", header: "Still open", align: "right" },
      { key: "avgDays", header: "Average days to resolve", align: "right" },
    ],
    rows: [...map.values()]
      .sort((a, b) => b.raised - a.raised)
      .map((r) => ({
        category: r.category,
        raised: r.raised,
        resolved: r.resolved,
        open: r.open,
        avgDays: r.resolved ? Math.round((r.days / r.resolved) * 10) / 10 : "—",
      })),
  };
}

export function runComplaintsReport(
  id: ComplaintsReportId,
  filters: ComplaintsReportFilters,
): { ok: true; message: string } | { ok: false; error: string } {
  // Not from a copy this page has not loaded (lib/reportDataGuard).
  const notLoaded = refuseReportBeforeLoad(reportDesksFor("complaints", id));
  if (notLoaded) return { ok: false, error: notLoaded };
  const state = filters.state ?? loadComplaints();
  const masters = filters.masters ?? loadMasters();
  const sis = filters.sis ?? loadSis();
  const def = COMPLAINTS_REPORTS.find((r) => r.id === id);
  if (!def) return { ok: false, error: "Unknown report" };
  const staff = (masters as { staff?: { id: string; fullName: string }[] }).staff ?? [];
  const built = complaintsReportRows(id, state.tickets, {
    staffName: (sid) => (sid ? staff.find((x) => x.id === sid)?.fullName || "" : ""),
    studentName: (sid) => (sid ? sis.students.find((x) => x.id === sid)?.fullName || "" : ""),
    from: filters.fromDate,
    to: filters.toDate,
    today: istDay(),
  });
  if (built.rows.length === 0) return { ok: false, error: id === "open_ageing" ? "No open complaints" : "No complaints in this period" };
  const r = exportFilterReport(
    {
      title: def.label,
      subtitle: `${TENANT.shortName} · Complaints`,
      filterNote: id === "open_ageing" ? `As on ${istDay()}` : [filters.fromDate && `From ${filters.fromDate}`, filters.toDate && `To ${filters.toDate}`].filter(Boolean).join(" · ") || "All dates",
      columns: built.columns,
      rows: built.rows,
      fileBaseName: `complaints_${id}`,
    },
    filters.format,
  );
  return r.ok ? { ok: true, message: `${def.label}: ${built.rows.length} row(s)` } : r;
}
