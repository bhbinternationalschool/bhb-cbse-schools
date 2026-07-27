/**
 * Fee Management report catalog — Collection / Dues / Student / General.
 * Each report builds Excel-friendly CSV from Fee Take + SIS + Masters.
 */

import {
  buildFeeAgreementDoc,
  downloadFeeAgreementExcel,
  downloadFeeAgreementPdf,
} from "@/lib/feeAgreementPdf";
import {
  computeStudentDues,
  formatInr,
  loadFees,
  openFeeDues,
  tenderModeLabel,
  type CollectionVoucher,
  type FeesState,
} from "@/lib/fees";
import {
  currentAcademicYearCode,
  loadMasters,
  type MastersState,
} from "@/lib/masters";
import { listPaymentLinks, loadPayments } from "@/lib/payments";
import {
  exportFilterReport,
  type ReportColumn,
} from "@/lib/reportExport";
import {
  householdOf,
  householdWhatsApp,
  loadSis,
  type SisState,
  type SisStudent,
} from "@/lib/sis";
import { TENANT } from "@/lib/types";
import {
  listInactiveStudentDues,
  listRteFeeRows,
} from "@/lib/feeFinance";

export type FeeReportCategory = "collection" | "dues" | "student" | "general";

export type FeeReportId =
  | "daily_collection"
  | "headwise_daily_collection"
  | "installment_wise_daily_collection"
  | "headwise_daily_summary"
  | "yearly_headwise_paid_summary"
  | "date_wise_class_installment_summary"
  | "complete_paid_report"
  | "online_fee_transaction"
  | "yearly_headwise_dues_summary"
  | "outstanding_due_summary"
  | "class_wise_outstanding_due_summary"
  | "complete_outstanding_dues"
  | "consolidated_dues_report"
  | "fee_student_follow_up"
  | "student_payments"
  | "student_hostel_report"
  | "student_head_wise_fee_report"
  | "group_wise_student"
  | "student_fee_type_wise_paid_report"
  | "student_wise_fee_details"
  | "student_ledger_report"
  | "fee_agreement"
  | "student_wallet_report"
  | "complete_wallet_report"
  | "class_installment_wise_summary"
  | "fee_cancellation_report"
  | "summary_report"
  | "daily_online_fee_payment"
  | "special_fee_type_report"
  | "guardian_wise_due_report"
  | "miscellaneous_fee_report";

export type FeeReportDef = {
  id: FeeReportId;
  category: FeeReportCategory;
  label: string;
  /** Short hint shown after run */
  hint?: string;
  /**
   * When true, report is for one student — pass studentId
   * (or studentScope: "all" to export every student).
   */
  requiresStudent?: boolean;
};

export const FEE_REPORT_CATEGORIES: {
  id: FeeReportCategory;
  title: string;
  headerClass: string;
  icon: "coins" | "dues" | "grad" | "doc";
}[] = [
  {
    id: "collection",
    title: "Collection",
    headerClass: "bg-[#43a047]",
    icon: "coins",
  },
  {
    id: "dues",
    title: "Dues",
    headerClass: "bg-[#ef5350]",
    icon: "dues",
  },
  {
    id: "student",
    title: "Student",
    headerClass: "bg-[#f9a825]",
    icon: "grad",
  },
  {
    id: "general",
    title: "General",
    headerClass: "bg-[#42a5f5]",
    icon: "doc",
  },
];

export const FEE_REPORTS: FeeReportDef[] = [
  // Collection
  { id: "daily_collection", category: "collection", label: "Daily Collection Report" },
  {
    id: "headwise_daily_collection",
    category: "collection",
    label: "HeadWise Daily Collection",
  },
  {
    id: "installment_wise_daily_collection",
    category: "collection",
    label: "Installment Wise Daily Collection",
  },
  {
    id: "headwise_daily_summary",
    category: "collection",
    label: "HeadWise Daily Summary",
  },
  {
    id: "yearly_headwise_paid_summary",
    category: "collection",
    label: "Yearly HeadWise Paid Summary",
  },
  {
    id: "date_wise_class_installment_summary",
    category: "collection",
    label: "Date Wise Class / Installment Summary",
  },
  {
    id: "complete_paid_report",
    category: "collection",
    label: "Complete Paid Report",
  },
  {
    id: "online_fee_transaction",
    category: "collection",
    label: "Online Fee Transaction",
  },
  // Dues
  {
    id: "yearly_headwise_dues_summary",
    category: "dues",
    label: "Yearly HeadWise Dues Summary",
  },
  {
    id: "outstanding_due_summary",
    category: "dues",
    label: "Outstanding Due Summary",
  },
  {
    id: "class_wise_outstanding_due_summary",
    category: "dues",
    label: "Class Wise Outstanding Due Summary",
  },
  {
    id: "complete_outstanding_dues",
    category: "dues",
    label: "Complete Outstanding Dues",
  },
  {
    id: "consolidated_dues_report",
    category: "dues",
    label: "Consolidated Dues Report",
  },
  {
    id: "fee_student_follow_up",
    category: "dues",
    label: "Fee Student Follow Up",
  },
  // Student
  {
    id: "student_payments",
    category: "student",
    label: "Student Payments",
    requiresStudent: true,
  },
  {
    id: "student_hostel_report",
    category: "student",
    label: "Student Hostel Report",
    hint: "Hostel module not enabled — empty template",
    requiresStudent: true,
  },
  {
    id: "student_head_wise_fee_report",
    category: "student",
    label: "Student Head Wise Fee Report",
    requiresStudent: true,
  },
  { id: "group_wise_student", category: "student", label: "Group Wise Student" },
  {
    id: "student_fee_type_wise_paid_report",
    category: "student",
    label: "Student Fee Type Wise Paid Report",
    requiresStudent: true,
  },
  {
    id: "student_wise_fee_details",
    category: "student",
    label: "Student Wise Fee Details",
    requiresStudent: true,
  },
  {
    id: "student_ledger_report",
    category: "student",
    label: "Student Ledger Report",
    requiresStudent: true,
  },
  {
    id: "fee_agreement",
    category: "student",
    label: "Fee Agreement",
    requiresStudent: true,
    hint: "Formal PDF with head × month grid + signatures",
  },
  {
    id: "student_wallet_report",
    category: "student",
    label: "Student Wallet Report",
    hint: "Wallet not enabled — empty template",
    requiresStudent: true,
  },
  {
    id: "complete_wallet_report",
    category: "student",
    label: "Complete Wallet Report",
    hint: "Wallet not enabled — empty template",
    requiresStudent: true,
  },
  // General
  {
    id: "class_installment_wise_summary",
    category: "general",
    label: "Class / Installment Wise Summary",
  },
  {
    id: "fee_cancellation_report",
    category: "general",
    label: "Fee Cancellation Report",
  },
  { id: "summary_report", category: "general", label: "Summary Report" },
  {
    id: "daily_online_fee_payment",
    category: "general",
    label: "Daily Online Fee Payment",
  },
  {
    id: "special_fee_type_report",
    category: "general",
    label: "Special Fee Type Report",
  },
  {
    id: "guardian_wise_due_report",
    category: "general",
    label: "Guardian Wise Due Report",
  },
  {
    id: "miscellaneous_fee_report",
    category: "general",
    label: "Miscellaneous Fee Report",
  },
];

export type FeeReportFormat = "excel" | "pdf";

export type FeeReportRunOptions = {
  academicYearCode?: string;
  fromDate?: string;
  toDate?: string;
  asOf?: string;
  /** excel = CSV for Excel; pdf = printable table */
  format?: FeeReportFormat;
  /** Scope a student-column report to one student */
  studentId?: string;
  /**
   * For requiresStudent reports: "one" needs studentId;
   * "all" exports every student (school-wide).
   */
  studentScope?: "one" | "all";
  sis?: SisState;
  masters?: MastersState;
  fees?: FeesState;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function inRange(date: string, from?: string, to?: string) {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function classLabel(student: SisStudent, masters: MastersState) {
  const c = masters.classes.find((x) => x.id === student.classId)?.name ?? "—";
  const s = masters.sections.find((x) => x.id === student.sectionId)?.name ?? "";
  return s ? `${c}-${s}` : c;
}

function studentById(sis: SisState, id: string) {
  return sis.students.find((s) => s.id === id);
}

function paise(n: number) {
  return (n / 100).toFixed(2);
}

function formatLabel(format: FeeReportFormat) {
  return format === "pdf" ? "PDF" : "Excel";
}

function emit(
  title: string,
  fileBaseName: string,
  columns: ReportColumn[],
  rows: Record<string, string | number | null | undefined>[],
  filterNote: string | undefined,
  format: FeeReportFormat,
) {
  const result = exportFilterReport(
    {
      title,
      subtitle: TENANT.name,
      filterNote,
      columns,
      rows,
      fileBaseName,
    },
    format,
  );
  if (!result.ok) throw new Error(result.error);
  return rows.length;
}

function activeVouchers(
  fees: FeesState,
  from?: string,
  to?: string,
  academicYearCode?: string,
) {
  return fees.vouchers.filter(
    (v) =>
      !v.voidedAt &&
      inRange(v.collectionDate, from, to) &&
      (!academicYearCode ||
        !v.academicYearCode ||
        v.academicYearCode === academicYearCode),
  );
}

function installmentHint(label: string): string {
  const m = label.match(/·\s*(.+)$/);
  return m?.[1]?.trim() || label;
}

/** Flat paid lines from vouchers in range. */
function paidLines(
  fees: FeesState,
  sis: SisState,
  masters: MastersState,
  from?: string,
  to?: string,
  academicYearCode?: string,
) {
  const out: {
    date: string;
    receiptNo: string;
    source: string;
    studentId: string;
    admissionNo: string;
    studentName: string;
    classLabel: string;
    head: string;
    installment: string;
    kind: string;
    amountPaise: number;
    modes: string;
  }[] = [];

  for (const v of activeVouchers(fees, from, to, academicYearCode)) {
    const modes = v.tenders.map((t) => tenderModeLabel(t.mode)).join("+");
    for (const line of v.lines) {
      const st = studentById(sis, line.studentId);
      out.push({
        date: v.collectionDate,
        receiptNo: v.receiptNo,
        source: v.source,
        studentId: line.studentId,
        admissionNo: st?.admissionNo ?? "",
        studentName: line.studentName || st?.fullName || "",
        classLabel: st ? classLabel(st, masters) : "",
        head: line.label.split(" · ")[0] || line.label,
        installment: installmentHint(line.label),
        kind: line.kind,
        amountPaise: line.amountPaise,
        modes,
      });
    }
  }
  return out;
}

function allOpenDues(
  sis: SisState,
  masters: MastersState,
  fees: FeesState,
  asOf: string,
  includeInactive = false,
) {
  const out: {
    student: SisStudent;
    classLabel: string;
    due: ReturnType<typeof computeStudentDues>[number];
  }[] = [];
  for (const student of sis.students) {
    if (!includeInactive && student.status !== "active") continue;
    const dues = openFeeDues(
      computeStudentDues(student, masters, fees, {
        asOf,
        includeFuture: true,
        includePaid: false,
        includeInactive: student.status !== "active",
      }),
    );
    for (const due of dues) {
      out.push({ student, classLabel: classLabel(student, masters), due });
    }
  }
  return out;
}

export function runFeeReport(
  id: FeeReportId,
  options: FeeReportRunOptions = {},
): { ok: true; rows: number; message: string } | { ok: false; error: string } {
  const sis = options.sis ?? loadSis();
  const masters = options.masters ?? loadMasters();
  const fees = options.fees ?? loadFees();
  const format: FeeReportFormat = options.format ?? "excel";
  const fmt = formatLabel(format);
  const from = options.fromDate || undefined;
  const to = options.toDate || undefined;
  const asOf = options.asOf ?? to ?? todayIso();
  const ay = options.academicYearCode || currentAcademicYearCode(masters);
  const studentScope = options.studentScope ?? "one";
  const studentId =
    studentScope === "all" ? undefined : options.studentId || undefined;

  const def = FEE_REPORTS.find((r) => r.id === id);
  if (!def) return { ok: false, error: "Unknown report" };

  if (def.requiresStudent && studentScope !== "all" && !studentId) {
    return {
      ok: false,
      error:
        "Select a student for this report (search above the Student column), or choose All students",
    };
  }

  const selectedStudent = studentId
    ? sis.students.find((s) => s.id === studentId)
    : null;
  if (studentId && !selectedStudent) {
    return { ok: false, error: "Selected student not found" };
  }

  const filterNote = [
    `AY ${ay}`,
    from ? `From ${from}` : "",
    to ? `To ${to}` : "",
    `As of ${asOf}`,
    selectedStudent
      ? `Student ${selectedStudent.admissionNo} · ${selectedStudent.fullName}`
      : def.requiresStudent && studentScope === "all"
        ? "All students"
        : "",
  ]
    .filter(Boolean)
    .join(" · ");

  function scopedStudents(activeOnly = true): SisStudent[] {
    if (selectedStudent) return [selectedStudent];
    return sis.students.filter(
      (s) =>
        (!activeOnly || s.status === "active") &&
        s.academicYearCode === ay,
    );
  }

  function scopedPaid() {
    const lines = paidLines(fees, sis, masters, from, to, ay);
    if (!studentId) return lines;
    return lines.filter((p) => p.studentId === studentId);
  }

  try {
    switch (id) {
      case "daily_collection": {
        const map = new Map<
          string,
          { date: string; receipts: number; amount: number }
        >();
        for (const v of activeVouchers(fees, from, to)) {
          const row = map.get(v.collectionDate) ?? {
            date: v.collectionDate,
            receipts: 0,
            amount: 0,
          };
          row.receipts += 1;
          row.amount += v.totalPaise;
          map.set(v.collectionDate, row);
        }
        const rows = [...map.values()]
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((r) => ({
            date: r.date,
            receipts: r.receipts,
            amount: paise(r.amount),
          }));
        const n = emit(
          def.label,
          id,
          [
            { key: "date", header: "Date" },
            { key: "receipts", header: "Receipts" },
            { key: "amount", header: "Collected ₹" },
          ],
          rows,
          filterNote,
          format,
        );
        return { ok: true, rows: n, message: `${def.label} · ${fmt} · ${n} day(s)` };
      }

      case "headwise_daily_collection":
      case "headwise_daily_summary": {
        const map = new Map<
          string,
          { date: string; head: string; amount: number; lines: number }
        >();
        for (const p of paidLines(fees, sis, masters, from, to)) {
          const key = `${p.date}|${p.head}`;
          const row = map.get(key) ?? {
            date: p.date,
            head: p.head,
            amount: 0,
            lines: 0,
          };
          row.amount += p.amountPaise;
          row.lines += 1;
          map.set(key, row);
        }
        const rows = [...map.values()]
          .sort((a, b) =>
            a.date === b.date
              ? a.head.localeCompare(b.head)
              : a.date.localeCompare(b.date),
          )
          .map((r) => ({
            date: r.date,
            head: r.head,
            lines: r.lines,
            amount: paise(r.amount),
          }));
        const n = emit(
          def.label,
          id,
          [
            { key: "date", header: "Date" },
            { key: "head", header: "Fee head" },
            { key: "lines", header: "Lines" },
            { key: "amount", header: "Paid ₹" },
          ],
          rows,
          filterNote,
          format,
        );
        return { ok: true, rows: n, message: `${def.label} · ${fmt} · ${n} row(s)` };
      }

      case "installment_wise_daily_collection": {
        const map = new Map<
          string,
          { date: string; installment: string; amount: number }
        >();
        for (const p of paidLines(fees, sis, masters, from, to)) {
          const key = `${p.date}|${p.installment}`;
          const row = map.get(key) ?? {
            date: p.date,
            installment: p.installment,
            amount: 0,
          };
          row.amount += p.amountPaise;
          map.set(key, row);
        }
        const rows = [...map.values()]
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((r) => ({
            date: r.date,
            installment: r.installment,
            amount: paise(r.amount),
          }));
        const n = emit(
          def.label,
          id,
          [
            { key: "date", header: "Date" },
            { key: "installment", header: "Installment" },
            { key: "amount", header: "Paid ₹" },
          ],
          rows,
          filterNote,
          format,
        );
        return { ok: true, rows: n, message: `${def.label} · ${fmt} · ${n} row(s)` };
      }

      case "yearly_headwise_paid_summary": {
        const map = new Map<string, number>();
        for (const p of paidLines(fees, sis, masters, from, to)) {
          map.set(p.head, (map.get(p.head) ?? 0) + p.amountPaise);
        }
        const rows = [...map.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([head, amount]) => ({ head, amount: paise(amount) }));
        const n = emit(
          def.label,
          id,
          [
            { key: "head", header: "Fee head" },
            { key: "amount", header: "Paid ₹" },
          ],
          rows,
          filterNote,
          format,
        );
        return { ok: true, rows: n, message: `${def.label} · ${fmt} · ${n} head(s)` };
      }

      case "date_wise_class_installment_summary": {
        const map = new Map<
          string,
          { date: string; classLabel: string; installment: string; amount: number }
        >();
        for (const p of paidLines(fees, sis, masters, from, to)) {
          const key = `${p.date}|${p.classLabel}|${p.installment}`;
          const row = map.get(key) ?? {
            date: p.date,
            classLabel: p.classLabel,
            installment: p.installment,
            amount: 0,
          };
          row.amount += p.amountPaise;
          map.set(key, row);
        }
        const rows = [...map.values()]
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((r) => ({
            date: r.date,
            classLabel: r.classLabel,
            installment: r.installment,
            amount: paise(r.amount),
          }));
        const n = emit(
          def.label,
          id,
          [
            { key: "date", header: "Date" },
            { key: "classLabel", header: "Class" },
            { key: "installment", header: "Installment" },
            { key: "amount", header: "Paid ₹" },
          ],
          rows,
          filterNote,
          format,
        );
        return { ok: true, rows: n, message: `${def.label} · ${fmt} · ${n} row(s)` };
      }

      case "complete_paid_report": {
        const rows = paidLines(fees, sis, masters, from, to).map((p) => ({
          date: p.date,
          receiptNo: p.receiptNo,
          admissionNo: p.admissionNo,
          studentName: p.studentName,
          classLabel: p.classLabel,
          head: p.head,
          installment: p.installment,
          kind: p.kind,
          amount: paise(p.amountPaise),
          modes: p.modes,
          source: p.source,
        }));
        const n = emit(
          def.label,
          id,
          [
            { key: "date", header: "Date" },
            { key: "receiptNo", header: "Receipt" },
            { key: "admissionNo", header: "Adm no" },
            { key: "studentName", header: "Student" },
            { key: "classLabel", header: "Class" },
            { key: "head", header: "Head" },
            { key: "installment", header: "Installment" },
            { key: "kind", header: "Kind" },
            { key: "amount", header: "Paid ₹" },
            { key: "modes", header: "Mode" },
            { key: "source", header: "Source" },
          ],
          rows,
          filterNote,
          format,
        );
        return { ok: true, rows: n, message: `${def.label} · ${fmt} · ${n} line(s)` };
      }

      case "online_fee_transaction":
      case "daily_online_fee_payment": {
        const online = activeVouchers(fees, from, to).filter(
          (v) =>
            v.source === "payment_link" ||
            v.tenders.some((t) => t.mode === "upi"),
        );
        const rows = online.map((v) => ({
          date: v.collectionDate,
          receiptNo: v.receiptNo,
          source: v.source,
          amount: paise(v.totalPaise),
          modes: v.tenders.map((t) => tenderModeLabel(t.mode)).join("+"),
          students: [...new Set(v.lines.map((l) => l.studentName))].join("; "),
          ref: v.tenders.map((t) => t.ref).filter(Boolean).join("; "),
        }));
        const n = emit(
          def.label,
          id,
          [
            { key: "date", header: "Date" },
            { key: "receiptNo", header: "Receipt" },
            { key: "source", header: "Source" },
            { key: "amount", header: "Amount ₹" },
            { key: "modes", header: "Mode" },
            { key: "students", header: "Students" },
            { key: "ref", header: "UTR / Ref" },
          ],
          rows,
          filterNote,
          format,
        );
        return { ok: true, rows: n, message: `${def.label} · ${fmt} · ${n} txn(s)` };
      }

      case "yearly_headwise_dues_summary": {
        const map = new Map<string, number>();
        for (const { due } of allOpenDues(sis, masters, fees, asOf)) {
          const head = due.feeHeadName || due.label.split(" · ")[0] || due.kind;
          map.set(head, (map.get(head) ?? 0) + due.balancePaise);
        }
        const rows = [...map.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([head, amount]) => ({ head, amount: paise(amount) }));
        const n = emit(
          def.label,
          id,
          [
            { key: "head", header: "Fee head" },
            { key: "amount", header: "Outstanding ₹" },
          ],
          rows,
          filterNote,
          format,
        );
        return { ok: true, rows: n, message: `${def.label} · ${fmt} · ${n} head(s)` };
      }

      case "outstanding_due_summary": {
        const map = new Map<
          string,
          { students: number; amount: number; lines: number }
        >();
        const seen = new Set<string>();
        for (const { student, due } of allOpenDues(sis, masters, fees, asOf)) {
          const head = due.feeHeadName || due.kind;
          const row = map.get(head) ?? { students: 0, amount: 0, lines: 0 };
          row.amount += due.balancePaise;
          row.lines += 1;
          const sk = `${head}|${student.id}`;
          if (!seen.has(sk)) {
            seen.add(sk);
            row.students += 1;
          }
          map.set(head, row);
        }
        const rows = [...map.entries()].map(([head, r]) => ({
          head,
          students: r.students,
          lines: r.lines,
          amount: paise(r.amount),
        }));
        const n = emit(
          def.label,
          id,
          [
            { key: "head", header: "Head / kind" },
            { key: "students", header: "Students" },
            { key: "lines", header: "Lines" },
            { key: "amount", header: "Outstanding ₹" },
          ],
          rows,
          filterNote,
          format,
        );
        return { ok: true, rows: n, message: `${def.label} · ${fmt} · ${n} row(s)` };
      }

      case "class_wise_outstanding_due_summary": {
        const map = new Map<
          string,
          { classLabel: string; students: Set<string>; amount: number }
        >();
        for (const { student, classLabel: cl, due } of allOpenDues(
          sis,
          masters,
          fees,
          asOf,
        )) {
          const row = map.get(cl) ?? {
            classLabel: cl,
            students: new Set<string>(),
            amount: 0,
          };
          row.students.add(student.id);
          row.amount += due.balancePaise;
          map.set(cl, row);
        }
        const rows = [...map.values()]
          .sort((a, b) => b.amount - a.amount)
          .map((r) => ({
            classLabel: r.classLabel,
            students: r.students.size,
            amount: paise(r.amount),
          }));
        const n = emit(
          def.label,
          id,
          [
            { key: "classLabel", header: "Class" },
            { key: "students", header: "Students" },
            { key: "amount", header: "Outstanding ₹" },
          ],
          rows,
          filterNote,
          format,
        );
        return { ok: true, rows: n, message: `${def.label} · ${fmt} · ${n} class(es)` };
      }

      case "complete_outstanding_dues": {
        const rows = allOpenDues(sis, masters, fees, asOf).map(
          ({ student, classLabel: cl, due }) => ({
            admissionNo: student.admissionNo,
            studentName: student.fullName,
            classLabel: cl,
            status: student.status,
            head: due.feeHeadName,
            label: due.label,
            dueOn: due.dueOn,
            billed: paise(due.billedPaise),
            concession: paise(due.concessionPaise),
            paid: paise(due.paidPaise),
            balance: paise(due.balancePaise),
          }),
        );
        const n = emit(
          def.label,
          id,
          [
            { key: "admissionNo", header: "Adm no" },
            { key: "studentName", header: "Student" },
            { key: "classLabel", header: "Class" },
            { key: "status", header: "Status" },
            { key: "head", header: "Head" },
            { key: "label", header: "Due" },
            { key: "dueOn", header: "Due on" },
            { key: "billed", header: "Billed ₹" },
            { key: "concession", header: "Concession ₹" },
            { key: "paid", header: "Paid ₹" },
            { key: "balance", header: "Balance ₹" },
          ],
          rows,
          filterNote,
          format,
        );
        return { ok: true, rows: n, message: `${def.label} · ${fmt} · ${n} line(s)` };
      }

      case "consolidated_dues_report": {
        const map = new Map<
          string,
          {
            admissionNo: string;
            studentName: string;
            classLabel: string;
            billed: number;
            paid: number;
            open: number;
          }
        >();
        for (const student of scopedStudents(true)) {
          const dues = computeStudentDues(student, masters, fees, {
            asOf,
            includeFuture: true,
            includePaid: true,
          });
          const open = openFeeDues(dues);
          if (dues.length === 0) continue;
          map.set(student.id, {
            admissionNo: student.admissionNo,
            studentName: student.fullName,
            classLabel: classLabel(student, masters),
            billed: dues.reduce((s, d) => s + d.billedPaise, 0),
            paid: dues.reduce((s, d) => s + d.paidPaise, 0),
            open: open.reduce((s, d) => s + d.balancePaise, 0),
          });
        }
        const rows = [...map.values()]
          .sort((a, b) => b.open - a.open)
          .map((r) => ({
            ...r,
            billed: paise(r.billed),
            paid: paise(r.paid),
            open: paise(r.open),
          }));
        const n = emit(
          def.label,
          id,
          [
            { key: "admissionNo", header: "Adm no" },
            { key: "studentName", header: "Student" },
            { key: "classLabel", header: "Class" },
            { key: "billed", header: "Billed ₹" },
            { key: "paid", header: "Paid ₹" },
            { key: "open", header: "Open ₹" },
          ],
          rows,
          filterNote,
          format,
        );
        return { ok: true, rows: n, message: `${def.label} · ${fmt} · ${n} student(s)` };
      }

      case "fee_student_follow_up": {
        const rows = allOpenDues(sis, masters, fees, asOf)
          .filter(({ due }) => due.dueOn <= asOf)
          .map(({ student, classLabel: cl, due }) => {
            const hh = householdOf(sis, student.householdId);
            return {
              admissionNo: student.admissionNo,
              studentName: student.fullName,
              classLabel: cl,
              label: due.label,
              dueOn: due.dueOn,
              balance: paise(due.balancePaise),
              guardian: hh?.guardianName || student.fatherName || "",
              mobile: householdWhatsApp(hh) || hh?.mobile || "",
            };
          });
        const n = emit(
          def.label,
          id,
          [
            { key: "admissionNo", header: "Adm no" },
            { key: "studentName", header: "Student" },
            { key: "classLabel", header: "Class" },
            { key: "label", header: "Due" },
            { key: "dueOn", header: "Due on" },
            { key: "balance", header: "Balance ₹" },
            { key: "guardian", header: "Guardian" },
            { key: "mobile", header: "WhatsApp" },
          ],
          rows,
          filterNote,
          format,
        );
        return { ok: true, rows: n, message: `${def.label} · ${fmt} · ${n} follow-up(s)` };
      }

      case "student_payments": {
        const map = new Map<
          string,
          { admissionNo: string; studentName: string; classLabel: string; amount: number; receipts: Set<string> }
        >();
        for (const p of scopedPaid()) {
          const row = map.get(p.studentId) ?? {
            admissionNo: p.admissionNo,
            studentName: p.studentName,
            classLabel: p.classLabel,
            amount: 0,
            receipts: new Set<string>(),
          };
          row.amount += p.amountPaise;
          row.receipts.add(p.receiptNo);
          map.set(p.studentId, row);
        }
        const rows = [...map.values()]
          .sort((a, b) => b.amount - a.amount)
          .map((r) => ({
            admissionNo: r.admissionNo,
            studentName: r.studentName,
            classLabel: r.classLabel,
            receipts: r.receipts.size,
            amount: paise(r.amount),
          }));
        const n = emit(
          def.label,
          id,
          [
            { key: "admissionNo", header: "Adm no" },
            { key: "studentName", header: "Student" },
            { key: "classLabel", header: "Class" },
            { key: "receipts", header: "Receipts" },
            { key: "amount", header: "Paid ₹" },
          ],
          rows,
          filterNote,
          format,
        );
        return { ok: true, rows: n, message: `${def.label} · ${fmt} · ${n} student(s)` };
      }

      case "student_hostel_report":
      case "student_wallet_report":
      case "complete_wallet_report": {
        const who = selectedStudent
          ? `${selectedStudent.admissionNo} · ${selectedStudent.fullName}`
          : "All students";
        const n = emit(
          def.label,
          id,
          [
            { key: "student", header: "Student" },
            { key: "note", header: "Note" },
            { key: "status", header: "Status" },
          ],
          [
            {
              student: who,
              note: def.hint || "Module not enabled in this ERP",
              status: "N/A",
            },
          ],
          filterNote,
          format,
        );
        return {
          ok: true,
          rows: n,
          message: def.hint || `${def.label} · ${fmt} · template`,
        };
      }

      case "student_head_wise_fee_report": {
        const rows: Record<string, string>[] = [];
        for (const student of scopedStudents()) {
          const dues = computeStudentDues(student, masters, fees, {
            asOf,
            includeFuture: true,
            includePaid: true,
            includeInactive: student.status !== "active",
          });
          const byHead = new Map<
            string,
            { billed: number; paid: number; open: number }
          >();
          for (const d of dues) {
            const head = d.feeHeadName || d.kind;
            const row = byHead.get(head) ?? { billed: 0, paid: 0, open: 0 };
            row.billed += d.billedPaise;
            row.paid += d.paidPaise;
            row.open += d.balancePaise;
            byHead.set(head, row);
          }
          for (const [head, r] of byHead) {
            rows.push({
              admissionNo: student.admissionNo,
              studentName: student.fullName,
              classLabel: classLabel(student, masters),
              head,
              billed: paise(r.billed),
              paid: paise(r.paid),
              open: paise(r.open),
            });
          }
        }
        const n = emit(
          def.label,
          id,
          [
            { key: "admissionNo", header: "Adm no" },
            { key: "studentName", header: "Student" },
            { key: "classLabel", header: "Class" },
            { key: "head", header: "Head" },
            { key: "billed", header: "Billed ₹" },
            { key: "paid", header: "Paid ₹" },
            { key: "open", header: "Open ₹" },
          ],
          rows,
          filterNote,
          format,
        );
        return { ok: true, rows: n, message: `${def.label} · ${fmt} · ${n} row(s)` };
      }

      case "group_wise_student": {
        const rows = scopedStudents()
          .map((s) => {
            const g = masters.feeGroups.find((x) => x.id === s.feeGroupId);
            return {
              admissionNo: s.admissionNo,
              studentName: s.fullName,
              classLabel: classLabel(s, masters),
              feeGroup: g?.name ?? "(none)",
              feeGroupCode: g?.code ?? "",
              studentType: s.studentType,
            };
          })
          .sort((a, b) => a.feeGroup.localeCompare(b.feeGroup));
        const n = emit(
          def.label,
          id,
          [
            { key: "feeGroup", header: "Fee group" },
            { key: "feeGroupCode", header: "Code" },
            { key: "admissionNo", header: "Adm no" },
            { key: "studentName", header: "Student" },
            { key: "classLabel", header: "Class" },
            { key: "studentType", header: "Type" },
          ],
          rows,
          filterNote,
          format,
        );
        return { ok: true, rows: n, message: `${def.label} · ${fmt} · ${n} student(s)` };
      }

      case "student_fee_type_wise_paid_report": {
        const map = new Map<string, number>();
        for (const p of scopedPaid()) {
          map.set(p.kind, (map.get(p.kind) ?? 0) + p.amountPaise);
        }
        const rows = [...map.entries()].map(([kind, amount]) => ({
          kind,
          amount: paise(amount),
        }));
        const n = emit(
          def.label,
          id,
          [
            { key: "kind", header: "Fee type" },
            { key: "amount", header: "Paid ₹" },
          ],
          rows,
          filterNote,
          format,
        );
        return { ok: true, rows: n, message: `${def.label} · ${fmt} · ${n} type(s)` };
      }

      case "student_wise_fee_details":
      case "student_ledger_report": {
        const rows: Record<string, string>[] = [];
        for (const student of scopedStudents()) {
          const dues = computeStudentDues(student, masters, fees, {
            asOf,
            includeFuture: true,
            includePaid: true,
            includeInactive: student.status !== "active",
          });
          for (const d of dues) {
            rows.push({
              admissionNo: student.admissionNo,
              studentName: student.fullName,
              classLabel: classLabel(student, masters),
              label: d.label,
              kind: d.kind,
              dueOn: d.dueOn,
              billed: paise(d.billedPaise),
              concession: paise(d.concessionPaise),
              paid: paise(d.paidPaise),
              balance: paise(d.balancePaise),
            });
          }
        }
        const n = emit(
          def.label,
          id,
          [
            { key: "admissionNo", header: "Adm no" },
            { key: "studentName", header: "Student" },
            { key: "classLabel", header: "Class" },
            { key: "label", header: "Line" },
            { key: "kind", header: "Kind" },
            { key: "dueOn", header: "Due on" },
            { key: "billed", header: "Billed ₹" },
            { key: "concession", header: "Concession ₹" },
            { key: "paid", header: "Paid ₹" },
            { key: "balance", header: "Balance ₹" },
          ],
          rows,
          filterNote,
          format,
        );
        return { ok: true, rows: n, message: `${def.label} · ${fmt} · ${n} line(s)` };
      }

      case "fee_agreement": {
        const students = scopedStudents();
        if (students.length === 0) {
          return { ok: false, error: "No student for Fee Agreement" };
        }
        const docs = students.map((s) =>
          buildFeeAgreementDoc(s, {
            masters,
            sis,
            fees,
            asOf,
          }),
        );
        if (format === "pdf") {
          void downloadFeeAgreementPdf(docs, { masters }).catch(() => undefined);
        } else {
          downloadFeeAgreementExcel(docs);
        }
        return {
          ok: true,
          rows: docs.length,
          message: `Fee Agreement · ${fmt} · ${docs.length} student(s)`,
        };
      }

      case "class_installment_wise_summary": {
        const map = new Map<
          string,
          { classLabel: string; installment: string; billed: number; paid: number; open: number }
        >();
        for (const student of scopedStudents(true)) {
          const cl = classLabel(student, masters);
          for (const d of computeStudentDues(student, masters, fees, {
            asOf,
            includeFuture: true,
            includePaid: true,
          })) {
            const inst = d.installmentLabel || "—";
            const key = `${cl}|${inst}`;
            const row = map.get(key) ?? {
              classLabel: cl,
              installment: inst,
              billed: 0,
              paid: 0,
              open: 0,
            };
            row.billed += d.billedPaise;
            row.paid += d.paidPaise;
            row.open += d.balancePaise;
            map.set(key, row);
          }
        }
        const rows = [...map.values()].map((r) => ({
          classLabel: r.classLabel,
          installment: r.installment,
          billed: paise(r.billed),
          paid: paise(r.paid),
          open: paise(r.open),
        }));
        const n = emit(
          def.label,
          id,
          [
            { key: "classLabel", header: "Class" },
            { key: "installment", header: "Installment" },
            { key: "billed", header: "Billed ₹" },
            { key: "paid", header: "Paid ₹" },
            { key: "open", header: "Open ₹" },
          ],
          rows,
          filterNote,
          format,
        );
        return { ok: true, rows: n, message: `${def.label} · ${fmt} · ${n} row(s)` };
      }

      case "fee_cancellation_report": {
        const rows = fees.vouchers
          .filter((v) => !!v.voidedAt)
          .filter((v) => inRange(v.collectionDate, from, to))
          .map((v: CollectionVoucher) => ({
            date: v.collectionDate,
            voidedAt: v.voidedAt?.slice(0, 19) ?? "",
            receiptNo: v.receiptNo,
            amount: paise(v.totalPaise),
            students: [...new Set(v.lines.map((l) => l.studentName))].join("; "),
            note: v.note,
          }));
        const n = emit(
          def.label,
          id,
          [
            { key: "date", header: "Collection date" },
            { key: "voidedAt", header: "Voided at" },
            { key: "receiptNo", header: "Receipt" },
            { key: "amount", header: "Amount ₹" },
            { key: "students", header: "Students" },
            { key: "note", header: "Note" },
          ],
          rows,
          filterNote,
          format,
        );
        return { ok: true, rows: n, message: `${def.label} · ${fmt} · ${n} void(s)` };
      }

      case "summary_report": {
        let billed = 0;
        let paid = 0;
        let open = 0;
        let students = 0;
        for (const student of scopedStudents(true)) {
          students += 1;
          const dues = computeStudentDues(student, masters, fees, {
            asOf,
            includeFuture: true,
            includePaid: true,
          });
          billed += dues.reduce((s, d) => s + d.billedPaise, 0);
          paid += dues.reduce((s, d) => s + d.paidPaise, 0);
          open += openFeeDues(dues).reduce((s, d) => s + d.balancePaise, 0);
        }
        const collected = activeVouchers(fees, from, to).reduce(
          (s, v) => s + v.totalPaise,
          0,
        );
        const n = emit(
          def.label,
          id,
          [
            { key: "metric", header: "Metric" },
            { key: "value", header: "Value" },
          ],
          [
            { metric: "Active students", value: String(students) },
            { metric: "Billed ₹", value: paise(billed) },
            { metric: "Paid (ledger) ₹", value: paise(paid) },
            { metric: "Open dues ₹", value: paise(open) },
            {
              metric: "Collections in date range ₹",
              value: paise(collected),
            },
            {
              metric: "Open pay links",
              value: String(
                listPaymentLinks(loadPayments()).filter((l) => l.status === "open")
                  .length,
              ),
            },
          ],
          filterNote,
          format,
        );
        return { ok: true, rows: n, message: `${def.label} · ${fmt} downloaded` };
      }

      case "special_fee_type_report": {
        const rows = (masters.specialFees ?? [])
          .filter((f) => f.academicYearCode === ay)
          .map((f) => {
            const assigns = (masters.specialFeeAssignments ?? []).filter(
              (a) => a.specialFeeId === f.id,
            );
            return {
              code: f.code,
              name: f.name,
              amount: paise(f.amountPaise),
              dueOn: f.dueOn,
              active: f.isActive ? "Yes" : "No",
              assignments: assigns.length,
              reason: f.reason,
            };
          });
        const n = emit(
          def.label,
          id,
          [
            { key: "code", header: "Code" },
            { key: "name", header: "Name" },
            { key: "amount", header: "Amount ₹" },
            { key: "dueOn", header: "Due on" },
            { key: "active", header: "Active" },
            { key: "assignments", header: "Assignments" },
            { key: "reason", header: "Reason" },
          ],
          rows,
          filterNote,
          format,
        );
        return { ok: true, rows: n, message: `${def.label} · ${fmt} · ${n} fee(s)` };
      }

      case "guardian_wise_due_report": {
        const map = new Map<
          string,
          {
            guardian: string;
            mobile: string;
            students: Set<string>;
            amount: number;
          }
        >();
        for (const { student, due } of allOpenDues(sis, masters, fees, asOf)) {
          const hh = householdOf(sis, student.householdId);
          const guardian =
            hh?.guardianName || student.fatherName || "Unknown guardian";
          const mobile = householdWhatsApp(hh) || hh?.mobile || "";
          const key = `${guardian}|${mobile}|${student.householdId}`;
          const row = map.get(key) ?? {
            guardian,
            mobile,
            students: new Set<string>(),
            amount: 0,
          };
          row.students.add(student.fullName);
          row.amount += due.balancePaise;
          map.set(key, row);
        }
        const rows = [...map.values()]
          .sort((a, b) => b.amount - a.amount)
          .map((r) => ({
            guardian: r.guardian,
            mobile: r.mobile,
            students: [...r.students].join("; "),
            amount: paise(r.amount),
          }));
        const n = emit(
          def.label,
          id,
          [
            { key: "guardian", header: "Guardian" },
            { key: "mobile", header: "Mobile" },
            { key: "students", header: "Students" },
            { key: "amount", header: "Outstanding ₹" },
          ],
          rows,
          filterNote,
          format,
        );
        return { ok: true, rows: n, message: `${def.label} · ${fmt} · ${n} household(s)` };
      }

      case "miscellaneous_fee_report": {
        const rows = allOpenDues(sis, masters, fees, asOf, true)
          .filter(
            ({ due }) =>
              due.kind === "special" ||
              due.kind === "store" ||
              due.kind === "transport",
          )
          .map(({ student, classLabel: cl, due }) => ({
            admissionNo: student.admissionNo,
            studentName: student.fullName,
            classLabel: cl,
            kind: due.kind,
            label: due.label,
            dueOn: due.dueOn,
            balance: paise(due.balancePaise),
          }));
        const n = emit(
          def.label,
          id,
          [
            { key: "admissionNo", header: "Adm no" },
            { key: "studentName", header: "Student" },
            { key: "classLabel", header: "Class" },
            { key: "kind", header: "Kind" },
            { key: "label", header: "Due" },
            { key: "dueOn", header: "Due on" },
            { key: "balance", header: "Balance ₹" },
          ],
          rows,
          filterNote,
          format,
        );
        return { ok: true, rows: n, message: `${def.label} · ${fmt} · ${n} line(s)` };
      }

      default:
        return { ok: false, error: "Report not implemented" };
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Report failed",
    };
  }
}

/** Extra tools kept under Reports (RTE / Tally / inactive). */
export function runAuxFeeExport(
  kind: "rte" | "inactive" | "tally",
  options: FeeReportRunOptions = {},
): { ok: true; message: string } | { ok: false; error: string } {
  const format: FeeReportFormat = options.format ?? "excel";
  const fmt = formatLabel(format);
  try {
    if (kind === "rte") {
      const rows = listRteFeeRows(options).map((r) => ({
        admissionNo: r.admissionNo,
        fullName: r.fullName,
        classLabel: r.classLabel,
        studentType: r.studentType,
        category: r.category,
        billed: paise(r.billedPaise),
        concession: paise(r.concessionPaise),
        paid: paise(r.paidPaise),
        open: paise(r.openPaise),
      }));
      emit(
        "RTE / EWS fee report",
        "rte_fee_report",
        [
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
        rows,
        undefined,
        format,
      );
      return { ok: true, message: `RTE / EWS · ${fmt} · ${rows.length} row(s)` };
    }
    if (kind === "inactive") {
      const rows = listInactiveStudentDues(options).map((r) => ({
        admissionNo: r.admissionNo,
        fullName: r.fullName,
        classLabel: r.classLabel,
        status: r.status,
        open: paise(r.openPaise),
        count: r.openCount,
        earliest: r.earliestDueOn,
      }));
      emit(
        "Inactive student dues",
        "inactive_student_dues",
        [
          { key: "admissionNo", header: "Admission No" },
          { key: "fullName", header: "Name" },
          { key: "classLabel", header: "Class" },
          { key: "status", header: "Status" },
          { key: "open", header: "Open ₹" },
          { key: "count", header: "Lines" },
          { key: "earliest", header: "Earliest due" },
        ],
        rows,
        undefined,
        format,
      );
      return {
        ok: true,
        message: `Inactive dues · ${fmt} · ${rows.length} row(s)`,
      };
    }

    const fees = options.fees ?? loadFees();
    const from = options.fromDate ?? "";
    const to = options.toDate ?? "";
    const rows: Record<string, string>[] = [];
    for (const v of fees.vouchers) {
      if (v.voidedAt) continue;
      if (from && v.collectionDate < from) continue;
      if (to && v.collectionDate > to) continue;
      for (const line of v.lines) {
        rows.push({
          date: v.collectionDate,
          voucherNo: v.receiptNo || v.id,
          ledger: line.label || line.kind,
          student: line.studentName || "",
          debit: "",
          credit: paise(line.amountPaise),
          mode: v.tenders?.map((t) => t.mode).join("+") || "",
          narration: v.note || "",
        });
      }
    }
    emit(
      "Tally day book (fee collections)",
      "tally_fee_daybook",
      [
        { key: "date", header: "Date" },
        { key: "voucherNo", header: "Voucher No" },
        { key: "ledger", header: "Ledger" },
        { key: "student", header: "Student" },
        { key: "debit", header: "Debit" },
        { key: "credit", header: "Credit" },
        { key: "mode", header: "Mode" },
        { key: "narration", header: "Narration" },
      ],
      rows,
      [from && `From ${from}`, to && `To ${to}`].filter(Boolean).join(" · "),
      format,
    );
    return { ok: true, message: `Tally day book · ${fmt} · ${rows.length} line(s)` };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Export failed",
    };
  }
}

export { formatInr };
