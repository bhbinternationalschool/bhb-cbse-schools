/**
 * A visiting staff member's month work sheet / fee statement, on the school
 * letterhead (Staff → Visiting pay → PDF). Browser only.
 */

import type { jsPDF } from "jspdf";
import { loadMasters } from "@/lib/masters";
import { drawPdfLetterhead, resolvePdfLetterhead } from "@/lib/pdfLetterhead";
import type { TdsComputation, VisitingPayBasis, WorkLineStatus } from "@/lib/visitingPay";

export type VisitingPdfInput = {
  staffName: string;
  empCode: string;
  panNo: string;
  month: string;
  basis: VisitingPayBasis;
  ratePaise: number;
  status: string;
  grossPaise: number;
  tdsPaise: number;
  netPaise: number;
  tdsDetail: TdsComputation | null;
  approvedBy: string;
  paidRef: string;
  payMode: string;
  voucherNo: string;
  lines: { date: string; note: string; qty: number; unit: string; amountPaise: number; status: WorkLineStatus; source: string }[];
};

// PDF text is drawn in Helvetica, which has no ₹ glyph.
const rs = (p: number) => `Rs ${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1] ?? m} ${m.slice(0, 4)}`;
const basisLabel = (b: VisitingPayBasis) => (b === "per_period" ? "per period taught" : b === "per_hour" ? "per hour" : "per day present");

export async function downloadVisitingSheetPdf(input: VisitingPdfInput): Promise<void> {
  const { jsPDF: JsPDF } = await import("jspdf");
  const doc: jsPDF = new JsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  const usable = pageW - margin * 2;
  const masters = loadMasters();
  const info = await resolvePdfLetterhead(masters);
  let y = drawPdfLetterhead(doc, info, margin, usable, pageW);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(32, 48, 80);
  doc.text(`Visiting fees — work sheet for ${monthLabel(input.month)}`, pageW / 2, y + 4, { align: "center" });
  y += 24;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(40, 40, 40);
  const left = [
    `Name: ${input.staffName}`,
    `Employee code: ${input.empCode || "—"}`,
    `PAN: ${input.panNo || "not on file"}`,
  ];
  const right = [
    `Paid ${basisLabel(input.basis)} at ${rs(input.ratePaise)}`,
    `Status: ${input.status}${input.approvedBy ? ` (approved by ${input.approvedBy})` : ""}`,
    input.paidRef || input.voucherNo ? `Paid: ${input.payMode || ""} ${input.paidRef || ""} ${input.voucherNo ? `· voucher ${input.voucherNo}` : ""}`.trim() : "Not paid yet",
  ];
  left.forEach((t, i) => doc.text(t, margin, y + i * 13));
  right.forEach((t, i) => doc.text(t, margin + usable / 2, y + i * 13, { maxWidth: usable / 2 }));
  y += 3 * 13 + 10;

  // Lines that count, then the ones that did not (so the person sees both).
  const cols = [
    { h: "Date", w: 70 },
    { h: "Work", w: usable - 70 - 60 - 90 - 60 },
    { h: "Qty", w: 60, right: true },
    { h: "Amount", w: 90, right: true },
    { h: "", w: 60 },
  ];
  const header = () => {
    doc.setFillColor(32, 48, 80);
    doc.rect(margin, y, usable, 18, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    let x = margin;
    for (const c of cols) {
      doc.text(c.h, c.right ? x + c.w - 4 : x + 4, y + 12, { align: c.right ? "right" : "left" });
      x += c.w;
    }
    y += 18;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(40, 40, 40);
  };
  header();
  const shown = [...input.lines].sort((a, b) => a.date.localeCompare(b.date));
  shown.forEach((l, i) => {
    const work = doc.splitTextToSize(l.note || l.source, cols[1]!.w - 8) as string[];
    const h = Math.max(16, work.length * 11 + 5);
    if (y + h > pageH - 140) {
      doc.addPage();
      y = margin;
      header();
    }
    if (i % 2 === 1) {
      doc.setFillColor(244, 246, 250);
      doc.rect(margin, y, usable, h, "F");
    }
    const dim = l.status !== "counted";
    doc.setTextColor(dim ? 140 : 40, dim ? 140 : 40, dim ? 140 : 40);
    doc.setFontSize(8.5);
    let x = margin;
    const [yy, mm, dd] = l.date.split("-");
    doc.text(`${dd}/${mm}/${yy}`, x + 4, y + 11);
    x += cols[0]!.w;
    doc.text(work, x + 4, y + 11);
    x += cols[1]!.w;
    doc.text(dim ? "—" : `${l.qty} ${l.unit}${l.qty === 1 ? "" : "s"}`, x + cols[2]!.w - 4, y + 11, { align: "right" });
    x += cols[2]!.w;
    doc.text(dim ? "—" : rs(l.amountPaise), x + cols[3]!.w - 4, y + 11, { align: "right" });
    x += cols[3]!.w;
    if (dim) doc.text(l.status === "removed" ? "removed" : l.status === "unconfirmed" ? "not confirmed" : "flagged", x + 4, y + 11);
    y += h;
  });
  if (shown.length === 0) {
    doc.setFontSize(9);
    doc.text("No work recorded this month.", margin + 4, y + 12);
    y += 18;
  }

  if (y > pageH - 170) {
    doc.addPage();
    y = margin;
  }
  y += 10;
  doc.setDrawColor(32, 48, 80);
  doc.line(margin + usable / 2, y, margin + usable, y);
  y += 14;
  const total = (label: string, value: string, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(bold ? 10.5 : 9.5);
    doc.setTextColor(40, 40, 40);
    doc.text(label, margin + usable / 2 + 4, y);
    doc.text(value, margin + usable - 4, y, { align: "right" });
    y += 14;
  };
  total("Gross fees", rs(input.grossPaise));
  total("Less TDS u/s 194J", rs(input.tdsPaise));
  total("Net payable", rs(input.netPaise), true);

  if (input.tdsDetail?.applies) {
    y += 4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(90, 90, 90);
    for (const e of input.tdsDetail.explanation) {
      const t = doc.splitTextToSize(`• ${e.replace(/₹/g, "Rs ")}`, usable) as string[];
      doc.text(t, margin, y);
      y += t.length * 10;
    }
  }

  const sigY = pageH - 70;
  doc.setFontSize(9);
  doc.setTextColor(40, 40, 40);
  doc.line(margin, sigY, margin + 150, sigY);
  doc.text("Received / signature", margin, sigY + 12);
  doc.line(margin + usable - 150, sigY, margin + usable, sigY);
  doc.text("For the school", margin + usable - 150, sigY + 12);

  doc.save(`visiting-fees-${input.month}-${(input.empCode || input.staffName).replace(/[^A-Za-z0-9]+/g, "-")}.pdf`);
}
