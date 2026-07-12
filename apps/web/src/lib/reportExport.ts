/**
 * Export current filter/search results as Excel-friendly CSV or PDF.
 */

import { jsPDF } from "jspdf";
import { TENANT } from "@/lib/types";

export type ReportColumn = {
  key: string;
  header: string;
  /** Relative width hint for PDF (default 1) */
  width?: number;
  align?: "left" | "right";
};

export type ReportExportInput = {
  title: string;
  subtitle?: string;
  /** e.g. "Class VI · search: rahul" */
  filterNote?: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null | undefined>[];
  fileBaseName: string;
};

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

function safeCell(v: string | number | null | undefined): string {
  if (v == null) return "";
  return String(v);
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** UTF-8 CSV with BOM — opens cleanly in Excel. */
export function downloadExcelCsv(input: ReportExportInput): void {
  const header = input.columns.map((c) => csvEscape(c.header)).join(",");
  const lines = input.rows.map((row) =>
    input.columns
      .map((c) => csvEscape(safeCell(row[c.key])))
      .join(","),
  );
  const meta = [
    csvEscape(input.title),
    csvEscape(input.subtitle ?? TENANT.shortName),
    csvEscape(input.filterNote ?? ""),
    csvEscape(`Generated ${new Date().toLocaleString("en-IN")}`),
    "",
  ];
  const body = [...meta, header, ...lines].join("\r\n");
  const blob = new Blob(["\uFEFF" + body], {
    type: "text/csv;charset=utf-8",
  });
  downloadBlob(`${input.fileBaseName}_${stamp()}.csv`, blob);
}

/** Simple multi-page PDF table of the filtered rows. */
export function downloadPdfReport(input: ReportExportInput): void {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 36;
  const usable = pageW - margin * 2;

  const totalWeight = input.columns.reduce(
    (s, c) => s + (c.width ?? 1),
    0,
  );
  const colWidths = input.columns.map(
    (c) => ((c.width ?? 1) / totalWeight) * usable,
  );

  let y = margin;
  const titleSize = 14;
  const bodySize = input.columns.length > 14 ? 5.5 : input.columns.length > 10 ? 7 : 8;
  const lineH = bodySize + 4;

  function drawHeaderBlock() {
    y = margin;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(titleSize);
    doc.setTextColor(32, 48, 80);
    doc.text(input.title, margin, y);
    y += 16;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(92, 100, 120);
    doc.text(
      input.subtitle ?? `${TENANT.shortName} · ${TENANT.city}`,
      margin,
      y,
    );
    y += 12;
    if (input.filterNote) {
      doc.text(`Filter: ${input.filterNote}`, margin, y);
      y += 12;
    }
    doc.text(
      `${input.rows.length} row(s) · ${new Date().toLocaleString("en-IN")}`,
      margin,
      y,
    );
    y += 18;
  }

  function drawTableHeader() {
    doc.setFillColor(32, 48, 80);
    doc.rect(margin, y - 9, usable, lineH + 4, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(bodySize);
    doc.setTextColor(255, 255, 255);
    let x = margin;
    input.columns.forEach((c, i) => {
      const w = colWidths[i]!;
      const align = c.align === "right" ? "right" : "left";
      doc.text(c.header, align === "right" ? x + w - 2 : x + 2, y, {
        align,
        maxWidth: w - 4,
      });
      x += w;
    });
    y += lineH + 6;
    doc.setTextColor(32, 48, 80);
    doc.setFont("helvetica", "normal");
  }

  drawHeaderBlock();
  drawTableHeader();

  if (input.rows.length === 0) {
    doc.setFontSize(10);
    doc.setTextColor(92, 100, 120);
    doc.text("No rows match the current filter.", margin, y + 8);
  }

  input.rows.forEach((row, rowIndex) => {
    if (y > pageH - margin - 20) {
      doc.addPage();
      drawHeaderBlock();
      drawTableHeader();
    }
    if (rowIndex % 2 === 1) {
      doc.setFillColor(246, 245, 239);
      doc.rect(margin, y - 9, usable, lineH + 2, "F");
    }
    let x = margin;
    input.columns.forEach((c, i) => {
      const w = colWidths[i]!;
      const text = safeCell(row[c.key]);
      const align = c.align === "right" ? "right" : "left";
      doc.text(text, align === "right" ? x + w - 2 : x + 2, y, {
        align,
        maxWidth: w - 4,
      });
      x += w;
    });
    y += lineH + 2;
  });

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(92, 100, 120);
    doc.text(
      `${TENANT.shortName} · page ${i}/${pageCount}`,
      pageW / 2,
      pageH - 16,
      { align: "center" },
    );
  }

  doc.save(`${input.fileBaseName}_${stamp()}.pdf`);
}

export function exportFilterReport(
  input: ReportExportInput,
  format: "excel" | "pdf",
): { ok: true } | { ok: false; error: string } {
  if (!input.columns.length) {
    return { ok: false, error: "Nothing to export" };
  }
  if (format === "excel") downloadExcelCsv(input);
  else downloadPdfReport(input);
  return { ok: true };
}

/** Build a short filter note from common UI filters. */
export function describeFilters(
  parts: Array<string | false | null | undefined>,
): string {
  const clean = parts.filter(Boolean) as string[];
  return clean.length ? clean.join(" · ") : "All records (no filter)";
}
