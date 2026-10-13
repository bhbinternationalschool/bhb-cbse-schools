/**
 * One member of staff's payslip for one month, as a PDF drawn on the server.
 *
 * The same sheet the web prints (components/payroll/PrintPayslipsPanel.tsx
 * → PrintablePayslip): the school letterhead, employee block, earnings and
 * deductions side by side, employer contributions, attendance and advance
 * notes, net pay, and the two signature lines. The staff app downloads it
 * from GET /api/v1/staff/payslips/:month/pdf.
 *
 * Helvetica has no ₹ glyph, so money prints as "Rs 12,345". A name typed in
 * Hindi switches to the shipped Devanagari font, as the report PDFs do.
 */
import "server-only";
import { jsPDF } from "jspdf";
import { drawPdfLetterhead, resolvePdfLetterhead } from "@/lib/pdfLetterhead";
import { ensureDevanagariFont, FONT_FAMILY, hasDevanagari } from "@/lib/pdfDevanagari";
import { paymentModeLabel, payrollStatusLabel, type PayrollRun, type PayrollStaffLine } from "@/lib/payroll";
import type { MastersState } from "@/lib/masters";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function payslipMonthLabel(ym: string): string {
  const y = ym.slice(0, 4);
  const m = Number(ym.slice(5, 7));
  return m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${y}` : ym;
}

/** "Rs 12,345" — whole rupees, Indian grouping (formatInr without the ₹). */
export function pdfRupees(n: number): string {
  return `Rs ${Math.round(n || 0).toLocaleString("en-IN")}`;
}

export function payslipPdfFileName(month: string, empCode: string, fullName: string): string {
  const who = (empCode || fullName || "staff").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `payslip-${month}-${who || "staff"}.pdf`;
}

export async function renderPayslipPdf(
  run: PayrollRun,
  line: PayrollStaffLine,
  masters?: MastersState,
): Promise<Buffer> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  const usable = pageW - margin * 2;

  const earnings = line.components.filter((c) => c.kind === "earning");
  const deductions = line.components.filter((c) => c.kind === "deduction");
  const employer = line.components.filter((c) => c.kind === "employer");

  const texts = [line.fullName, line.structureName, line.note, line.holdNote, ...line.components.map((c) => c.headName)];
  const devanagari = texts.some((t) => hasDevanagari(t || "")) ? await ensureDevanagariFont(doc) : false;
  const font = (bold: boolean, text?: string) => {
    if (devanagari && text && hasDevanagari(text)) doc.setFont(FONT_FAMILY, bold ? "bold" : "normal");
    else doc.setFont("helvetica", bold ? "bold" : "normal");
  };

  const letterhead = await resolvePdfLetterhead(masters);
  let y = drawPdfLetterhead(doc, letterhead, margin, usable, pageW);

  // Title
  font(true);
  doc.setFontSize(13).setTextColor(32, 48, 80);
  doc.text(`Salary payslip · ${payslipMonthLabel(run.month)}`, pageW / 2, y + 4, { align: "center" });
  y += 26;

  // Employee block, two columns
  const info: [string, string][] = [
    ["Employee", `${line.fullName}${line.empCode ? ` (${line.empCode})` : ""}`],
    ["Stream", (line.stream || "").replace("_", "-")],
    ["Structure", line.structureName || ""],
    ["Status", payrollStatusLabel(run.status)],
    ...(line.paymentDate ? ([["Pay date", line.paymentDate]] as [string, string][]) : []),
    ...(line.paymentMode ? ([["Mode", paymentModeLabel(line.paymentMode)]] as [string, string][]) : []),
  ];
  doc.setFontSize(9.5);
  info.forEach(([label, value], i) => {
    const x = margin + (i % 2) * (usable / 2);
    const yy = y + Math.floor(i / 2) * 14;
    font(false);
    doc.setTextColor(110, 110, 110);
    doc.text(`${label}: `, x, yy);
    const w = doc.getTextWidth(`${label}: `);
    font(label === "Employee", value);
    doc.setTextColor(30, 30, 30);
    doc.text(value, x + w, yy, { maxWidth: usable / 2 - w - 8 });
  });
  y += Math.ceil(info.length / 2) * 14 + 12;

  // Earnings | Deductions
  const colW = usable / 2 - 10;
  const drawColumn = (
    x: number,
    title: string,
    rows: { name: string; amount: string }[],
    totalLabel: string,
    total: string,
  ): number => {
    let yy = y;
    font(true);
    doc.setFontSize(8.5).setTextColor(32, 48, 80);
    doc.text(title.toUpperCase(), x, yy);
    yy += 4;
    doc.setDrawColor(197, 160, 40).setLineWidth(1);
    doc.line(x, yy, x + colW, yy);
    yy += 13;
    doc.setFontSize(10).setTextColor(30, 30, 30);
    for (const r of rows) {
      font(false, r.name);
      doc.text(r.name, x, yy, { maxWidth: colW - 90 });
      font(false);
      doc.text(r.amount, x + colW, yy, { align: "right" });
      yy += 14;
    }
    doc.setDrawColor(200, 200, 200).setLineWidth(0.6);
    doc.line(x, yy - 9, x + colW, yy - 9);
    yy += 3;
    font(true);
    doc.text(totalLabel, x, yy);
    doc.text(total, x + colW, yy, { align: "right" });
    return yy + 8;
  };
  const leftEnd = drawColumn(
    margin,
    "Earnings",
    earnings.map((c) => ({ name: c.headName, amount: pdfRupees(c.amount) })),
    "Gross",
    pdfRupees(line.gross),
  );
  const rightEnd = drawColumn(
    margin + usable / 2 + 10,
    "Deductions",
    deductions.map((c) => ({ name: c.headName, amount: `-${pdfRupees(c.amount)}` })),
    "Total deductions",
    `-${pdfRupees(line.totalDeductions)}`,
  );
  y = Math.max(leftEnd, rightEnd) + 10;

  if (employer.length > 0) {
    font(true);
    doc.setFontSize(8.5).setTextColor(32, 48, 80);
    doc.text("EMPLOYER CONTRIBUTIONS (NOT DEDUCTED FROM STAFF)", margin, y);
    y += 13;
    doc.setFontSize(9).setTextColor(90, 90, 90);
    for (const c of employer) {
      font(false, c.headName);
      doc.text(c.headName, margin, y);
      font(false);
      doc.text(pdfRupees(c.amount), margin + usable / 2 - 10, y, { align: "right" });
      y += 12;
    }
    y += 6;
  }

  // Footer band: attendance / advance / notes on the left, net pay right.
  doc.setDrawColor(32, 48, 80).setLineWidth(1.5);
  doc.line(margin, y, margin + usable, y);
  y += 16;
  const notes: string[] = [
    `Attendance: P ${line.daysPresent} · A ${line.daysAbsent} · HD ${line.daysHalf} · LWP ${line.daysLwp} · Holiday ${line.daysHoliday}`,
  ];
  if ((line.advanceDeduct || 0) > 0 || (line.advanceNewWithSalary || 0) > 0) {
    notes.push(
      `Advance: due ${pdfRupees(line.advanceTaken || 0)} · deduct ${pdfRupees(line.advanceDeduct || 0)}` +
        ((line.advanceNewWithSalary || 0) > 0 ? ` · new with salary ${pdfRupees(line.advanceNewWithSalary)}` : ""),
    );
  }
  if (line.juneHold) notes.push("June salary hold applied");
  if (line.note) notes.push(`Note: ${line.note}`);
  doc.setFontSize(8.5).setTextColor(70, 70, 70);
  let ny = y;
  for (const n of notes) {
    font(false, n);
    const wrapped = doc.splitTextToSize(n, usable * 0.6) as string[];
    doc.text(wrapped, margin, ny);
    ny += wrapped.length * 11 + 2;
  }
  font(true);
  doc.setFontSize(8).setTextColor(197, 160, 40);
  doc.text("NET PAY", margin + usable, y, { align: "right" });
  doc.setFontSize(18).setTextColor(32, 48, 80);
  doc.text(pdfRupees(line.netPay), margin + usable, y + 20, { align: "right" });
  font(false);
  doc.setFontSize(8.5).setTextColor(90, 90, 90);
  doc.text(`Payable ${pdfRupees(line.amountPayable ?? line.netPay)}`, margin + usable, y + 33, { align: "right" });
  y = Math.max(ny, y + 40) + 10;

  // Signatures — near the foot of the page, never on top of the content.
  const sigY = Math.max(y + 50, Math.min(pageH - 80, y + 120));
  doc.setDrawColor(120, 120, 120).setLineWidth(0.6);
  doc.line(margin + 20, sigY, margin + 180, sigY);
  doc.line(margin + usable - 180, sigY, margin + usable - 20, sigY);
  doc.setFontSize(8.5).setTextColor(90, 90, 90);
  doc.text("Employee signature", margin + 100, sigY + 12, { align: "center" });
  doc.text("Authorised signatory", margin + usable - 100, sigY + 12, { align: "center" });

  return Buffer.from(doc.output("arraybuffer"));
}
