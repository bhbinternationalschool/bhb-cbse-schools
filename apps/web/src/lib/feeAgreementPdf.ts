/**
 * Fee Agreement document — Scientific Study style:
 * guardian header + head × Apr–Mar matrix + summary + signatures.
 */

import type { jsPDF } from "jspdf";
import {
  drawPdfLetterhead,
  resolvePdfLetterhead,
  type PdfLetterheadInfo,
} from "@/lib/pdfLetterhead";
import {
  computeStudentDues,
  loadFees,
  type FeeDueLine,
  type FeesState,
} from "@/lib/fees";
import {
  SESSION_MONTHS,
  currentAcademicYearCode,
  loadMasters,
  type MastersState,
} from "@/lib/masters";
import { exportFilterReport } from "@/lib/reportExport";
import {
  householdOf,
  householdWhatsApp,
  loadSis,
  type SisState,
  type SisStudent,
} from "@/lib/sis";
import { TENANT } from "@/lib/types";

export type SessionMonthCode = (typeof SESSION_MONTHS)[number]["code"];

export type FeeAgreementHeadRow = {
  headName: string;
  totalPaise: number;
  discountPaise: number;
  payablePaise: number;
  /** Amount billed in each session month (0 = show dash) */
  months: Record<string, number>;
};

export type FeeAgreementDoc = {
  academicYearCode: string;
  dateLabel: string;
  guardianName: string;
  agreementNo: string;
  villageCity: string;
  guardianContact: string;
  studentName: string;
  fatherName: string;
  classLabel: string;
  fatherPhone: string;
  admissionNo: string;
  totalPaidPaise: number;
  totalDuePaise: number;
  arrearsPaise: number;
  heads: FeeAgreementHeadRow[];
};

function stamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

function classLabelOf(student: SisStudent, masters: MastersState) {
  const c = masters.classes.find((x) => x.id === student.classId)?.name ?? "—";
  const s = masters.sections.find((x) => x.id === student.sectionId)?.name ?? "";
  return s ? `${c} ${s}` : c;
}

function monthCodeFromDue(
  due: FeeDueLine,
  masters: MastersState,
): string | null {
  if (due.installmentId) {
    const inst = masters.installments.find((i) => i.id === due.installmentId);
    if (inst?.code) return inst.code;
  }
  const label = `${due.installmentLabel} ${due.label}`.toUpperCase();
  for (const m of SESSION_MONTHS) {
    if (
      label.includes(m.code) ||
      label.includes(m.label.toUpperCase())
    ) {
      return m.code;
    }
  }
  if (due.dueOn && /^\d{4}-\d{2}-\d{2}/.test(due.dueOn)) {
    const month = Number(due.dueOn.slice(5, 7));
    const hit = SESSION_MONTHS.find((m) => m.month === month);
    return hit?.code ?? null;
  }
  return null;
}

function emptyMonths(): Record<string, number> {
  const o: Record<string, number> = {};
  for (const m of SESSION_MONTHS) o[m.code] = 0;
  return o;
}

/** Build agreement matrix from live dues (academic + transport + special + store). */
export function buildFeeAgreementDoc(
  student: SisStudent,
  options?: {
    masters?: MastersState;
    sis?: SisState;
    fees?: FeesState;
    asOf?: string;
  },
): FeeAgreementDoc {
  const masters = options?.masters ?? loadMasters();
  const sis = options?.sis ?? loadSis();
  const fees = options?.fees ?? loadFees();
  const asOf = options?.asOf ?? new Date().toISOString().slice(0, 10);
  const ay =
    student.academicYearCode || currentAcademicYearCode(masters);
  const hh = householdOf(sis, student.householdId);

  const dues = computeStudentDues(student, masters, fees, {
    asOf,
    includeFuture: true,
    includePaid: true,
    includeInactive: true,
  });

  let totalPaidPaise = 0;
  let totalDuePaise = 0;
  let arrearsPaise = 0;
  for (const due of dues) {
    totalPaidPaise += due.paidPaise;
    totalDuePaise += due.balancePaise;
    if (due.kind === "arrears") {
      arrearsPaise += due.balancePaise;
    }
  }

  const billableDues = dues.filter((d) => d.kind !== "arrears" && d.kind !== "plan");

  const byHead = new Map<string, FeeAgreementHeadRow>();

  for (const due of billableDues) {
    const headName =
      due.feeHeadName ||
      (due.kind === "transport"
        ? "Transport"
        : due.kind === "store"
          ? "Store"
          : due.label.split(" · ")[0] || "Fee");
    const row = byHead.get(headName) ?? {
      headName,
      totalPaise: 0,
      discountPaise: 0,
      payablePaise: 0,
      months: emptyMonths(),
    };
    row.totalPaise += due.billedPaise;
    row.discountPaise += due.concessionPaise;
    row.payablePaise += Math.max(0, due.billedPaise - due.concessionPaise);
    const code = monthCodeFromDue(due, masters);
    const net = Math.max(0, due.billedPaise - due.concessionPaise);
    if (code && code in row.months) {
      row.months[code] = (row.months[code] ?? 0) + net;
    } else {
      // One-time / unmapped — bill on April (session start), matching school agreements
      row.months.APR = (row.months.APR ?? 0) + net;
    }
    byHead.set(headName, row);
  }

  const arrearsBilled = dues
    .filter((d) => d.kind === "arrears")
    .reduce(
      (acc, d) => {
        acc.billed += d.billedPaise;
        acc.discount += d.concessionPaise;
        acc.payable += Math.max(0, d.billedPaise - d.concessionPaise);
        return acc;
      },
      { billed: 0, discount: 0, payable: 0 },
    );
  if (arrearsBilled.payable > 0) {
    byHead.set("__arrears__", {
      headName: "Previous session due",
      totalPaise: arrearsBilled.billed,
      discountPaise: arrearsBilled.discount,
      payablePaise: arrearsBilled.payable,
      months: { ...emptyMonths(), APR: arrearsBilled.payable },
    });
  }

  const heads = [...byHead.values()].sort((a, b) =>
    a.headName.localeCompare(b.headName),
  );

  const addressParts = [
    hh?.address?.trim(),
    hh?.locality?.trim(),
    hh?.city?.trim(),
    hh?.state?.trim(),
    hh?.pincode?.trim(),
  ].filter(Boolean);

  const today = new Date();
  const dateLabel = today.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return {
    academicYearCode: ay,
    dateLabel,
    guardianName:
      hh?.guardianName || student.fatherName || student.motherName || "—",
    agreementNo: student.admissionNo || hh?.id?.slice(-6) || "—",
    villageCity: addressParts.join(", ") || TENANT.city,
    guardianContact:
      householdWhatsApp(hh) ||
      hh?.mobile ||
      student.fatherMobile ||
      student.motherMobile ||
      "—",
    studentName: student.fullName,
    fatherName: student.fatherName || hh?.guardianName || "—",
    classLabel: classLabelOf(student, masters),
    fatherPhone: student.fatherMobile || hh?.mobile || "—",
    admissionNo: student.admissionNo,
    totalPaidPaise,
    totalDuePaise,
    arrearsPaise,
    heads,
  };
}

/** PDF-safe INR — Helvetica cannot render ₹ without garbling the whole line */
function pdfInr(paise: number): string {
  if (!paise) return "-";
  return `Rs. ${Math.round(paise / 100).toLocaleString("en-IN")}`;
}

/** Table cells — no currency symbol, tighter fit */
function cellAmount(paise: number): string {
  if (!paise) return "-";
  return Math.round(paise / 100).toLocaleString("en-IN", {
    maximumFractionDigits: 0,
  });
}

function monthShortLabel(code: string): string {
  const m = SESSION_MONTHS.find((x) => x.code === code);
  return m ? m.label.slice(0, 3) : code;
}

function splitCellLines(
  doc: jsPDF,
  text: string,
  maxWidth: number,
  fontSize: number,
): string[] {
  doc.setFontSize(fontSize);
  const lines = doc.splitTextToSize(text, Math.max(8, maxWidth - 4));
  return lines.length ? lines : [""];
}

function fitAmountInCell(
  doc: jsPDF,
  paise: number,
  maxWidth: number,
  baseFontSize: number,
): { text: string; fontSize: number; lines: string[] } {
  if (!paise) {
    return { text: "-", fontSize: baseFontSize, lines: ["-"] };
  }
  const rupees = Math.round(paise / 100);
  const candidates = [
    rupees.toLocaleString("en-IN"),
    String(rupees),
    rupees >= 1_00_00_000
      ? `${(rupees / 1_00_00_000).toFixed(1)}Cr`
      : rupees >= 1_00_000
        ? `${(rupees / 1_00_000).toFixed(1)}L`
        : rupees >= 1_000
          ? `${(rupees / 1_000).toFixed(1)}k`
          : String(rupees),
  ];
  for (let fs = baseFontSize; fs >= 5; fs -= 0.5) {
    doc.setFontSize(fs);
    for (const text of candidates) {
      if (doc.getTextWidth(text) <= maxWidth - 4) {
        return { text, fontSize: fs, lines: [text] };
      }
    }
  }
  const text = candidates[candidates.length - 1]!;
  doc.setFontSize(5);
  return { text, fontSize: 5, lines: splitCellLines(doc, text, maxWidth, 5) };
}

function sumHeads(heads: FeeAgreementHeadRow[]): FeeAgreementHeadRow {
  const months = emptyMonths();
  let total = 0;
  let discount = 0;
  let payable = 0;
  for (const h of heads) {
    total += h.totalPaise;
    discount += h.discountPaise;
    payable += h.payablePaise;
    for (const m of SESSION_MONTHS) {
      months[m.code] = (months[m.code] ?? 0) + (h.months[m.code] ?? 0);
    }
  }
  return {
    headName: "Total",
    totalPaise: total,
    discountPaise: discount,
    payablePaise: payable,
    months,
  };
}

/** Formal landscape Fee Agreement PDF (one page per student). */
export async function downloadFeeAgreementPdf(
  docs: FeeAgreementDoc[],
  options?: { masters?: MastersState },
): Promise<void> {
  if (!docs.length) throw new Error("No student selected for Fee Agreement");

  const letterhead = await resolvePdfLetterhead(options?.masters ?? loadMasters());
  const { jsPDF: JsPDF } = await import("jspdf");
  const doc = new JsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 20;
  const usable = pageW - margin * 2;

  docs.forEach((agreement, pageIndex) => {
    if (pageIndex > 0) doc.addPage();
    drawAgreementPage(doc, agreement, margin, usable, pageW, pageH, letterhead);
  });

  const base =
    docs.length === 1
      ? `fee_agreement_${docs[0]!.admissionNo || "student"}`
      : `fee_agreement_${docs.length}_students`;
  doc.save(`${base}_${stamp()}.pdf`);
}

function drawAgreementPage(
  doc: jsPDF,
  a: FeeAgreementDoc,
  margin: number,
  usable: number,
  pageW: number,
  pageH: number,
  letterhead: PdfLetterheadInfo,
) {
  let y = drawPdfLetterhead(doc, letterhead, margin, usable, pageW);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(32, 48, 80);
  doc.text(`Fee Agreement · Session ${a.academicYearCode}`, pageW / 2, y, {
    align: "center",
  });
  y += 18;

  // Student / guardian block
  const infoPadTop = 14;
  const infoRowH = 15;
  const infoRows = 4;
  const infoH = infoPadTop + infoRows * infoRowH + 10;
  doc.setFillColor(248, 248, 240);
  doc.setDrawColor(197, 160, 40);
  doc.setLineWidth(0.6);
  doc.roundedRect(margin, y, usable, infoH, 4, 4, "FD");
  const colMid = margin + usable * 0.5 + 8;
  const textY = y + infoPadTop;
  doc.setFontSize(10);
  doc.setTextColor(40, 40, 40);
  doc.setFont("helvetica", "normal");
  doc.text(`Date: ${a.dateLabel}`, margin + 12, textY);
  doc.text(`Admission No.: ${a.admissionNo}`, colMid, textY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(`Student: ${a.studentName}`, margin + 12, textY + infoRowH);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Father: ${a.fatherName}`, colMid, textY + infoRowH);
  doc.text(`Class: ${a.classLabel}`, margin + 12, textY + infoRowH * 2);
  doc.text(`Mobile: ${a.fatherPhone || a.guardianContact}`, colMid, textY + infoRowH * 2);
  doc.text(`Guardian: ${a.guardianName}`, margin + 12, textY + infoRowH * 3, {
    maxWidth: usable * 0.45,
  });
  doc.text(`Address: ${a.villageCity}`, colMid, textY + infoRowH * 3, {
    maxWidth: usable * 0.45,
  });
  y += infoH + 10;

  const totalRow = sumHeads(a.heads);

  // Payment status strip
  doc.setFillColor(32, 48, 80);
  doc.roundedRect(margin, y, usable, 24, 3, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  const statusParts = [
    `Payable ${pdfInr(totalRow.payablePaise)}`,
    `Paid ${pdfInr(a.totalPaidPaise)}`,
    `Balance ${pdfInr(a.totalDuePaise)}`,
  ];
  if (a.arrearsPaise > 0) {
    statusParts.push(`Arrears ${pdfInr(a.arrearsPaise)}`);
  }
  doc.text(statusParts.join("   |   "), pageW / 2, y + 15, { align: "center" });
  y += 34;

  const tableRows = [...a.heads, totalRow];
  // Fixed layout: wider summary cols, equal month cols
  const headW = Math.min(usable * 0.2, 148);
  const sumW = 46;
  const monthCount = SESSION_MONTHS.length;
  const monthW = Math.max(
    34,
    (usable - headW - sumW * 3) / monthCount,
  );
  const widths = [
    headW,
    sumW,
    sumW,
    sumW,
    ...SESSION_MONTHS.map(() => monthW),
  ];
  const headers = [
    "Fee head",
    "Total",
    "Disc.",
    "Payable",
    ...SESSION_MONTHS.map((m) => monthShortLabel(m.code)),
  ];

  const headerH = 28;
  const lineLead = 9;
  const headFontSize = 7.5;
  const sumFontSize = 6.5;
  const monthFontSize = 6;

  function drawTableHeader(startY: number) {
    doc.setFillColor(236, 239, 244);
    doc.rect(margin, startY, usable, headerH, "F");
    doc.setDrawColor(32, 48, 80);
    doc.setLineWidth(0.5);
    doc.rect(margin, startY, usable, headerH);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(32, 48, 80);
    let x = margin;
    headers.forEach((h, i) => {
      const w = widths[i]!;
      const fs = i === 0 ? headFontSize : i < 4 ? sumFontSize : monthFontSize;
      doc.setFontSize(fs);
      const lines = splitCellLines(doc, h, w, fs);
      const blockH = lines.length * lineLead;
      const ty = startY + (headerH - blockH) / 2 + lineLead * 0.75;
      lines.forEach((line, li) => {
        doc.text(line, x + w / 2, ty + li * lineLead, {
          align: "center",
          maxWidth: w - 4,
        });
      });
      doc.line(x + w, startY, x + w, startY + headerH);
      x += w;
    });
    return startY + headerH;
  }

  function drawDataRow(
    startY: number,
    cells: string[],
    cellPaise: (number | null)[],
    bold = false,
    fill?: [number, number, number],
  ): number {
    const measured = cells.map((cell, i) => {
      const w = widths[i]!;
      if (i === 0) {
        const fs = headFontSize;
        doc.setFont("helvetica", bold ? "bold" : "normal");
        const lines = splitCellLines(doc, cell, w, fs);
        return { lines, fontSize: fs, align: "left" as const };
      }
      const paise = cellPaise[i];
      const baseFs = i < 4 ? sumFontSize : monthFontSize;
      if (paise != null && paise > 0) {
        const fit = fitAmountInCell(doc, paise, w, baseFs);
        return { lines: fit.lines, fontSize: fit.fontSize, align: "right" as const };
      }
      doc.setFontSize(baseFs);
      return {
        lines: splitCellLines(doc, cell, w, baseFs),
        fontSize: baseFs,
        align: "right" as const,
      };
    });

    const maxLines = Math.max(1, ...measured.map((m) => m.lines.length));
    const rowH = Math.max(15, maxLines * lineLead + 4);

    if (fill) {
      doc.setFillColor(fill[0], fill[1], fill[2]);
      doc.rect(margin, startY, usable, rowH, "F");
    }
    doc.setDrawColor(180, 188, 200);
    doc.setLineWidth(0.35);
    doc.rect(margin, startY, usable, rowH);

    let x = margin;
    measured.forEach((m, i) => {
      const w = widths[i]!;
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(m.fontSize);
      doc.setTextColor(30, 30, 30);
      const blockH = m.lines.length * lineLead;
      const ty = startY + (rowH - blockH) / 2 + lineLead * 0.75;
      m.lines.forEach((line, li) => {
        doc.text(
          line,
          m.align === "left" ? x + 3 : x + w - 3,
          ty + li * lineLead,
          { align: m.align, maxWidth: w - 5 },
        );
      });
      doc.line(x + w, startY, x + w, startY + rowH);
      x += w;
    });
    return startY + rowH;
  }

  function cellsFor(row: FeeAgreementHeadRow): {
    texts: string[];
    paise: (number | null)[];
  } {
    return {
      texts: [
        row.headName,
        cellAmount(row.totalPaise),
        cellAmount(row.discountPaise),
        cellAmount(row.payablePaise),
        ...SESSION_MONTHS.map((m) => cellAmount(row.months[m.code] ?? 0)),
      ],
      paise: [
        null,
        row.totalPaise,
        row.discountPaise,
        row.payablePaise,
        ...SESSION_MONTHS.map((m) => row.months[m.code] ?? 0),
      ],
    };
  }

  y = drawTableHeader(y);
  for (const row of tableRows) {
    const isTotal = row.headName === "Total";
    if (y + 20 > pageH - 88) break;
    const { texts, paise } = cellsFor(row);
    y = drawDataRow(
      y,
      texts,
      paise,
      isTotal,
      isTotal ? [248, 248, 240] : undefined,
    );
  }

  y += 22;
  const sigW = usable / 4;
  const labels = ["Mother's signature", "Father's signature", "Guardian", "Principal"];
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(50, 50, 50);
  labels.forEach((label, i) => {
    const x = margin + i * sigW + sigW / 2;
    doc.setDrawColor(120, 120, 120);
    doc.line(x - 58, y, x + 58, y);
    doc.text(label, x, y + 14, { align: "center" });
  });

  doc.setFontSize(8);
  doc.setTextColor(130, 130, 130);
  doc.text(
    `${TENANT.shortName} · Fee Agreement · Generated ${a.dateLabel}`,
    pageW / 2,
    pageH - 14,
    { align: "center" },
  );
}

/** Excel-friendly matrix matching the agreement table. */
export function downloadFeeAgreementExcel(docs: FeeAgreementDoc[]): void {
  if (!docs.length) throw new Error("No student selected for Fee Agreement");

  const rows: Record<string, string | number>[] = [];
  for (const a of docs) {
    rows.push({
      section: "HEADER",
      headName: a.studentName,
      father: a.fatherName,
      classLabel: a.classLabel,
      guardian: a.guardianName,
      agreementNo: a.agreementNo,
      contact: a.guardianContact,
      address: a.villageCity,
      totalFee: "",
      discount: "",
      payable: "",
      ...Object.fromEntries(SESSION_MONTHS.map((m) => [m.code, ""])),
    });
    for (const h of a.heads) {
      rows.push({
        section: "HEAD",
        headName: h.headName,
        father: a.fatherName,
        classLabel: a.classLabel,
        guardian: "",
        agreementNo: a.agreementNo,
        contact: "",
        address: "",
        totalFee: Math.round(h.totalPaise / 100),
        discount: Math.round(h.discountPaise / 100),
        payable: Math.round(h.payablePaise / 100),
        ...Object.fromEntries(
          SESSION_MONTHS.map((m) => [
            m.code,
            h.months[m.code] ? Math.round((h.months[m.code] ?? 0) / 100) : "-",
          ]),
        ),
      });
    }
    const t = sumHeads(a.heads);
    rows.push({
      section: "TOTAL",
      headName: "Total",
      father: a.fatherName,
      classLabel: a.classLabel,
      guardian: "",
      agreementNo: a.agreementNo,
      contact: "",
      address: "",
      totalFee: Math.round(t.totalPaise / 100),
      discount: Math.round(t.discountPaise / 100),
      payable: Math.round(t.payablePaise / 100),
      ...Object.fromEntries(
        SESSION_MONTHS.map((m) => [
          m.code,
          t.months[m.code] ? Math.round((t.months[m.code] ?? 0) / 100) : "-",
        ]),
      ),
    });
  }

  const result = exportFilterReport(
    {
      title: `Fee Agreement (${docs[0]?.academicYearCode ?? ""})`,
      subtitle: TENANT.name,
      filterNote: docs.map((d) => d.admissionNo).join(", "),
      columns: [
        { key: "section", header: "Section" },
        { key: "agreementNo", header: "Agreement / Adm no" },
        { key: "headName", header: "Head / Student" },
        { key: "father", header: "Father" },
        { key: "classLabel", header: "Class" },
        { key: "guardian", header: "Guardian" },
        { key: "contact", header: "Contact" },
        { key: "address", header: "Address" },
        { key: "totalFee", header: "Total Fee" },
        { key: "discount", header: "Discount" },
        { key: "payable", header: "Payable" },
        ...SESSION_MONTHS.map((m) => ({
          key: m.code,
          header: `${m.label} Fee`,
        })),
      ],
      rows,
      fileBaseName: "fee_agreement",
    },
    "excel",
  );
  if (!result.ok) throw new Error(result.error);
}
