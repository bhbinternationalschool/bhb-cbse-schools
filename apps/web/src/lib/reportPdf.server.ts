/**
 * A tabular report as a PDF, drawn on the server.
 *
 * One renderer for every report kind the command desk can send: letterhead,
 * title and subtitle, a repeating column header, rows that wrap, page
 * breaks, totals under the table, and on every page a stamp saying who
 * requested it and when. The stamp is the point — a PDF is forwarded far
 * more easily than a screen is photographed.
 *
 * Landscape when the columns are many; Devanagari falls back to the shipped
 * font when a cell needs it (names typed in Hindi), Helvetica otherwise.
 */
import "server-only";
import { jsPDF } from "jspdf";
import { drawPdfLetterhead, resolvePdfLetterhead } from "@/lib/pdfLetterhead";
import { ensureDevanagariFont, FONT_FAMILY, hasDevanagari } from "@/lib/pdfDevanagari";
import type { MastersState } from "@/lib/masters";
import type { ReportTable } from "@/lib/erpReports";

export type ReportPdfStamp = { requestedBy: string; channel: "whatsapp" | "app"; atIso: string };

export async function renderTableReportPdf(table: ReportTable, stamp: ReportPdfStamp, masters?: MastersState): Promise<Buffer> {
  const landscape = table.columns.length > 6;
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: landscape ? "landscape" : "portrait" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 36;
  const usable = pageW - margin * 2;

  const needsDevanagari = [table.title, table.subtitle, ...table.rows.flatMap((r) => Object.values(r))].some(hasDevanagari);
  const devanagari = needsDevanagari ? await ensureDevanagariFont(doc) : false;
  const font = (bold: boolean, text?: string) => {
    if (devanagari && text && hasDevanagari(text)) doc.setFont(FONT_FAMILY, bold ? "bold" : "normal");
    else doc.setFont("helvetica", bold ? "bold" : "normal");
  };

  const letterhead = await resolvePdfLetterhead(masters);
  // Column widths: scale the suggested widths to the usable width.
  const suggested = table.columns.reduce((s, c) => s + (c.width ?? 30), 0);
  const widths = table.columns.map((c) => ((c.width ?? 30) / suggested) * usable);

  const stampLine = `Requested by ${stamp.requestedBy} · ${stamp.atIso.replace("T", " ").slice(0, 16)} · via ${stamp.channel === "app" ? "the ERP app" : "WhatsApp"}`;
  const rowH = 16;
  let y = 0;
  let page = 1;

  const drawHeader = () => {
    y = drawPdfLetterhead(doc, letterhead, margin, usable, pageW) + 10;
    font(true, table.title);
    doc.setFontSize(14).setTextColor(0, 0, 0);
    doc.text(table.title, margin, y);
    y += 16;
    font(false, table.subtitle);
    doc.setFontSize(9.5).setTextColor(70, 70, 70);
    doc.text(table.subtitle, margin, y);
    y += 14;
    // Column header
    doc.setFillColor(238, 238, 232);
    doc.rect(margin, y - 11, usable, rowH, "F");
    doc.setFontSize(8.5).setTextColor(0, 0, 0);
    let x = margin;
    table.columns.forEach((c, i) => {
      font(true, c.label);
      doc.text(c.label, c.align === "right" ? x + widths[i]! - 4 : x + 4, y, { align: c.align === "right" ? "right" : "left" });
      x += widths[i]!;
    });
    y += rowH - 6;
  };
  const drawFooter = () => {
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(120, 120, 120);
    doc.text(stampLine, margin, pageH - 18);
    doc.text(`Page ${page}`, pageW - margin, pageH - 18, { align: "right" });
  };

  drawHeader();
  doc.setFontSize(8.5).setTextColor(0, 0, 0);
  for (const row of table.rows) {
    // Wrap the widest cell to decide the row height.
    const cellLines = table.columns.map((c, i) => doc.splitTextToSize(String(row[c.key] ?? ""), widths[i]! - 8) as string[]);
    const lines = Math.max(1, ...cellLines.map((l) => l.length));
    const h = 4 + lines * 11;
    if (y + h > pageH - 40) {
      drawFooter();
      doc.addPage();
      page += 1;
      drawHeader();
    }
    let x = margin;
    table.columns.forEach((c, i) => {
      const text = cellLines[i]!;
      font(false, text.join(" "));
      doc.text(text, c.align === "right" ? x + widths[i]! - 4 : x + 4, y + 8, { align: c.align === "right" ? "right" : "left" });
      x += widths[i]!;
    });
    y += h;
    doc.setDrawColor(225, 225, 220);
    doc.line(margin, y, margin + usable, y);
  }
  if (!table.rows.length) {
    font(false);
    doc.setTextColor(110, 110, 110);
    doc.text("No rows.", margin + 4, y + 10);
    y += 20;
  }
  y += 12;
  for (const line of table.footer) {
    if (y > pageH - 40) {
      drawFooter();
      doc.addPage();
      page += 1;
      drawHeader();
    }
    font(true, line);
    doc.setFontSize(9).setTextColor(0, 0, 0);
    doc.text(line, margin, y);
    y += 13;
  }
  drawFooter();
  return Buffer.from(doc.output("arraybuffer"));
}
