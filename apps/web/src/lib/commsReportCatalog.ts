/**
 * Comms reports — notices and news publish registers.
 * lib/schoolComms.ts tracks every notice/news item's full publish
 * lifecycle (draft/scheduled/published/archived, audience, timestamps) but
 * nothing exportable came out of it. True WA delivery/read-receipt
 * tracking doesn't exist yet in this codebase (that's separate,
 * not-yet-built work) — these reports cover what's actually tracked today:
 * what was published, to whom, and when.
 */

import {
  describeFilters,
  exportFilterReport,
  type ReportColumn,
} from "@/lib/reportExport";
import { TENANT } from "@/lib/types";
import {
  loadSchoolComms,
  type CommsAudience,
  type SchoolCommsState,
  type SchoolNewsItem,
  type SchoolNotice,
} from "@/lib/schoolComms";

export type CommsReportFormat = "excel" | "pdf";

export type CommsReportId = "notices_register" | "news_register";

export type CommsReportCategory = "registers";

export type CommsReportDef = {
  id: CommsReportId;
  category: CommsReportCategory;
  label: string;
  hint?: string;
};

export const COMMS_REPORT_CATEGORIES: {
  id: CommsReportCategory;
  title: string;
  headerClass: string;
}[] = [{ id: "registers", title: "Registers", headerClass: "bg-[#1565c0]" }];

export const COMMS_REPORTS: CommsReportDef[] = [
  {
    id: "notices_register",
    category: "registers",
    label: "Notices register",
    hint: "Every notice — audience, status, publish date",
  },
  {
    id: "news_register",
    category: "registers",
    label: "News register",
    hint: "Every news / campus story — status, publish date",
  },
];

export type CommsReportFilters = {
  audience?: CommsAudience;
  fromDate?: string;
  toDate?: string;
  format: CommsReportFormat;
  state?: SchoolCommsState;
};

function audienceLabel(a: CommsAudience): string {
  if (a === "all") return "Everyone";
  if (a === "staff") return "Staff";
  if (a === "parents") return "Parents";
  return "Students";
}

function effectiveDate(item: { publishedAt: string; createdAt: string }): string {
  return (item.publishedAt || item.createdAt || "").slice(0, 10);
}

function inRange(
  date: string,
  fromDate?: string,
  toDate?: string,
): boolean {
  if (fromDate && date && date < fromDate) return false;
  if (toDate && date && date > toDate) return false;
  return true;
}

function runNoticesRegister(
  notices: SchoolNotice[],
  filters: CommsReportFilters,
) {
  const rows = notices.filter((n) => {
    if (filters.audience && n.audience !== filters.audience) return false;
    return inRange(effectiveDate(n), filters.fromDate, filters.toDate);
  });
  return {
    columns: [
      { key: "title", header: "Title", width: 1.6 },
      { key: "audience", header: "Audience", width: 0.8 },
      { key: "status", header: "Status", width: 0.7 },
      { key: "pinned", header: "Pinned", width: 0.5 },
      { key: "publishedOn", header: "Published on", width: 0.9 },
      { key: "createdBy", header: "Created by", width: 1 },
    ],
    rows: rows
      .sort((a, b) => effectiveDate(b).localeCompare(effectiveDate(a)))
      .map((n) => ({
        title: n.title,
        audience: audienceLabel(n.audience),
        status: n.status,
        pinned: n.pinned ? "Yes" : "",
        publishedOn: effectiveDate(n),
        createdBy: n.createdBy,
      })),
  };
}

function runNewsRegister(
  news: SchoolNewsItem[],
  filters: Omit<CommsReportFilters, "audience">,
) {
  const rows = news.filter((n) =>
    inRange(effectiveDate(n), filters.fromDate, filters.toDate),
  );
  return {
    columns: [
      { key: "title", header: "Title", width: 1.6 },
      { key: "summary", header: "Summary", width: 2 },
      { key: "status", header: "Status", width: 0.7 },
      { key: "publishedOn", header: "Published on", width: 0.9 },
      { key: "createdBy", header: "Created by", width: 1 },
    ],
    rows: rows
      .sort((a, b) => effectiveDate(b).localeCompare(effectiveDate(a)))
      .map((n) => ({
        title: n.title,
        summary: n.summary,
        status: n.status,
        publishedOn: effectiveDate(n),
        createdBy: n.createdBy,
      })),
  };
}

export function runCommsReport(
  id: CommsReportId,
  filters: CommsReportFilters,
): { ok: true; message: string } | { ok: false; error: string } {
  const state = filters.state ?? loadSchoolComms();
  const def = COMMS_REPORTS.find((r) => r.id === id);
  const title = def?.label ?? id;

  const note = describeFilters([
    filters.audience ? `Audience ${audienceLabel(filters.audience)}` : "",
    filters.fromDate ? `From ${filters.fromDate}` : "",
    filters.toDate ? `To ${filters.toDate}` : "",
  ]);

  let built: { columns: ReportColumn[]; rows: Record<string, string | number>[] };
  switch (id) {
    case "notices_register":
      built = runNoticesRegister(state.notices, filters);
      break;
    case "news_register":
      built = runNewsRegister(state.news, filters);
      break;
    default:
      return { ok: false, error: "Unknown report" };
  }

  if (!built.rows.length) {
    return { ok: false, error: "No items match these filters" };
  }

  const result = exportFilterReport(
    {
      title,
      subtitle: `${TENANT.shortName} · Communications`,
      filterNote: note,
      columns: built.columns,
      rows: built.rows,
      fileBaseName: `comms_${id}`,
    },
    filters.format,
  );
  if (!result.ok) return result;
  return {
    ok: true,
    message: `${title} · ${filters.format.toUpperCase()} · ${built.rows.length} row(s)`,
  };
}
