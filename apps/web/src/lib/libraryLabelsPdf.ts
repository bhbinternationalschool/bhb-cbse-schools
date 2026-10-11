/**
 * Library copy labels — an A4 sheet of 24 (3 × 8, 70 × 37 mm, the common
 * "24 per sheet" label stock). Each label carries a QR code of the accession
 * number (what the counter's scanner reads), the accession number in large
 * type for typing, the title, the location, and the school's name — so a
 * book that wanders still says whose it is (print branding rule, PR #431).
 */

import { qrDataUrlFor } from "@/lib/pdfQr";
import { TENANT } from "@/lib/types";

export type LibraryLabel = {
  accessionNo: string;
  title: string;
  location: string;
};

export const LABEL_SHEET = {
  cols: 3,
  rows: 8,
  labelW: 70,
  labelH: 37,
  pageW: 210,
  pageH: 297,
} as const;

/** Top-left corner (mm) of label `index` on its page, and which page it is on. */
export function labelPosition(index: number): { page: number; x: number; y: number } {
  const per = LABEL_SHEET.cols * LABEL_SHEET.rows;
  const page = Math.floor(index / per);
  const slot = index % per;
  const col = slot % LABEL_SHEET.cols;
  const row = Math.floor(slot / LABEL_SHEET.cols);
  const marginX = (LABEL_SHEET.pageW - LABEL_SHEET.cols * LABEL_SHEET.labelW) / 2;
  const marginY = (LABEL_SHEET.pageH - LABEL_SHEET.rows * LABEL_SHEET.labelH) / 2;
  return { page, x: marginX + col * LABEL_SHEET.labelW, y: marginY + row * LABEL_SHEET.labelH };
}

/** Skip the first `skip` labels — a part-used sheet goes back in the printer. */
export async function downloadLibraryLabelsPdf(labels: LibraryLabel[], skip = 0): Promise<void> {
  if (!labels.length) throw new Error("Choose at least one copy");
  if (labels.length > 480) throw new Error("Print 480 labels or fewer at a time");
  const start = Math.max(0, Math.min(23, Math.floor(skip) || 0));
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  let page = 0;
  for (let i = 0; i < labels.length; i += 1) {
    const l = labels[i]!;
    const pos = labelPosition(i + start);
    while (pos.page > page) {
      doc.addPage();
      page += 1;
    }
    const pad = 3;
    const qr = await qrDataUrlFor(l.accessionNo);
    const qrSize = LABEL_SHEET.labelH - pad * 2;
    doc.addImage(qr, "PNG", pos.x + pad, pos.y + pad, qrSize, qrSize);
    const tx = pos.x + pad * 2 + qrSize;
    const tw = LABEL_SHEET.labelW - (tx - pos.x) - pad;
    doc.setTextColor(32, 48, 80);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.text(doc.splitTextToSize(TENANT.shortName.toUpperCase(), tw)[0] ?? "", tx, pos.y + pad + 2.5);
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(12);
    doc.text(l.accessionNo, tx, pos.y + pad + 9);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    const titleLines = (doc.splitTextToSize(l.title || "", tw) as string[]).slice(0, 3);
    doc.text(titleLines, tx, pos.y + pad + 14);
    if (l.location) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.text((doc.splitTextToSize(`Shelf: ${l.location}`, tw) as string[])[0] ?? "", tx, pos.y + LABEL_SHEET.labelH - pad - 1);
    }
    if (i % 24 === 23) await new Promise((r) => setTimeout(r, 0));
  }
  doc.save(`library_labels_${new Date().toISOString().slice(0, 10)}.pdf`);
}
