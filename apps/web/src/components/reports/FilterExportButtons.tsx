"use client";

import {
  describeFilters,
  exportFilterReport,
  type ReportColumn,
  type ReportExportInput,
} from "@/lib/reportExport";

/** Classic red PDF file mark */
function PdfLogo({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden
      focusable="false"
    >
      <path
        fill="#E53935"
        d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"
      />
      <path fill="#FFCDD2" d="M14 2v6h6" />
      <rect x="4.5" y="12.5" width="15" height="6.5" rx="1.2" fill="#B71C1C" />
      <text
        x="12"
        y="17.4"
        textAnchor="middle"
        fill="#fff"
        fontSize="5.2"
        fontWeight="800"
        fontFamily="system-ui,Segoe UI,sans-serif"
      >
        PDF
      </text>
    </svg>
  );
}

/** Classic green Excel file mark */
function ExcelLogo({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden
      focusable="false"
    >
      <path
        fill="#217346"
        d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"
      />
      <path fill="#C8E6C9" d="M14 2v6h6" />
      <rect x="4.5" y="12.5" width="15" height="6.5" rx="1.2" fill="#0D5C2E" />
      <text
        x="12"
        y="17.4"
        textAnchor="middle"
        fill="#fff"
        fontSize="4.6"
        fontWeight="800"
        fontFamily="system-ui,Segoe UI,sans-serif"
      >
        XLS
      </text>
    </svg>
  );
}

/**
 * PDF + Excel controls for the current search/filter result set.
 * Place next to any filter bar — exports exactly the rows you pass in.
 */
export function FilterExportButtons({
  title,
  subtitle,
  filterNote,
  columns,
  rows,
  fileBaseName,
  disabled,
  className = "",
  onMessage,
}: {
  title: string;
  subtitle?: string;
  filterNote?: string;
  columns: ReportColumn[];
  rows: ReportExportInput["rows"];
  fileBaseName: string;
  disabled?: boolean;
  className?: string;
  onMessage?: (msg: string) => void;
}) {
  const empty = rows.length === 0;
  const blocked = disabled || empty;

  function run(format: "excel" | "pdf") {
    const result = exportFilterReport(
      {
        title,
        subtitle,
        filterNote: filterNote ?? describeFilters([]),
        columns,
        rows,
        fileBaseName,
      },
      format,
    );
    if (!result.ok) {
      onMessage?.(result.error);
      return;
    }
    onMessage?.(
      format === "excel"
        ? `Excel downloaded · ${rows.length} row(s)`
        : `PDF downloaded · ${rows.length} row(s)`,
    );
  }

  return (
    <div
      className={`inline-flex items-center gap-2 ${className}`}
      title={
        empty
          ? "No rows in current filter"
          : `Export ${rows.length} filtered row(s)`
      }
    >
      <span className="hidden text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] sm:inline">
        Export
      </span>
      <button
        type="button"
        disabled={blocked}
        onClick={() => run("pdf")}
        aria-label="Download PDF report of current filter"
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E53935]/35 bg-[#FFF5F5] px-2.5 text-[11px] font-bold text-[#B71C1C] transition hover:border-[#E53935] hover:bg-[#FFEBEE] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <PdfLogo className="h-5 w-5 shrink-0" />
        PDF
      </button>
      <button
        type="button"
        disabled={blocked}
        onClick={() => run("excel")}
        aria-label="Download Excel (CSV) of current filter"
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#1D6F42]/35 bg-[#F1F8F4] px-2.5 text-[11px] font-bold text-[#0B5C2E] transition hover:border-[#1D6F42] hover:bg-[#E8F5E9] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ExcelLogo className="h-5 w-5 shrink-0" />
        Excel
      </button>
    </div>
  );
}
