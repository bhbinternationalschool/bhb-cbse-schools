/**
 * Export current filter/search results as Excel-friendly CSV or PDF.
 */

import { TENANT } from "@/lib/types";
import { trackServerWork } from "@/lib/serverWork";
import {
  buildTotalsRow,
  classifyColumns,
  csvValue,
  xlsxNumFmt,
  xlsxValue,
  type ReportCellKind,
} from "@/lib/reportCells";
import { bandColumns as bandColumnsImpl, drawReportPdf } from "@/lib/pdfReportTable";
import {
  createCanvasGlyphRenderer,
  hasDevanagari,
  loadGlyphFonts,
  needsGlyphs,
} from "@/lib/pdfRichText";

export type ReportColumn = {
  key: string;
  header: string;
  /** Relative width hint for PDF (default 1) */
  width?: number;
  /** Default: right for money / number / percent columns, else left. */
  align?: "left" | "right";
  /**
   * What the column holds. Omitted = inferred from the header and every
   * value (lib/reportCells.ts): money, number, percent, date, datetime or
   * text. Identifier-like headers (roll, adm no, phone, receipt no…) stay
   * text.
   */
  type?: ReportCellKind;
  /** Add this column to the TOTAL row (true) or never (false). Default: money and count columns. */
  total?: boolean;
};

export type ReportSheet = {
  /** Truncated to Excel's 31-char sheet-name limit automatically. */
  name: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null | undefined>[];
  /** false = no automatic TOTAL row on this sheet. */
  totals?: boolean;
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
  /** false = no automatic TOTAL row (default: added when the report has money or count columns). */
  totals?: boolean;
};

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
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

/**
 * UTF-8 CSV with BOM — opens cleanly in Excel. Numbers go out plain (no ₹,
 * no grouping commas) so Excel reads them as numbers; times are IST.
 */
export function downloadExcelCsv(input: ReportExportInput): void {
  const kinds = classifyColumns(input.columns, input.rows);
  const totals = input.totals === false ? null : buildTotalsRow(input.columns, input.rows, kinds);
  const header = input.columns.map((c) => csvEscape(c.header)).join(",");
  const line = (row: Record<string, string | number | null | undefined>) =>
    input.columns.map((c, i) => csvEscape(csvValue(kinds[i]!, row[c.key]))).join(",");
  const lines = input.rows.map(line);
  if (totals) lines.push(line(totals.row));
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
  const buf = await buildXlsxReport(input);
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  downloadBlob(`${input.fileBaseName}_${stamp()}.xlsx`, blob);
}

/** The workbook bytes (split out so the self-test can read them back). */
export async function buildXlsxReport(input: ReportExportInput): Promise<ArrayBuffer> {
  const mod = await import("exceljs");
  // Bundlers hand back the namespace; Node's CJS interop puts it on default.
  type ExcelModule = typeof import("exceljs");
  const ExcelJS: ExcelModule =
    "Workbook" in mod ? (mod as ExcelModule) : (mod as unknown as { default: ExcelModule }).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = TENANT.shortName;
  wb.created = new Date();

  const usedNames = new Set<string>();
  const sheets: ReportSheet[] = [
    { name: input.title, columns: input.columns, rows: input.rows, totals: input.totals },
    ...(input.extraSheets ?? []),
  ];

  for (const sheetDef of sheets) {
    const ws = wb.addWorksheet(safeSheetName(sheetDef.name, usedNames));
    const kinds = classifyColumns(sheetDef.columns, sheetDef.rows);
    ws.columns = sheetDef.columns.map((c, i) => ({
      header: c.header,
      key: c.key,
      width: Math.max(10, Math.round((c.width ?? 1) * 14)),
      style: { numFmt: xlsxNumFmt(kinds[i]!, c, sheetDef.rows) },
    }));

    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF203050" },
    };
    headerRow.alignment = { vertical: "middle", wrapText: true };

    const rightAligned = sheetDef.columns.map(
      (c, i) => c.align === "right" || (c.align === undefined && ["money", "number", "percent"].includes(kinds[i]!)),
    );

    sheetDef.rows.forEach((row, i) => {
      const values: Record<string, string | number | Date | null> = {};
      sheetDef.columns.forEach((c, ci) => {
        values[c.key] = xlsxValue(kinds[ci]!, row[c.key]);
      });
      const r = ws.addRow(values);
      if (i % 2 === 1) {
        r.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF6F5EF" },
        };
      }
      sheetDef.columns.forEach((_, colIdx) => {
        if (rightAligned[colIdx]) {
          r.getCell(colIdx + 1).alignment = { horizontal: "right" };
        }
      });
    });

    // TOTAL row: live SUM formulas, so an edited cell re-totals.
    const totals = sheetDef.totals === false ? null : buildTotalsRow(sheetDef.columns, sheetDef.rows, kinds);
    if (totals) {
      const first = 2;
      const last = sheetDef.rows.length + 1;
      const tr = ws.addRow({});
      sheetDef.columns.forEach((c, ci) => {
        const cell = tr.getCell(ci + 1);
        if (totals.summed[ci]) {
          const col = ws.getColumn(ci + 1).letter;
          cell.value = { formula: `SUM(${col}${first}:${col}${last})`, result: Number(totals.row[c.key] ?? 0) };
          cell.alignment = { horizontal: "right" };
        } else if (totals.row[c.key] === "TOTAL") {
          cell.value = "TOTAL";
        }
      });
      tr.font = { bold: true };
      tr.border = { top: { style: "thin", color: { argb: "FF203050" } } };
      tr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8ECF4" } };
    }

    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1 + sheetDef.rows.length, column: sheetDef.columns.length },
    };
  }

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** Split wide reports into page-width column bands (see lib/pdfReportTable.ts). */
export function bandColumns(cols: ReportColumn[], usableWidth: number): ReportColumn[][] {
  return bandColumnsImpl(cols, usableWidth);
}

/** Thrown when Hindi text cannot be drawn (no browser canvas): refuse, never print junk. */
export class PdfGlyphError extends Error {}

/**
 * Multi-page PDF table of the filtered rows, with the school letterhead on
 * every page. Layout, wrapping, totals and the ₹/Hindi drawing live in
 * lib/pdfReportTable.ts and lib/pdfRichText.ts.
 */
export async function downloadPdfReport(input: ReportExportInput): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

  const sheets = [
    {
      title: input.title,
      subtitle: input.subtitle,
      filterNote: input.filterNote,
      columns: input.columns,
      rows: input.rows,
      totals: input.totals,
    },
    ...(input.extraSheets ?? []).map((x) => ({
      title: `${input.title} — ${x.name}`,
      subtitle: input.subtitle,
      filterNote: input.filterNote,
      columns: x.columns,
      rows: x.rows,
      totals: x.totals,
    })),
  ];

  const allText = sheets.flatMap((sh) => [
    sh.title,
    sh.subtitle ?? "",
    sh.filterNote ?? "",
    ...sh.columns.map((c) => c.header),
    ...sh.rows.flatMap((row) => sh.columns.map((c) => String(row[c.key] ?? ""))),
  ]);
  let renderer = null;
  if (allText.some(needsGlyphs)) {
    await loadGlyphFonts();
    renderer = createCanvasGlyphRenderer();
    if (!renderer && allText.some(hasDevanagari)) {
      throw new PdfGlyphError("This report has Hindi text, which could not be drawn here. Download it as Excel instead.");
    }
  }

  // Every exported page carries the school's letterhead — logo, name in the
  // brand navy, address.
  const { drawPdfLetterhead, resolvePdfLetterhead } = await import("@/lib/pdfLetterhead");
  const letterhead = await resolvePdfLetterhead();

  drawReportPdf(doc, sheets, {
    letterhead: (d, margin, usable, pageW) => drawPdfLetterhead(d, letterhead, margin, usable, pageW),
    renderer,
    defaultSubtitle: `${TENANT.shortName} · ${TENANT.city}`,
    footerLabel: TENANT.shortName,
    generatedAt: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
  });

  doc.save(`${input.fileBaseName}_${stamp()}.pdf`);
}

export function exportFilterReport(
  input: ReportExportInput,
  format: "excel" | "pdf",
): { ok: true } | { ok: false; error: string } {
  if (!input.columns.length) {
    return { ok: false, error: "Nothing to export" };
  }
  // The file is built after this returns. A failure used to vanish — the
  // screen had already said "exported". Now it says so, plainly.
  const work = format === "excel" ? downloadXlsxReport(input) : downloadPdfReport(input);
  void trackServerWork(
    work.catch((e: unknown) => {
      console.error("[reportExport] export failed", e);
      const why = e instanceof PdfGlyphError ? e.message : "Please try again.";
      void import("@/components/shell/Toast").then(({ pushToast }) =>
        pushToast({
          kind: "error",
          message: `"${input.title}" was NOT downloaded — the ${format === "excel" ? "Excel" : "PDF"} file could not be built. ${why}`,
          durationMs: 0,
        }),
      );
    }),
  );
  return { ok: true };
}

/** Build a short filter note from common UI filters. */
export function describeFilters(
  parts: Array<string | false | null | undefined>,
): string {
  const clean = parts.filter(Boolean) as string[];
  return clean.length ? clean.join(" · ") : "All records (no filter)";
}
