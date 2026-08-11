/**
 * Export current filter/search results as Excel-friendly CSV or PDF.
 */

import { TENANT } from "@/lib/types";

export type ReportColumn = {
  key: string;
  header: string;
  /** Relative width hint for PDF (default 1) */
  width?: number;
  align?: "left" | "right";
};

export type ReportSheet = {
  /** Truncated to Excel's 31-char sheet-name limit automatically. */
  name: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null | undefined>[];
};

export type ReportExportInput = {
  title: string;
  subtitle?: string;
  /** e.g. "Class VI · search: rahul" */
  filterNote?: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null | undefined>[];
  fileBaseName: string;
  /** Extra worksheets after the main one — same workbook, e.g. a fee
   * reconciliation pack's "By mode" / "By class" breakdown sheets
   * alongside the full receipt list. XLSX only; ignored for CSV/PDF. */
  extraSheets?: ReportSheet[];
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
  const body = [header, ...lines].join("\r\n");
  const blob = new Blob(["\uFEFF" + body], {
    type: "text/csv;charset=utf-8",
  });
  downloadBlob(`${input.fileBaseName}_${stamp()}.csv`, blob);
}

/** Excel worksheet names: max 31 chars, and `[]:*?/\` are illegal. */
export function safeSheetName(name: string, usedNames: Set<string>): string {
  const cleaned = (name || "Sheet").replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Sheet";
  if (!usedNames.has(cleaned)) {
    usedNames.add(cleaned);
    return cleaned;
  }
  for (let i = 2; i < 100; i++) {
    const suffix = ` (${i})`;
    const candidate = cleaned.slice(0, 31 - suffix.length) + suffix;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
  }
  return cleaned;
}

/**
 * Real .xlsx via exceljs — everything under the "Excel" button used to be
 * a CSV file with an .xlsx-adjacent look, not an actual workbook: no bold
 * headers, no frozen header row, no column widths, and no way to ship more
 * than one sheet (a fee reconciliation pack needing a summary sheet plus
 * the full receipt list had nowhere to put the second sheet). This builds
 * one workbook with the main sheet plus any `extraSheets`.
 */
export async function downloadXlsxReport(input: ReportExportInput): Promise<void> {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = TENANT.shortName;
  wb.created = new Date();

  const usedNames = new Set<string>();
  const sheets: ReportSheet[] = [
    { name: input.title, columns: input.columns, rows: input.rows },
    ...(input.extraSheets ?? []),
  ];

  for (const sheetDef of sheets) {
    const ws = wb.addWorksheet(safeSheetName(sheetDef.name, usedNames));
    ws.columns = sheetDef.columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: Math.max(10, Math.round((c.width ?? 1) * 14)),
    }));

    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF203050" },
    };
    headerRow.alignment = { vertical: "middle" };

    sheetDef.rows.forEach((row, i) => {
      const r = ws.addRow(row);
      if (i % 2 === 1) {
        r.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF6F5EF" },
        };
      }
      sheetDef.columns.forEach((c, colIdx) => {
        if (c.align === "right") {
          r.getCell(colIdx + 1).alignment = { horizontal: "right" };
        }
      });
    });

    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheetDef.columns.length },
    };
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  downloadBlob(`${input.fileBaseName}_${stamp()}.xlsx`, blob);
}

/**
 * A wide report (more columns than comfortably fit one landscape A4 table)
 * used to silently drop every column past the first 12 that matched a
 * hardcoded priority list — the PDF looked complete but was missing data
 * with no indication anything was cut. Instead, split wide reports into
 * column "bands": each band repeats the first (identifying) column plus a
 * page-width slice of the rest, so every column ends up in the PDF
 * somewhere — nothing is silently dropped — and each band's header says
 * which slice and of how many it is.
 */
const MIN_COL_WIDTH_PT = 46;

export function bandColumns(
  cols: ReportColumn[],
  usableWidth: number,
): ReportColumn[][] {
  if (cols.length <= 1) return [cols];
  const maxDataColsPerBand = Math.max(
    1,
    Math.floor((usableWidth - MIN_COL_WIDTH_PT) / MIN_COL_WIDTH_PT),
  );
  const [keyCol, ...rest] = cols;
  if (rest.length <= maxDataColsPerBand) return [cols];

  const bands: ReportColumn[][] = [];
  for (let i = 0; i < rest.length; i += maxDataColsPerBand) {
    bands.push([keyCol!, ...rest.slice(i, i + maxDataColsPerBand)]);
  }
  return bands;
}

/** Simple multi-page PDF table of the filtered rows. */
export async function downloadPdfReport(input: ReportExportInput): Promise<void> {
  const { jsPDF } = await import("jspdf");

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 36;
  const usable = pageW - margin * 2;

  const bands = bandColumns(input.columns, usable);
  const titleSize = 14;

  bands.forEach((cols, bandIndex) => {
    if (bandIndex > 0) doc.addPage();

    const totalWeight = cols.reduce((s, c) => s + (c.width ?? 1), 0);
    const colWidths = cols.map((c) => ((c.width ?? 1) / totalWeight) * usable);
    const bodySize = cols.length > 10 ? 7 : 8;
    const lineH = bodySize + 4;
    let y = margin;

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
      y += 12;
      if (bands.length > 1) {
        doc.setTextColor(180, 83, 9);
        doc.text(
          `Columns ${bandIndex + 1}/${bands.length} of this report — same rows, ` +
            `next set of columns on the following page(s).`,
          margin,
          y,
        );
        y += 12;
        doc.setTextColor(92, 100, 120);
      }
      y += 6;
    }

    function drawTableHeader() {
      doc.setFillColor(32, 48, 80);
      doc.rect(margin, y - 9, usable, lineH + 4, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(bodySize);
      doc.setTextColor(255, 255, 255);
      let x = margin;
      cols.forEach((c, i) => {
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
      cols.forEach((c, i) => {
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
  if (format === "excel") void downloadXlsxReport(input);
  else void downloadPdfReport(input);
  return { ok: true };
}

/** Build a short filter note from common UI filters. */
export function describeFilters(
  parts: Array<string | false | null | undefined>,
): string {
  const clean = parts.filter(Boolean) as string[];
  return clean.length ? clean.join(" · ") : "All records (no filter)";
}
