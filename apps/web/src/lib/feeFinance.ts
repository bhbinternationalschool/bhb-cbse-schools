/**
 * Fee finance KPIs, inactive dues register, RTE report, Tally/CSV, MPD disclosure.
 */

import {
  computeStudentDues,
  formatInr,
  loadFees,
  openFeeDues,
  type FeeDueLine,
  type FeesState,
} from "@/lib/fees";
import {
  currentAcademicYearCode,
  loadMasters,
  type MastersState,
} from "@/lib/masters";
import { downloadExcelCsv } from "@/lib/reportExport";
import { loadSis, type SisState, type SisStudent } from "@/lib/sis";
import { TENANT } from "@/lib/types";

export type FeeKpiSnapshot = {
  asOf: string;
  academicYearCode: string;
  activeStudents: number;
  studentsWithOpenDues: number;
  billedPaise: number;
  collectedPaise: number;
  openPaise: number;
  waivedPaise: number;
  arrearsPaise: number;
  todayCollectedPaise: number;
  voucherCount: number;
  collectionRatePct: number;
};

export function computeFeeKpis(options?: {
  asOf?: string;
  academicYearCode?: string;
  sis?: SisState;
  masters?: MastersState;
  fees?: FeesState;
}): FeeKpiSnapshot {
  const asOf = options?.asOf ?? new Date().toISOString().slice(0, 10);
  const sis = options?.sis ?? loadSis();
  const masters = options?.masters ?? loadMasters();
  const fees = options?.fees ?? loadFees();
  const ay = options?.academicYearCode || currentAcademicYearCode(masters);

  let billedPaise = 0;
  let openPaise = 0;
  let waivedPaise = 0;
  let arrearsPaise = 0;
  let studentsWithOpenDues = 0;
  const active = sis.students.filter(
    (s) => s.status === "active" && s.academicYearCode === ay,
  );

  for (const student of active) {
    const dues = computeStudentDues(student, masters, fees, {
      asOf,
      includeFuture: false,
      includePaid: true,
    });
    const open = openFeeDues(dues);
    if (open.length > 0) studentsWithOpenDues += 1;
    for (const d of dues) {
      billedPaise += d.billedPaise;
      waivedPaise += d.concessionPaise;
      if (d.kind === "arrears") arrearsPaise += d.balancePaise;
    }
    for (const d of open) openPaise += d.balancePaise;
  }

  let collectedPaise = 0;
  let todayCollectedPaise = 0;
  let voucherCount = 0;
  for (const v of fees.vouchers) {
    if (v.voidedAt) continue;
    if (v.academicYearCode && v.academicYearCode !== ay) continue;
    voucherCount += 1;
    collectedPaise += v.totalPaise;
    if (v.collectionDate === asOf) todayCollectedPaise += v.totalPaise;
  }

  const denom = billedPaise - waivedPaise;
  const collectionRatePct =
    denom > 0 ? Math.round((collectedPaise / denom) * 1000) / 10 : 0;

  return {
    asOf,
    academicYearCode: ay,
    activeStudents: active.length,
    studentsWithOpenDues,
    billedPaise,
    collectedPaise,
    openPaise,
    waivedPaise,
    arrearsPaise,
    todayCollectedPaise,
    voucherCount,
    collectionRatePct,
  };
}

export type InactiveDueRow = {
  studentId: string;
  admissionNo: string;
  fullName: string;
  classLabel: string;
  status: string;
  openPaise: number;
  openCount: number;
  earliestDueOn: string;
  dues: FeeDueLine[];
  student: SisStudent;
};

export function listInactiveStudentDues(options?: {
  asOf?: string;
  sis?: SisState;
  masters?: MastersState;
}): InactiveDueRow[] {
  const asOf = options?.asOf ?? new Date().toISOString().slice(0, 10);
  const sis = options?.sis ?? loadSis();
  const masters = options?.masters ?? loadMasters();
  const fees = loadFees();
  const out: InactiveDueRow[] = [];

  for (const student of sis.students) {
    if (student.status === "active") continue;
    const dues = computeStudentDues(student, masters, fees, {
      asOf,
      includeFuture: true,
      includePaid: false,
      includeInactive: true,
    });
    const open = openFeeDues(dues);
    if (open.length === 0) continue;
    const className =
      masters.classes.find((c) => c.id === student.classId)?.name ?? "—";
    const sec =
      masters.sections.find((s) => s.id === student.sectionId)?.name ?? "";
    out.push({
      studentId: student.id,
      admissionNo: student.admissionNo,
      fullName: student.fullName,
      classLabel: sec ? `${className}-${sec}` : className,
      status: student.status,
      openPaise: open.reduce((s, d) => s + d.balancePaise, 0),
      openCount: open.length,
      earliestDueOn: open.reduce(
        (min, d) => (d.dueOn < min ? d.dueOn : min),
        open[0]!.dueOn,
      ),
      dues: open,
      student,
    });
  }

  return out.sort((a, b) => b.openPaise - a.openPaise);
}

export type RteFeeRow = {
  admissionNo: string;
  fullName: string;
  classLabel: string;
  studentType: string;
  category: string;
  billedPaise: number;
  concessionPaise: number;
  paidPaise: number;
  openPaise: number;
};

export function listRteFeeRows(options?: {
  sis?: SisState;
  masters?: MastersState;
}): RteFeeRow[] {
  const sis = options?.sis ?? loadSis();
  const masters = options?.masters ?? loadMasters();
  const fees = loadFees();
  const out: RteFeeRow[] = [];

  for (const student of sis.students) {
    const isRte =
      student.studentType === "RTE" ||
      student.category === "EWS" ||
      (student as { isRte?: boolean }).isRte === true;
    if (!isRte) continue;

    const dues = computeStudentDues(student, masters, fees, {
      includeFuture: true,
      includePaid: true,
      includeInactive: student.status !== "active",
    });
    const className =
      masters.classes.find((c) => c.id === student.classId)?.name ?? "—";
    const sec =
      masters.sections.find((s) => s.id === student.sectionId)?.name ?? "";

    out.push({
      admissionNo: student.admissionNo,
      fullName: student.fullName,
      classLabel: sec ? `${className}-${sec}` : className,
      studentType: student.studentType,
      category: student.category || "—",
      billedPaise: dues.reduce((s, d) => s + d.billedPaise, 0),
      concessionPaise: dues.reduce((s, d) => s + d.concessionPaise, 0),
      paidPaise: dues.reduce((s, d) => s + d.paidPaise, 0),
      openPaise: openFeeDues(dues).reduce((s, d) => s + d.balancePaise, 0),
    });
  }
  return out.sort((a, b) => a.classLabel.localeCompare(b.classLabel));
}

export function exportRteFeeCsv(rows: RteFeeRow[]) {
  downloadExcelCsv({
    title: "RTE / EWS fee report",
    subtitle: TENANT.name,
    columns: [
      { key: "admissionNo", header: "Admission No" },
      { key: "fullName", header: "Name" },
      { key: "classLabel", header: "Class" },
      { key: "studentType", header: "Type" },
      { key: "category", header: "Category" },
      { key: "billed", header: "Billed ₹" },
      { key: "concession", header: "Concession ₹" },
      { key: "paid", header: "Paid ₹" },
      { key: "open", header: "Open ₹" },
    ],
    rows: rows.map((r) => ({
      admissionNo: r.admissionNo,
      fullName: r.fullName,
      classLabel: r.classLabel,
      studentType: r.studentType,
      category: r.category,
      billed: (r.billedPaise / 100).toFixed(2),
      concession: (r.concessionPaise / 100).toFixed(2),
      paid: (r.paidPaise / 100).toFixed(2),
      open: (r.openPaise / 100).toFixed(2),
    })),
    fileBaseName: "rte_fee_report",
  });
}

/** Tally-friendly day book CSV (voucher lines). */
export function exportTallyDayBookCsv(options?: {
  fromDate?: string;
  toDate?: string;
  fees?: FeesState;
}) {
  const fees = options?.fees ?? loadFees();
  const from = options?.fromDate ?? "";
  const to = options?.toDate ?? "";
  const rows: Record<string, string>[] = [];

  for (const v of fees.vouchers) {
    if (v.voidedAt) continue;
    if (from && v.collectionDate < from) continue;
    if (to && v.collectionDate > to) continue;
    for (const line of v.lines) {
      rows.push({
        date: v.collectionDate,
        voucherNo: v.receiptNo || v.id,
        series: v.receiptNo.startsWith("R/")
          ? "R · Registration"
          : v.receiptNo.startsWith("F/") || v.receiptNo.startsWith("REC/")
            ? "F · Fee Take"
            : "",
        ledger: line.label || line.kind,
        student: line.studentName || "",
        admissionNo: "",
        debit: "",
        credit: (line.amountPaise / 100).toFixed(2),
        mode: v.tenders?.map((t) => t.mode).join("+") || "",
        narration: v.note || "",
      });
    }
  }

  downloadExcelCsv({
    title: "Tally day book (fee collections)",
    subtitle: TENANT.name,
    filterNote: [from && `From ${from}`, to && `To ${to}`]
      .filter(Boolean)
      .join(" · "),
    columns: [
      { key: "date", header: "Date" },
      { key: "voucherNo", header: "Voucher No" },
      { key: "series", header: "Series" },
      { key: "ledger", header: "Ledger" },
      { key: "student", header: "Student" },
      { key: "admissionNo", header: "Admission No" },
      { key: "debit", header: "Debit" },
      { key: "credit", header: "Credit" },
      { key: "mode", header: "Mode" },
      { key: "narration", header: "Narration" },
    ],
    rows,
    fileBaseName: "tally_fee_daybook",
  });
}

export type MpdFeeGroupRow = {
  groupName: string;
  groupCode: string;
  classNames: string[];
  heads: { headName: string; installmentLabel: string; amountPaise: number }[];
  annualTotalPaise: number;
};

/** Mandatory Public Disclosure — published fee structure by fee group. */
export function buildMpdFeeDisclosure(
  masters?: MastersState,
  academicYearCode?: string,
): MpdFeeGroupRow[] {
  const m = masters ?? loadMasters();
  const ay = academicYearCode || currentAcademicYearCode(m);
  const groups = m.feeGroups.filter(
    (g) => g.isActive && g.academicYearCode === ay,
  );
  const out: MpdFeeGroupRow[] = [];

  for (const g of groups) {
    const classNames = g.classIds
      .map((id) => m.classes.find((c) => c.id === id)?.name)
      .filter(Boolean) as string[];
    const lines = (m.feeStructureLines ?? []).filter(
      (l) => l.feeGroupId === g.id,
    );
    const heads = lines.map((l) => {
      const head = m.feeHeads.find((h) => h.id === l.feeHeadId)?.nameEn ?? "Fee";
      const inst = l.installmentId
        ? m.installments.find((i) => i.id === l.installmentId)
        : null;
      return {
        headName: head,
        installmentLabel: inst?.label ?? inst?.code ?? "Session",
        amountPaise: l.amountPaise,
      };
    });
    out.push({
      groupName: g.name,
      groupCode: g.code,
      classNames,
      heads,
      annualTotalPaise: heads.reduce((s, h) => s + h.amountPaise, 0),
    });
  }

  return out.sort((a, b) => a.groupName.localeCompare(b.groupName));
}

export function exportInactiveDuesCsv(rows: InactiveDueRow[]) {
  downloadExcelCsv({
    title: "Inactive student dues",
    subtitle: TENANT.name,
    columns: [
      { key: "admissionNo", header: "Admission No" },
      { key: "fullName", header: "Name" },
      { key: "classLabel", header: "Class" },
      { key: "status", header: "Status" },
      { key: "open", header: "Open ₹" },
      { key: "count", header: "Lines" },
      { key: "earliest", header: "Earliest due" },
    ],
    rows: rows.map((r) => ({
      admissionNo: r.admissionNo,
      fullName: r.fullName,
      classLabel: r.classLabel,
      status: r.status,
      open: (r.openPaise / 100).toFixed(2),
      count: r.openCount,
      earliest: r.earliestDueOn,
    })),
    fileBaseName: "inactive_student_dues",
  });
}

export { formatInr };
