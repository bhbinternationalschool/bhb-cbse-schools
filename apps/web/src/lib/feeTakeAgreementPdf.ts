/**
 * Fee Take “Fee Agreement” PDF — month-wise ledger style
 * (Amount / Discount / Payable / Paid / Dues), household siblings combined.
 */

import { jsPDF } from "jspdf";
import {
  computeStudentDues,
  formatInr,
  loadFees,
  previousAcademicYearCode,
  type FeeDueLine,
  type FeesState,
} from "@/lib/fees";
import {
  SESSION_MONTHS,
  currentAcademicYearCode,
  loadMasters,
  type MastersState,
} from "@/lib/masters";
import {
  householdOf,
  householdWhatsApp,
  loadSis,
  type SisState,
  type SisStudent,
} from "@/lib/sis";
import { TENANT } from "@/lib/types";

type LineAgg = {
  feeType: string;
  studentName: string;
  amountPaise: number;
  discountPaise: number;
  payablePaise: number;
  paidPaise: number;
  duesPaise: number;
};

type MonthBlock = {
  code: string;
  label: string;
  lines: LineAgg[];
};

export type HouseholdFeeAgreementInput = {
  students: SisStudent[];
  masters?: MastersState;
  sis?: SisState;
  fees?: FeesState;
  asOf?: string;
};

function stamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

function rupees(paise: number) {
  return String(Math.round(paise / 100));
}

function classLabel(student: SisStudent, masters: MastersState) {
  const c = masters.classes.find((x) => x.id === student.classId)?.name ?? "—";
  const s = masters.sections.find((x) => x.id === student.sectionId)?.name ?? "";
  return s ? `${c} ${s}` : c;
}

function monthCodeFromDue(due: FeeDueLine, masters: MastersState): string | null {
  if (due.installmentId) {
    const inst = masters.installments.find((i) => i.id === due.installmentId);
    if (inst?.code) return inst.code;
  }
  const label = `${due.installmentLabel} ${due.label}`.toUpperCase();
  for (const m of SESSION_MONTHS) {
    if (label.includes(m.code) || label.includes(m.label.toUpperCase())) {
      return m.code;
    }
  }
  if (due.dueOn && /^\d{4}-\d{2}-\d{2}/.test(due.dueOn)) {
    const month = Number(due.dueOn.slice(5, 7));
    return SESSION_MONTHS.find((m) => m.month === month)?.code ?? null;
  }
  return null;
}

function feeTypeLabel(due: FeeDueLine) {
  if (due.feeHeadName) return due.feeHeadName;
  if (due.kind === "transport") return "Transport";
  if (due.kind === "store") return "Store";
  if (due.kind === "arrears") return "Previous due";
  return due.label.split(" · ")[0] || "Fee";
}

function pushAgg(
  map: Map<string, LineAgg>,
  key: string,
  base: Omit<LineAgg, "amountPaise" | "discountPaise" | "payablePaise" | "paidPaise" | "duesPaise">,
  due: FeeDueLine,
) {
  const row = map.get(key) ?? {
    ...base,
    amountPaise: 0,
    discountPaise: 0,
    payablePaise: 0,
    paidPaise: 0,
    duesPaise: 0,
  };
  row.amountPaise += due.billedPaise;
  row.discountPaise += due.concessionPaise;
  row.payablePaise += Math.max(0, due.billedPaise - due.concessionPaise);
  row.paidPaise += due.paidPaise;
  row.duesPaise += due.balancePaise;
  map.set(key, row);
}

/**
 * Download household Fee Agreement PDF (month sections + paid/dues).
 * Pass all siblings from Fee Take; they appear in one document.
 */
export function downloadHouseholdFeeAgreementPdf(
  input: HouseholdFeeAgreementInput,
): void {
  const students = input.students.filter(Boolean);
  if (!students.length) {
    throw new Error("Select a student first");
  }

  const masters = input.masters ?? loadMasters();
  const sis = input.sis ?? loadSis();
  const fees = input.fees ?? loadFees();
  const asOf = input.asOf ?? new Date().toISOString().slice(0, 10);
  const ay =
    students[0]!.academicYearCode || currentAcademicYearCode(masters);
  const prevAy = previousAcademicYearCode(ay);
  const multi = students.length > 1;

  const hh = householdOf(sis, students[0]!.householdId);
  const mobile =
    householdWhatsApp(hh) ||
    hh?.mobile ||
    students[0]!.fatherMobile ||
    "—";

  const dateLabel = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  type StudentDues = { student: SisStudent; dues: FeeDueLine[] };
  const bundles: StudentDues[] = students.map((student) => ({
    student,
    dues: computeStudentDues(student, masters, fees, {
      asOf,
      includeFuture: true,
      includePaid: true,
      includeInactive: true,
    }),
  }));

  // Previous session arrears
  const prevMap = new Map<string, LineAgg>();
  for (const { student, dues } of bundles) {
    for (const due of dues) {
      if (due.kind !== "arrears") continue;
      const key = multi
        ? `${student.id}|${feeTypeLabel(due)}`
        : feeTypeLabel(due);
      pushAgg(
        prevMap,
        key,
        {
          feeType: multi
            ? `${feeTypeLabel(due)} (${student.fullName})`
            : feeTypeLabel(due),
          studentName: student.fullName,
        },
        due,
      );
    }
  }
  const previousLines = [...prevMap.values()];

  // Month blocks Apr → Mar
  const months: MonthBlock[] = SESSION_MONTHS.map((m) => ({
    code: m.code,
    label: `${m.label} Fee`,
    lines: [],
  }));
  const monthMaps = SESSION_MONTHS.map(() => new Map<string, LineAgg>());

  for (const { student, dues } of bundles) {
    for (const due of dues) {
      if (due.kind === "arrears" || due.kind === "plan") continue;
      let code = monthCodeFromDue(due, masters);
      if (!code) code = "APR";
      const idx = SESSION_MONTHS.findIndex((m) => m.code === code);
      if (idx < 0) continue;
      const type = feeTypeLabel(due);
      const key = multi ? `${student.id}|${type}` : type;
      pushAgg(
        monthMaps[idx]!,
        key,
        {
          feeType: multi ? `${type} (${student.fullName})` : type,
          studentName: student.fullName,
        },
        due,
      );
    }
  }

  monthMaps.forEach((map, i) => {
    months[i]!.lines = [...map.values()].sort((a, b) =>
      a.feeType.localeCompare(b.feeType),
    );
  });

  const grand = { amount: 0, discount: 0, payable: 0, paid: 0, dues: 0 };
  const addLines = (lines: LineAgg[]) => {
    for (const l of lines) {
      grand.amount += l.amountPaise;
      grand.discount += l.discountPaise;
      grand.payable += l.payablePaise;
      grand.paid += l.paidPaise;
      grand.dues += l.duesPaise;
    }
  };
  addLines(previousLines);
  for (const m of months) addLines(m.lines);

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 36;
  const usable = pageW - margin * 2;
  let y = margin;

  function ensureSpace(need: number) {
    if (y + need <= pageH - 48) return;
    doc.addPage();
    y = margin;
  }

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(32, 48, 80);
  doc.text(TENANT.name, pageW / 2, y, { align: "center" });
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(70, 70, 70);
  doc.text(TENANT.schoolAddress, pageW / 2, y, { align: "center" });
  y += 16;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(32, 48, 80);
  doc.text(`FEE AGREEMENT- ${ay}`, pageW / 2, y, { align: "center" });
  y += 18;

  // Student table
  const studentCols = [
    { key: "adm", header: "Adm.No.", w: usable * 0.14 },
    { key: "name", header: "Name", w: usable * 0.22 },
    { key: "class", header: "Class", w: usable * 0.14 },
    { key: "father", header: "Father Name", w: usable * 0.2 },
    { key: "mobile", header: "Mobile", w: usable * 0.15 },
    { key: "date", header: "Agreement Date", w: usable * 0.15 },
  ];

  ensureSpace(28 + students.length * 16);
  drawSimpleHeader(doc, margin, y, studentCols);
  y += 18;
  for (const s of students) {
    ensureSpace(16);
    drawSimpleRow(
      doc,
      margin,
      y,
      studentCols,
      [
        s.admissionNo,
        s.fullName,
        classLabel(s, masters),
        s.fatherName || hh?.guardianName || "—",
        s.fatherMobile || mobile,
        dateLabel,
      ],
      14,
    );
    y += 14;
  }
  y += 12;

  // Fee table column layout
  const feeCols = [
    { header: "Fee Type", w: usable * 0.36 },
    { header: "Amount", w: usable * 0.128 },
    { header: "Discount", w: usable * 0.128 },
    { header: "Payable", w: usable * 0.128 },
    { header: "Paid", w: usable * 0.128 },
    { header: "Dues", w: usable * 0.128 },
  ];

  function drawFeeSection(title: string, lines: LineAgg[]) {
    if (lines.length === 0 && title.startsWith("Previous") === false) {
      // skip empty months to keep PDF short? Sample shows all months.
      // Show empty months with zero total for clarity matching sample when data exists.
    }
    ensureSpace(40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(32, 48, 80);
    doc.text(title, margin, y);
    y += 8;
    drawSimpleHeader(doc, margin, y, feeCols.map((c) => ({ ...c, key: c.header })));
    y += 16;

    if (lines.length === 0) {
      ensureSpace(14);
      drawSimpleRow(
        doc,
        margin,
        y,
        feeCols,
        ["—", "0", "0", "0", "0", "0"],
        13,
      );
      y += 13;
    } else {
      for (const line of lines) {
        ensureSpace(14);
        drawSimpleRow(
          doc,
          margin,
          y,
          feeCols,
          [
            line.feeType,
            rupees(line.amountPaise),
            rupees(line.discountPaise),
            rupees(line.payablePaise),
            rupees(line.paidPaise),
            rupees(line.duesPaise),
          ],
          13,
        );
        y += 13;
      }
    }

    const tot = lines.reduce(
      (acc, l) => {
        acc.a += l.amountPaise;
        acc.d += l.discountPaise;
        acc.p += l.payablePaise;
        acc.paid += l.paidPaise;
        acc.dues += l.duesPaise;
        return acc;
      },
      { a: 0, d: 0, p: 0, paid: 0, dues: 0 },
    );
    ensureSpace(15);
    drawSimpleRow(
      doc,
      margin,
      y,
      feeCols,
      [
        "Total",
        rupees(tot.a),
        rupees(tot.d),
        rupees(tot.p),
        rupees(tot.paid),
        rupees(tot.dues),
      ],
      14,
      true,
    );
    y += 18;
  }

  drawFeeSection(
    `Previous_Due(${prevAy || "prior session"})`,
    previousLines,
  );

  for (const m of months) {
    // Always print months that have lines; also print if any sibling has structure
    // Matching sample: all months with activity — print every month for agreement clarity
    drawFeeSection(m.label, m.lines);
  }

  ensureSpace(50);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(32, 48, 80);
  const summaryLabels = [
    "Total Amount",
    "Total Dis.",
    "Total Payable",
    "Total Paid",
    "Total Due",
  ];
  const summaryVals = [
    rupees(grand.amount),
    rupees(grand.discount),
    rupees(grand.payable),
    rupees(grand.paid),
    rupees(grand.dues),
  ];
  const sw = usable / 5;
  summaryLabels.forEach((lab, i) => {
    const x = margin + i * sw + sw / 2;
    doc.text(lab, x, y, { align: "center" });
    doc.text(summaryVals[i]!, x, y + 12, { align: "center" });
  });
  y += 36;

  ensureSpace(40);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const sigs = [
    "MOTHER'S SIGNATURE",
    "FATHER'S SIGNATURE",
    "GUARDIAN'S SIGNATURE",
  ];
  const sigW = usable / 3;
  sigs.forEach((lab, i) => {
    const x = margin + i * sigW + sigW / 2;
    doc.line(x - 55, y, x + 55, y);
    doc.text(lab, x, y + 12, { align: "center" });
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(130, 130, 130);
    doc.text(
      `${TENANT.shortName} · Fee Agreement · ${formatInr(grand.dues)} due · page ${i}/${pages}`,
      pageW / 2,
      pageH - 16,
      { align: "center" },
    );
  }

  const fileTag =
    students.length === 1
      ? students[0]!.admissionNo.replace(/[^\w-]+/g, "_")
      : `household_${students.length}`;
  doc.save(`fee_agreement_${fileTag}_${stamp()}.pdf`);
}

function drawSimpleHeader(
  doc: jsPDF,
  x0: number,
  y: number,
  cols: { header: string; w: number }[],
) {
  const h = 16;
  const totalW = cols.reduce((s, c) => s + c.w, 0);
  doc.setFillColor(236, 239, 241);
  doc.rect(x0, y, totalW, h, "F");
  doc.setDrawColor(160, 170, 185);
  doc.setLineWidth(0.4);
  doc.rect(x0, y, totalW, h);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(32, 48, 80);
  let x = x0;
  cols.forEach((c) => {
    doc.text(c.header, x + 3, y + 11, { maxWidth: c.w - 4 });
    doc.line(x + c.w, y, x + c.w, y + h);
    x += c.w;
  });
}

function drawSimpleRow(
  doc: jsPDF,
  x0: number,
  y: number,
  cols: { header: string; w: number }[],
  cells: string[],
  h: number,
  bold = false,
) {
  const totalW = cols.reduce((s, c) => s + c.w, 0);
  doc.setDrawColor(190, 198, 210);
  doc.setLineWidth(0.3);
  doc.rect(x0, y, totalW, h);
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(30, 30, 30);
  let x = x0;
  cols.forEach((c, i) => {
    const align = i === 0 ? "left" : "right";
    const text = cells[i] ?? "";
    doc.text(text, align === "left" ? x + 3 : x + c.w - 3, y + h - 4, {
      align,
      maxWidth: c.w - 5,
    });
    doc.line(x + c.w, y, x + c.w, y + h);
    x += c.w;
  });
}
