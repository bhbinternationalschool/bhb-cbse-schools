/**
 * The table every "Export → PDF" button draws (lib/reportExport.ts).
 *
 * What changed on 14 Oct 2026, and why:
 *  - Rows grow to fit. A long name or note used to be wrapped by jsPDF onto
 *    several lines while the row advanced one line, so it printed over the
 *    next rows. Each cell is now wrapped to its column (at most
 *    MAX_CELL_LINES, the last ending in "…") and the row is as tall as its
 *    tallest cell.
 *  - ₹, Hindi and arrows print (lib/pdfRichText.ts) instead of "¹" and junk.
 *  - Numbers, money and percentages are right-aligned and printed the
 *    Indian way (12,34,567.00); dates print DD-MM-YYYY and times in IST
 *    (lib/reportCells.ts).
 *  - A TOTAL row closes reports with money (and count) columns, unless the
 *    report already carries its own total.
 *  - Wide reports keep the row's identity on every band: a leading S.No /
 *    Roll / Adm no column brings the name column with it, so pages 2 and 3
 *    of a month register are not a grid of marks with no student name.
 *  - Extra sheets (a reconciliation pack's "By mode", "By class") print as
 *    their own sections instead of being dropped from the PDF.
 *
 * Dependency-free on purpose (type-only jsPDF import + two sibling modules):
 * its browser test loads it outside the app.
 */

import type { jsPDF } from "jspdf";
import {
  buildTotalsRow,
  classifyColumns,
  displayValue,
  type CellRaw,
  type ReportCellKind,
  type TypedColumn,
} from "./reportCells";
import { drawLine, measureLine, wrapText, type GlyphRenderer, type Rgb, type TextStyle } from "./pdfRichText";

export type PdfTableColumn = TypedColumn & {
  /** Relative width hint (default 1). */
  width?: number;
  align?: "left" | "right";
};

export type PdfTableSheet = {
  title: string;
  subtitle?: string;
  filterNote?: string;
  columns: PdfTableColumn[];
  rows: Record<string, CellRaw>[];
  /** false = no automatic TOTAL row. */
  totals?: boolean;
};

export type PdfTableOptions = {
  /** Draws the letterhead at the top of a page; returns the y to continue from. */
  letterhead?: (doc: jsPDF, margin: number, usable: number, pageW: number) => number;
  renderer: GlyphRenderer | null;
  /** Line under the title when a sheet has no subtitle, e.g. "BHB · Varanasi". */
  defaultSubtitle: string;
  /** Footer label, e.g. the school's short name. */
  footerLabel: string;
  /** e.g. "14/10/2026, 10:42:05 am" */
  generatedAt: string;
};

const NAVY: Rgb = [32, 48, 80];
const MUTED: Rgb = [92, 100, 120];
const WHITE: Rgb = [255, 255, 255];
const AMBER: Rgb = [180, 83, 9];
const MIN_COL_WIDTH_PT = 46;
const MAX_CELL_LINES = 6;
const MARGIN = 36;
/** Space inside each side of a cell. */
const PAD = 4;

const KEY_COL = /^(#|s\.?\s*no\.?|sr\.?\s*no\.?|sl\.?\s*no\.?|roll(\s*no\.?)?|adm(ission)?\.?\s*no\.?|sno)$/i;

/**
 * Split a wide table into page-width column bands. Each band repeats the
 * identifying column(s) — the first, plus the second when the first is only
 * a serial / roll / admission number — so every page says whose row it is.
 */
export function bandColumns<C extends { header: string }>(cols: C[], usableWidth: number): C[][] {
  if (cols.length <= 1) return [cols];
  const keyCount = cols.length >= 3 && KEY_COL.test(cols[0]!.header.trim()) ? 2 : 1;
  const keys = cols.slice(0, keyCount);
  const rest = cols.slice(keyCount);
  const perBand = Math.max(1, Math.floor((usableWidth - keyCount * MIN_COL_WIDTH_PT) / MIN_COL_WIDTH_PT));
  if (rest.length <= perBand) return [cols];
  const bands: C[][] = [];
  for (let i = 0; i < rest.length; i += perBand) bands.push([...keys, ...rest.slice(i, i + perBand)]);
  return bands;
}

type PreparedSheet = {
  sheet: PdfTableSheet;
  kinds: Map<string, ReportCellKind>;
  totals: Record<string, CellRaw> | null;
};

function prepare(sheet: PdfTableSheet): PreparedSheet {
  const kinds = classifyColumns(sheet.columns, sheet.rows);
  const kindMap = new Map(sheet.columns.map((c, i) => [c.key, kinds[i]!]));
  const totals = sheet.totals === false ? null : buildTotalsRow(sheet.columns, sheet.rows, kinds)?.row ?? null;
  return { sheet, kinds: kindMap, totals };
}

const isNumericKind = (k: ReportCellKind | undefined) => k === "money" || k === "number" || k === "percent";

/**
 * Width weights from what the columns hold, for columns the report gave no
 * width: a serial number gets a sliver, a name or note gets room. Measured
 * in characters (longest of the header's words and up to 300 cells), so it
 * needs no font.
 */
function autoColumnWeights(sheet: PdfTableSheet, kinds: Map<string, ReportCellKind>): Map<string, number> {
  const out = new Map<string, number>();
  const sample = sheet.rows.slice(0, 300);
  for (const c of sheet.columns) {
    const kind = kinds.get(c.key) ?? "text";
    const headerWord = Math.max(...c.header.split(/\s+/).map((w) => w.length), 1);
    const lens = sample.map((row) => displayValue(kind, row[c.key]).length).sort((a, b) => a - b);
    // 90th percentile, so one long outlier does not take the page.
    const typical = lens.length ? lens[Math.min(lens.length - 1, Math.floor(lens.length * 0.9))]! : 0;
    const chars = Math.max(headerWord, Math.min(typical, 40));
    out.set(c.key, Math.min(4, Math.max(0.45, chars / 9)));
  }
  return out;
}

/** Draw every sheet into `doc` (first sheet on the current page). */
export function drawReportPdf(doc: jsPDF, sheets: PdfTableSheet[], opts: PdfTableOptions): void {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const usable = pageW - MARGIN * 2;
  const r = opts.renderer;
  let firstPage = true;

  const newPage = () => {
    if (!firstPage) doc.addPage();
    firstPage = false;
  };

  for (const prepared of sheets.map(prepare)) {
    const { sheet, kinds, totals } = prepared;
    const bands = bandColumns(sheet.columns, usable);
    const autoWeights = autoColumnWeights(sheet, kinds);

    bands.forEach((cols, bandIndex) => {
      newPage();
      const weights = cols.map((c) => c.width ?? autoWeights.get(c.key) ?? 1);
      const totalWeight = weights.reduce((s, w) => s + w, 0);
      const colWidths = weights.map((w) => (w / totalWeight) * usable);
      const bodySize = cols.length > 10 ? 7 : 8;
      const lineH = bodySize + 3;
      const aligns = cols.map((c) => c.align ?? (isNumericKind(kinds.get(c.key)) ? "right" : "left"));
      let y = MARGIN;

      const text = (s: string, x: number, yy: number, style: TextStyle, align: "left" | "right" = "left") =>
        drawLine(doc, s, x, yy, style, r, align);

      function headerBlock() {
        y = opts.letterhead ? opts.letterhead(doc, MARGIN, usable, pageW) + 4 : MARGIN + 10;
        const titleStyle: TextStyle = { sizePt: 14, bold: true, color: NAVY };
        for (const line of wrapText(doc, sheet.title, usable, titleStyle, r, 2)) {
          text(line, MARGIN, y, titleStyle);
          y += 16;
        }
        const small: TextStyle = { sizePt: 9, bold: false, color: MUTED };
        const notes = [
          sheet.subtitle ?? opts.defaultSubtitle,
          sheet.filterNote ? `Filter: ${sheet.filterNote}` : "",
          `${sheet.rows.length} row(s) · ${opts.generatedAt}`,
        ].filter(Boolean);
        for (const n of notes) {
          for (const line of wrapText(doc, n, usable, small, r, 3)) {
            text(line, MARGIN, y, small);
            y += 12;
          }
        }
        if (bands.length > 1) {
          text(
            `Columns ${bandIndex + 1}/${bands.length} of this report — same rows, next set of columns on the following page(s).`,
            MARGIN,
            y,
            { sizePt: 9, bold: false, color: AMBER },
          );
          y += 12;
        }
        y += 6;
      }

      /** Wrapped lines per cell, and the row height they need. */
      function layoutRow(values: string[], style: TextStyle, maxLines: number) {
        const lines = values.map((v, i) => wrapText(doc, v, colWidths[i]! - 2 * PAD, style, r, maxLines));
        const n = Math.max(1, ...lines.map((l) => l.length));
        return { lines, height: 4 + bodySize + (n - 1) * lineH + 3 };
      }

      function paintRow(lines: string[][], height: number, style: TextStyle, fill: Rgb | null, topRule = false) {
        if (fill) {
          doc.setFillColor(fill[0], fill[1], fill[2]);
          doc.rect(MARGIN, y, usable, height, "F");
        }
        if (topRule) {
          doc.setDrawColor(NAVY[0], NAVY[1], NAVY[2]);
          doc.setLineWidth(0.8);
          doc.line(MARGIN, y, MARGIN + usable, y);
        }
        let x = MARGIN;
        cols.forEach((_, i) => {
          const w = colWidths[i]!;
          const right = aligns[i] === "right";
          (lines[i] ?? []).forEach((line, k) => {
            text(line, right ? x + w - PAD : x + PAD, y + 3 + bodySize + k * lineH, style, right ? "right" : "left");
          });
          x += w;
        });
        y += height;
      }

      const headStyle: TextStyle = { sizePt: bodySize, bold: true, color: WHITE };
      const head = layoutRow(cols.map((c) => c.header), headStyle, 3);
      function tableHeader() {
        paintRow(head.lines, head.height, headStyle, NAVY);
        y += 2;
      }

      const bottom = pageH - MARGIN - 20;
      headerBlock();
      tableHeader();

      if (sheet.rows.length === 0) {
        text("No rows match the current filter.", MARGIN, y + 10, { sizePt: 10, bold: false, color: MUTED });
      }

      const bodyStyle: TextStyle = { sizePt: bodySize, bold: false, color: NAVY };
      sheet.rows.forEach((row, rowIndex) => {
        const values = cols.map((c) => displayValue(kinds.get(c.key) ?? "text", row[c.key]));
        const laid = layoutRow(values, bodyStyle, MAX_CELL_LINES);
        if (y + laid.height > bottom) {
          doc.addPage();
          headerBlock();
          tableHeader();
        }
        paintRow(laid.lines, laid.height, bodyStyle, rowIndex % 2 === 1 ? [246, 245, 239] : null);
      });

      if (totals) {
        const totalStyle: TextStyle = { sizePt: bodySize, bold: true, color: NAVY };
        const values = cols.map((c) => displayValue(kinds.get(c.key) ?? "text", totals[c.key]));
        // The label may sit in a column outside this band: put it first.
        if (!values.some((v) => v === "TOTAL")) values[0] = values[0] ? values[0] : "TOTAL";
        const laid = layoutRow(values, totalStyle, 2);
        if (y + laid.height > bottom) {
          doc.addPage();
          headerBlock();
          tableHeader();
        }
        paintRow(laid.lines, laid.height, totalStyle, [232, 236, 244], true);
      }
    });
  }

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const footer: TextStyle = { sizePt: 8, bold: false, color: MUTED };
    const label = `${opts.footerLabel} · page ${i}/${pageCount}`;
    drawLine(doc, label, pageW / 2 + measureLine(doc, label, footer, r) / 2, pageH - 16, footer, r, "right");
  }
}
