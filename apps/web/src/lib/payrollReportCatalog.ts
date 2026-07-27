/**
 * Payroll report catalog — Excel/PDF exports with shared filters.
 */

import {
  describeFilters,
  exportFilterReport,
  type ReportColumn,
} from "@/lib/reportExport";
import {
  loadPayroll,
  paymentModeLabel,
  payrollStatusLabel,
  type PayrollPaymentMode,
  type PayrollRun,
  type PayrollRunStatus,
  type PayrollStaffLine,
} from "@/lib/payroll";
import {
  currentAcademicYearCode,
  loadMasters,
  type MastersState,
} from "@/lib/masters";
import {
  advanceSourceLabel,
  formatRecoveryDetail,
  loadAdvances,
  outstandingForStaff,
  outstandingOf,
  recoveredTotal,
  recoveryMethodLabel,
} from "@/lib/staffAdvance";
import { loadSalaryHold } from "@/lib/salaryHold";
import { loadStatutoryRemit } from "@/lib/statutoryRemit";
import {
  incrementBatchStatusLabel,
  loadIncrementState,
} from "@/lib/salaryIncrement";
import {
  loadSalarySetup,
  type SalarySetupState,
} from "@/lib/salarySetup";
import { loadSalaryAccount, entryTypeLabel } from "@/lib/salaryAccount";
import type { StaffStream } from "@/lib/foundationMasters";

export type PayrollReportCategory =
  | "payroll"
  | "staff"
  | "statutory"
  | "advances"
  | "holds"
  | "increments"
  | "accounts";

export type PayrollReportId =
  | "month_summary"
  | "staff_salary_register"
  | "component_earning_register"
  | "component_deduction_register"
  | "lwp_late_report"
  | "attendance_payroll_summary"
  | "bank_payment_register"
  | "payslip_register"
  | "structure_assignment"
  | "run_status_register"
  | "pf_esic_staff_wise"
  | "govt_remittance_batches"
  | "employer_cost_report"
  | "advance_outstanding"
  | "advance_ledger_detail"
  | "advance_recoveries"
  | "june_hold_register"
  | "exit_settlement_report"
  | "increment_batches"
  | "increment_staff_lines"
  | "salary_account_postings"
  | "payable_vs_net"
  | "bonus_special_deduction"
  | "new_advance_with_salary"
  | "department_stream_summary";

export type PayrollReportDef = {
  id: PayrollReportId;
  category: PayrollReportCategory;
  title: string;
  description: string;
};

export const PAYROLL_REPORT_CATEGORIES: {
  id: PayrollReportCategory;
  label: string;
}[] = [
  { id: "payroll", label: "Payroll & payslips" },
  { id: "staff", label: "Staff & structures" },
  { id: "statutory", label: "PF / ESIC / employer" },
  { id: "advances", label: "Advances" },
  { id: "holds", label: "June holds & exits" },
  { id: "increments", label: "Increments" },
  { id: "accounts", label: "Salary account" },
];

export const PAYROLL_REPORTS: PayrollReportDef[] = [
  {
    id: "month_summary",
    category: "payroll",
    title: "Month payroll summary",
    description: "Gross, deductions, net, payable, holds by month/run",
  },
  {
    id: "staff_salary_register",
    category: "payroll",
    title: "Staff salary register",
    description: "One row per staff per month with net & payable",
  },
  {
    id: "payslip_register",
    category: "payroll",
    title: "Payslip register",
    description: "Approved/posted/paid payslips with payment mode & date",
  },
  {
    id: "bank_payment_register",
    category: "payroll",
    title: "Bank / payment register",
    description: "Payable amounts with payment mode & date for disbursement",
  },
  {
    id: "payable_vs_net",
    category: "payroll",
    title: "Net vs payable",
    description: "Computed net vs cash payable (holds / overrides)",
  },
  {
    id: "component_earning_register",
    category: "payroll",
    title: "Earning heads register",
    description: "Staff × earning head amounts",
  },
  {
    id: "component_deduction_register",
    category: "payroll",
    title: "Deduction heads register",
    description: "Staff × deduction head amounts",
  },
  {
    id: "lwp_late_report",
    category: "payroll",
    title: "LWP & late penalty",
    description: "Attendance-linked LWP days and late amounts",
  },
  {
    id: "attendance_payroll_summary",
    category: "payroll",
    title: "Attendance in payroll",
    description: "P / A / HD / LWP / holiday days on each payroll line",
  },
  {
    id: "bonus_special_deduction",
    category: "payroll",
    title: "Bonus & special deductions",
    description: "Month adjustments: bonus, special deduction, notes",
  },
  {
    id: "new_advance_with_salary",
    category: "payroll",
    title: "Advance with salary",
    description: "Extra advance disbursed with payroll lines",
  },
  {
    id: "department_stream_summary",
    category: "payroll",
    title: "Stream-wise summary",
    description: "Teaching vs non-teaching totals by month",
  },
  {
    id: "run_status_register",
    category: "payroll",
    title: "Payroll run status",
    description: "All runs with status, staff count, totals, publish dates",
  },
  {
    id: "structure_assignment",
    category: "staff",
    title: "Structure assignment",
    description: "Staff linked to salary structures & PF/ESIC cover",
  },
  {
    id: "pf_esic_staff_wise",
    category: "statutory",
    title: "PF / ESIC staff-wise",
    description: "Employee & employer statutory amounts from payroll lines",
  },
  {
    id: "govt_remittance_batches",
    category: "statutory",
    title: "PF/ESIC remittance batches",
    description: "Govt deposit batches pending / deposited",
  },
  {
    id: "employer_cost_report",
    category: "statutory",
    title: "Employer cost report",
    description: "Employer contribution totals per staff/month",
  },
  {
    id: "advance_outstanding",
    category: "advances",
    title: "Advance outstanding",
    description: "Open advances and balance due by staff",
  },
  {
    id: "advance_ledger_detail",
    category: "advances",
    title: "Advance ledger (all)",
    description: "Every advance issued with source and status",
  },
  {
    id: "advance_recoveries",
    category: "advances",
    title: "Advance recoveries",
    description: "Salary deduct vs returned to school, by month",
  },
  {
    id: "june_hold_register",
    category: "holds",
    title: "June hold register",
    description: "Teaching June salary holds and draw eligibility",
  },
  {
    id: "exit_settlement_report",
    category: "holds",
    title: "Exit settlements",
    description: "Resignation / settlement linked to June holds",
  },
  {
    id: "increment_batches",
    category: "increments",
    title: "Increment batches",
    description: "Batch status, effective date, included count",
  },
  {
    id: "increment_staff_lines",
    category: "increments",
    title: "Increment staff lines",
    description: "Old → new basic per staff in increment batches",
  },
  {
    id: "salary_account_postings",
    category: "accounts",
    title: "Salary account postings",
    description: "Posted ledger entries (live & voided)",
  },
];

export type PayrollReportFormat = "excel" | "pdf";

export type PayrollReportFilters = {
  academicYearCode?: string;
  monthFrom?: string;
  monthTo?: string;
  /** Single month shortcut */
  month?: string;
  stream?: StaffStream | "all";
  staffId?: string;
  status?: PayrollRunStatus | "all" | "published";
  runKind?: "bulk" | "individual" | "all";
  paymentMode?: PayrollPaymentMode | "all";
  structureId?: string;
  includeDraft?: boolean;
  includeVoidedAccount?: boolean;
  format?: PayrollReportFormat;
  masters?: MastersState;
  salary?: SalarySetupState;
};

function inMonthRange(month: string, from?: string, to?: string): boolean {
  if (from && month < from) return false;
  if (to && month > to) return false;
  return true;
}

function resolveMonthBounds(f: PayrollReportFilters): {
  from?: string;
  to?: string;
} {
  if (f.month) return { from: f.month, to: f.month };
  return { from: f.monthFrom, to: f.monthTo };
}

function runMatches(run: PayrollRun, f: PayrollReportFilters): boolean {
  const ay = f.academicYearCode || currentAcademicYearCode();
  if (run.academicYearCode !== ay) return false;
  const { from, to } = resolveMonthBounds(f);
  if (!inMonthRange(run.month, from, to)) return false;
  if (f.runKind && f.runKind !== "all" && (run.kind || "bulk") !== f.runKind) {
    return false;
  }
  if (f.status === "published") {
    if (run.status !== "posted" && run.status !== "paid") return false;
  } else if (f.status && f.status !== "all" && run.status !== f.status) {
    return false;
  } else if (!f.status || f.status === "all") {
    if (!f.includeDraft && (run.status === "draft" || run.status === "pending_approval")) {
      // default: include approved+ for most reports; month_summary/run_status may want drafts
    }
  }
  return true;
}

function lineMatches(
  line: PayrollStaffLine,
  f: PayrollReportFilters,
): boolean {
  if (f.staffId && line.staffId !== f.staffId) return false;
  if (f.stream && f.stream !== "all" && line.stream !== f.stream) return false;
  if (f.structureId && line.structureId !== f.structureId) return false;
  if (
    f.paymentMode &&
    f.paymentMode !== "all" &&
    (line.paymentMode || "bank_transfer") !== f.paymentMode
  ) {
    return false;
  }
  return true;
}

function filterNote(f: PayrollReportFilters): string {
  const { from, to } = resolveMonthBounds(f);
  return describeFilters([
    f.academicYearCode || currentAcademicYearCode(),
    from && to && from === to
      ? `Month ${from}`
      : from || to
        ? `Months ${from || "…"} → ${to || "…"}`
        : "All months",
    f.stream && f.stream !== "all" ? `Stream ${f.stream}` : null,
    f.staffId ? "One staff" : null,
    f.status && f.status !== "all" ? `Status ${f.status}` : null,
    f.runKind && f.runKind !== "all" ? f.runKind : null,
    f.paymentMode && f.paymentMode !== "all" ? f.paymentMode : null,
  ]);
}

function iterLines(
  f: PayrollReportFilters,
  opts?: { publishedOnly?: boolean; includeDraftDefault?: boolean },
): { run: PayrollRun; line: PayrollStaffLine }[] {
  const state = loadPayroll();
  const out: { run: PayrollRun; line: PayrollStaffLine }[] = [];
  for (const run of state.runs) {
    const ff: PayrollReportFilters = { ...f };
    if (opts?.publishedOnly) ff.status = "published";
    if (
      !opts?.includeDraftDefault &&
      (!ff.status || ff.status === "all") &&
      !ff.includeDraft
    ) {
      if (
        run.status === "draft" ||
        run.status === "pending_approval"
      ) {
        continue;
      }
    }
    if (!runMatches(run, ff)) continue;
    for (const line of run.lines) {
      if (!lineMatches(line, f)) continue;
      out.push({ run, line });
    }
  }
  out.sort((a, b) => {
    const m = b.run.month.localeCompare(a.run.month);
    if (m) return m;
    return a.line.empCode.localeCompare(b.line.empCode);
  });
  return out;
}

function money(n: number): number {
  return Math.round(n || 0);
}

export function runPayrollReport(
  id: PayrollReportId,
  filters: PayrollReportFilters = {},
): { ok: true; message: string } | { ok: false; error: string } {
  const format: PayrollReportFormat = filters.format ?? "excel";
  const def = PAYROLL_REPORTS.find((r) => r.id === id);
  if (!def) return { ok: false, error: "Unknown report" };

  const title = def.title;
  const note = filterNote(filters);
  let columns: ReportColumn[] = [];
  let rows: Record<string, string | number | null | undefined>[] = [];
  const fileBase = `payroll_${id}`;

  switch (id) {
    case "month_summary": {
      columns = [
        { key: "month", header: "Month" },
        { key: "status", header: "Status" },
        { key: "kind", header: "Kind" },
        { key: "staff", header: "Staff", align: "right" },
        { key: "gross", header: "Gross ₹", align: "right" },
        { key: "ded", header: "Deductions ₹", align: "right" },
        { key: "net", header: "Net ₹", align: "right" },
        { key: "payable", header: "Payable ₹", align: "right" },
        { key: "held", header: "Held ₹", align: "right" },
        { key: "pf", header: "PF govt ₹", align: "right" },
        { key: "esic", header: "ESIC govt ₹", align: "right" },
      ];
      const runs = loadPayroll().runs.filter((r) =>
        runMatches(r, { ...filters, includeDraft: true }),
      );
      rows = runs.map((r) => {
        const gross = r.lines.reduce((s, l) => s + l.gross, 0);
        const ded = r.lines.reduce((s, l) => s + l.totalDeductions, 0);
        const net = r.lines.reduce((s, l) => s + l.netPay, 0);
        const payable = r.lines.reduce(
          (s, l) => s + (l.amountPayable ?? l.netPay),
          0,
        );
        const held = r.lines.reduce(
          (s, l) => s + (l.juneHold ? l.netPay : 0),
          0,
        );
        return {
          month: r.month,
          status: payrollStatusLabel(r.status),
          kind: r.kind || "bulk",
          staff: r.lines.length,
          gross: money(gross),
          ded: money(ded),
          net: money(net),
          payable: money(payable),
          held: money(held),
          pf: money(r.lines.reduce((s, l) => s + (l.pfGovtDeposit || 0), 0)),
          esic: money(
            r.lines.reduce((s, l) => s + (l.esicGovtDeposit || 0), 0),
          ),
        };
      });
      break;
    }
    case "staff_salary_register":
    case "payslip_register":
    case "bank_payment_register":
    case "payable_vs_net": {
      const publishedOnly = id === "payslip_register" || id === "bank_payment_register";
      columns = [
        { key: "month", header: "Month" },
        { key: "emp", header: "Emp code" },
        { key: "name", header: "Name", width: 1.4 },
        { key: "stream", header: "Stream" },
        { key: "structure", header: "Structure", width: 1.2 },
        { key: "gross", header: "Gross", align: "right" },
        { key: "ded", header: "Deductions", align: "right" },
        { key: "net", header: "Net", align: "right" },
        { key: "payable", header: "Payable", align: "right" },
        { key: "payDate", header: "Pay date" },
        { key: "payMode", header: "Pay mode" },
        { key: "status", header: "Status" },
        { key: "note", header: "Note", width: 1.2 },
      ];
      rows = iterLines(filters, { publishedOnly }).map(({ run, line }) => ({
        month: run.month,
        emp: line.empCode,
        name: line.fullName,
        stream: line.stream,
        structure: line.structureName,
        gross: money(line.gross),
        ded: money(line.totalDeductions),
        net: money(line.netPay),
        payable: money(line.amountPayable ?? line.netPay),
        payDate: line.paymentDate || "",
        payMode: paymentModeLabel(line.paymentMode || "bank_transfer"),
        status: payrollStatusLabel(run.status),
        note: line.note || "",
      }));
      break;
    }
    case "component_earning_register":
    case "component_deduction_register": {
      const kind = id === "component_earning_register" ? "earning" : "deduction";
      columns = [
        { key: "month", header: "Month" },
        { key: "emp", header: "Emp code" },
        { key: "name", header: "Name" },
        { key: "head", header: "Head" },
        { key: "code", header: "Code" },
        { key: "amount", header: "Amount ₹", align: "right" },
        { key: "status", header: "Run status" },
      ];
      for (const { run, line } of iterLines(filters)) {
        for (const c of line.components) {
          if (c.kind !== kind) continue;
          rows.push({
            month: run.month,
            emp: line.empCode,
            name: line.fullName,
            head: c.headName,
            code: c.headCode,
            amount: money(c.amount),
            status: payrollStatusLabel(run.status),
          });
        }
      }
      break;
    }
    case "lwp_late_report": {
      columns = [
        { key: "month", header: "Month" },
        { key: "emp", header: "Emp" },
        { key: "name", header: "Name" },
        { key: "lwpDays", header: "LWP days", align: "right" },
        { key: "lwpAmt", header: "LWP ₹", align: "right" },
        { key: "late", header: "Late ₹", align: "right" },
        { key: "absent", header: "Absent", align: "right" },
        { key: "half", header: "Half", align: "right" },
      ];
      rows = iterLines(filters)
        .filter(
          ({ line }) =>
            line.daysLwp > 0 ||
            line.lwpDeduction > 0 ||
            line.latePenalty > 0,
        )
        .map(({ run, line }) => ({
          month: run.month,
          emp: line.empCode,
          name: line.fullName,
          lwpDays: line.daysLwp,
          lwpAmt: money(line.lwpDeduction),
          late: money(line.latePenalty),
          absent: line.daysAbsent,
          half: line.daysHalf,
        }));
      break;
    }
    case "attendance_payroll_summary": {
      columns = [
        { key: "month", header: "Month" },
        { key: "emp", header: "Emp" },
        { key: "name", header: "Name" },
        { key: "p", header: "Present", align: "right" },
        { key: "a", header: "Absent", align: "right" },
        { key: "hd", header: "Half", align: "right" },
        { key: "leave", header: "Paid leave", align: "right" },
        { key: "lwp", header: "LWP", align: "right" },
        { key: "hol", header: "Holiday", align: "right" },
      ];
      rows = iterLines(filters).map(({ run, line }) => ({
        month: run.month,
        emp: line.empCode,
        name: line.fullName,
        p: line.daysPresent,
        a: line.daysAbsent,
        hd: line.daysHalf,
        leave: line.daysLeavePaid,
        lwp: line.daysLwp,
        hol: line.daysHoliday,
      }));
      break;
    }
    case "bonus_special_deduction": {
      columns = [
        { key: "month", header: "Month" },
        { key: "emp", header: "Emp" },
        { key: "name", header: "Name" },
        { key: "bonus", header: "Bonus ₹", align: "right" },
        { key: "special", header: "Special ded ₹", align: "right" },
        { key: "label", header: "Deduction label" },
        { key: "note", header: "Note" },
      ];
      rows = iterLines(filters)
        .filter(
          ({ line }) =>
            (line.bonus || 0) > 0 || (line.specialDeduction || 0) > 0,
        )
        .map(({ run, line }) => ({
          month: run.month,
          emp: line.empCode,
          name: line.fullName,
          bonus: money(line.bonus || 0),
          special: money(line.specialDeduction || 0),
          label: line.specialDeductionLabel || "",
          note: line.note || "",
        }));
      break;
    }
    case "new_advance_with_salary": {
      columns = [
        { key: "month", header: "Month" },
        { key: "emp", header: "Emp" },
        { key: "name", header: "Name" },
        { key: "amt", header: "New advance ₹", align: "right" },
        { key: "payable", header: "Payable ₹", align: "right" },
        { key: "status", header: "Status" },
      ];
      rows = iterLines(filters)
        .filter(({ line }) => (line.advanceNewWithSalary || 0) > 0)
        .map(({ run, line }) => ({
          month: run.month,
          emp: line.empCode,
          name: line.fullName,
          amt: money(line.advanceNewWithSalary || 0),
          payable: money(line.amountPayable ?? line.netPay),
          status: payrollStatusLabel(run.status),
        }));
      break;
    }
    case "department_stream_summary": {
      columns = [
        { key: "month", header: "Month" },
        { key: "stream", header: "Stream" },
        { key: "staff", header: "Staff", align: "right" },
        { key: "gross", header: "Gross", align: "right" },
        { key: "net", header: "Net", align: "right" },
        { key: "payable", header: "Payable", align: "right" },
      ];
      const map = new Map<string, {
        month: string;
        stream: string;
        staff: number;
        gross: number;
        net: number;
        payable: number;
      }>();
      for (const { run, line } of iterLines(filters)) {
        const key = `${run.month}|${line.stream}`;
        const prev = map.get(key) || {
          month: run.month,
          stream: line.stream,
          staff: 0,
          gross: 0,
          net: 0,
          payable: 0,
        };
        prev.staff += 1;
        prev.gross += line.gross;
        prev.net += line.netPay;
        prev.payable += line.amountPayable ?? line.netPay;
        map.set(key, prev);
      }
      rows = [...map.values()]
        .sort((a, b) => b.month.localeCompare(a.month))
        .map((r) => ({
          ...r,
          gross: money(r.gross),
          net: money(r.net),
          payable: money(r.payable),
        }));
      break;
    }
    case "run_status_register": {
      columns = [
        { key: "month", header: "Month" },
        { key: "kind", header: "Kind" },
        { key: "status", header: "Status" },
        { key: "staff", header: "Staff", align: "right" },
        { key: "net", header: "Net ₹", align: "right" },
        { key: "created", header: "Created" },
        { key: "approved", header: "Approved" },
        { key: "posted", header: "Posted" },
        { key: "paid", header: "Paid" },
        { key: "by", header: "Created by" },
      ];
      rows = loadPayroll()
        .runs.filter((r) => runMatches(r, { ...filters, includeDraft: true }))
        .map((r) => ({
          month: r.month,
          kind: r.kind || "bulk",
          status: payrollStatusLabel(r.status),
          staff: r.lines.length,
          net: money(r.lines.reduce((s, l) => s + l.netPay, 0)),
          created: (r.createdAt || "").slice(0, 10),
          approved: (r.approvedAt || "").slice(0, 10),
          posted: (r.postedAt || "").slice(0, 10),
          paid: (r.paidAt || "").slice(0, 10),
          by: r.createdBy || "",
        }));
      break;
    }
    case "structure_assignment": {
      const masters = filters.masters || loadMasters();
      const salary = filters.salary || loadSalarySetup();
      columns = [
        { key: "emp", header: "Emp" },
        { key: "name", header: "Name" },
        { key: "stream", header: "Stream" },
        { key: "structure", header: "Structure" },
        { key: "basic", header: "Basic override", align: "right" },
        { key: "cover", header: "PF/ESIC cover" },
        { key: "from", header: "Effective from" },
        { key: "due", header: "Adv outstanding", align: "right" },
      ];
      rows = (masters.staff ?? [])
        .filter((s) => s.status === "active")
        .filter((s) => !filters.staffId || s.id === filters.staffId)
        .filter(
          (s) =>
            !filters.stream ||
            filters.stream === "all" ||
            s.stream === filters.stream,
        )
        .map((s) => {
          const link = salary.staffLinks.find((l) => l.staffId === s.id);
          const struct = link
            ? salary.structures.find((x) => x.id === link.structureId)
            : null;
          if (filters.structureId && struct?.id !== filters.structureId) {
            return null;
          }
          return {
            emp: s.empCode,
            name: s.fullName,
            stream: s.stream,
            structure: struct?.name || "—",
            basic: money(link?.basicOverride || 0),
            cover: link?.statutoryCover || "both",
            from: link?.effectiveFrom || "",
            due: money(outstandingForStaff(s.id)),
          };
        })
        .filter(Boolean) as Record<string, string | number>[];
      break;
    }
    case "pf_esic_staff_wise": {
      columns = [
        { key: "month", header: "Month" },
        { key: "emp", header: "Emp" },
        { key: "name", header: "Name" },
        { key: "cover", header: "Cover" },
        { key: "pf", header: "PF govt (EE+ER)", align: "right" },
        { key: "esic", header: "ESIC govt", align: "right" },
        { key: "employer", header: "Employer cost", align: "right" },
      ];
      rows = iterLines(filters, { publishedOnly: false })
        .filter(
          ({ line }) =>
            (line.pfGovtDeposit || 0) > 0 ||
            (line.esicGovtDeposit || 0) > 0 ||
            line.employerCost > 0,
        )
        .map(({ run, line }) => ({
          month: run.month,
          emp: line.empCode,
          name: line.fullName,
          cover: line.statutoryCover || "",
          pf: money(line.pfGovtDeposit || 0),
          esic: money(line.esicGovtDeposit || 0),
          employer: money(line.employerCost),
        }));
      break;
    }
    case "govt_remittance_batches": {
      columns = [
        { key: "month", header: "Month" },
        { key: "status", header: "Status" },
        { key: "pf", header: "PF total", align: "right" },
        { key: "esic", header: "ESIC total", align: "right" },
        { key: "grand", header: "Grand total", align: "right" },
        { key: "staff", header: "Staff lines", align: "right" },
        { key: "deposited", header: "Deposited at" },
        { key: "by", header: "Deposited by" },
        { key: "challan", header: "Challan note" },
      ];
      const { from, to } = resolveMonthBounds(filters);
      rows = loadStatutoryRemit()
        .batches.filter((b) => {
          if (
            filters.academicYearCode &&
            b.academicYearCode !== filters.academicYearCode
          ) {
            return false;
          }
          return inMonthRange(b.month, from, to);
        })
        .map((b) => ({
          month: b.month,
          status: b.status,
          pf: money(b.pfTotal),
          esic: money(b.esicTotal),
          grand: money(b.grandTotal),
          staff: b.lines.length,
          deposited: (b.depositedAt || "").slice(0, 10),
          by: b.depositedBy || "",
          challan: b.challanNote || "",
        }));
      break;
    }
    case "employer_cost_report": {
      columns = [
        { key: "month", header: "Month" },
        { key: "emp", header: "Emp" },
        { key: "name", header: "Name" },
        { key: "employer", header: "Employer ₹", align: "right" },
        { key: "net", header: "Net pay ₹", align: "right" },
      ];
      rows = iterLines(filters)
        .filter(({ line }) => line.employerCost > 0)
        .map(({ run, line }) => ({
          month: run.month,
          emp: line.empCode,
          name: line.fullName,
          employer: money(line.employerCost),
          net: money(line.netPay),
        }));
      break;
    }
    case "advance_outstanding": {
      columns = [
        { key: "emp", header: "Emp" },
        { key: "name", header: "Name" },
        { key: "open", header: "Open advances", align: "right" },
        { key: "due", header: "Outstanding ₹", align: "right" },
      ];
      const map = new Map<
        string,
        { emp: string; name: string; open: number; due: number }
      >();
      for (const a of loadAdvances().advances) {
        if (filters.staffId && a.staffId !== filters.staffId) continue;
        const bal = outstandingOf(a);
        if (bal <= 0) continue;
        const prev = map.get(a.staffId) || {
          emp: a.empCode,
          name: a.fullName,
          open: 0,
          due: 0,
        };
        prev.open += 1;
        prev.due += bal;
        map.set(a.staffId, prev);
      }
      rows = [...map.values()]
        .sort((a, b) => a.emp.localeCompare(b.emp))
        .map((r) => ({ ...r, due: money(r.due) }));
      break;
    }
    case "advance_ledger_detail": {
      columns = [
        { key: "emp", header: "Emp" },
        { key: "name", header: "Name" },
        { key: "given", header: "Given" },
        { key: "source", header: "Source" },
        { key: "mode", header: "Mode" },
        { key: "amount", header: "Amount", align: "right" },
        { key: "recovered", header: "Recovered", align: "right" },
        { key: "due", header: "Outstanding", align: "right" },
        { key: "status", header: "Status" },
        { key: "note", header: "Note" },
      ];
      const { from, to } = resolveMonthBounds(filters);
      rows = loadAdvances()
        .advances.filter((a) => {
          if (filters.staffId && a.staffId !== filters.staffId) return false;
          const ym = a.givenDate.slice(0, 7);
          return inMonthRange(ym, from, to);
        })
        .map((a) => ({
          emp: a.empCode,
          name: a.fullName,
          given: a.givenDate,
          source: advanceSourceLabel(a.source),
          mode: a.paymentMode,
          amount: money(a.amount),
          recovered: money(recoveredTotal(a)),
          due: money(outstandingOf(a)),
          status: a.status,
          note: a.note || "",
        }));
      break;
    }
    case "advance_recoveries": {
      columns = [
        { key: "emp", header: "Emp" },
        { key: "name", header: "Name" },
        { key: "method", header: "Method" },
        { key: "month", header: "Month / ref" },
        { key: "amount", header: "Amount ₹", align: "right" },
        { key: "detail", header: "Detail", width: 1.6 },
        { key: "by", header: "By" },
      ];
      const { from, to } = resolveMonthBounds(filters);
      for (const a of loadAdvances().advances) {
        if (filters.staffId && a.staffId !== filters.staffId) continue;
        for (const r of a.recoveries) {
          const ym = r.month || r.recoveredAt.slice(0, 7);
          if (!inMonthRange(ym, from, to)) continue;
          rows.push({
            emp: a.empCode,
            name: a.fullName,
            method: recoveryMethodLabel(r.method),
            month: ym,
            amount: money(r.amount),
            detail: formatRecoveryDetail(r),
            by: r.recoveredBy || "",
          });
        }
      }
      break;
    }
    case "june_hold_register": {
      columns = [
        { key: "month", header: "Month" },
        { key: "emp", header: "Emp" },
        { key: "name", header: "Name" },
        { key: "net", header: "Held net ₹", align: "right" },
        { key: "eligible", header: "Drawable" },
        { key: "status", header: "Status" },
      ];
      const holdState = loadSalaryHold();
      const { from, to } = resolveMonthBounds(filters);
      rows = holdState.holds
        .filter((h) => inMonthRange(h.month, from, to))
        .filter((h) => !filters.staffId || h.staffId === filters.staffId)
        .map((h) => ({
          month: h.month,
          emp: h.empCode,
          name: h.fullName,
          net: money(h.amount),
          eligible: h.eligibleForDraw ? "Yes" : "No",
          status: h.status,
        }));
      break;
    }
    case "exit_settlement_report": {
      columns = [
        { key: "emp", header: "Emp" },
        { key: "name", header: "Name" },
        { key: "notice", header: "Notice date" },
        { key: "leaving", header: "Leaving date" },
        { key: "status", header: "Status" },
        { key: "amount", header: "Settlement ₹", align: "right" },
        { key: "note", header: "Note" },
      ];
      const settlements = loadSalaryHold().settlements ?? [];
      rows = settlements
        .filter((s) => !filters.staffId || s.staffId === filters.staffId)
        .map((s) => ({
          emp: s.empCode || "",
          name: s.fullName || "",
          notice: s.noticeDate || "",
          leaving: s.leavingDate || "",
          status: s.status || "",
          amount: money(s.totalPayable || 0),
          note: s.note || "",
        }));
      break;
    }
    case "increment_batches": {
      columns = [
        { key: "label", header: "Label" },
        { key: "kind", header: "Kind" },
        { key: "effective", header: "Effective" },
        { key: "status", header: "Status" },
        { key: "included", header: "Included", align: "right" },
        { key: "created", header: "Created" },
        { key: "applied", header: "Applied" },
      ];
      const { from, to } = resolveMonthBounds(filters);
      rows = loadIncrementState()
        .batches.filter((b) => {
          if (
            filters.academicYearCode &&
            b.academicYearCode !== filters.academicYearCode
          ) {
            return false;
          }
          const ym = b.effectiveFrom.slice(0, 7);
          return inMonthRange(ym, from, to);
        })
        .map((b) => ({
          label: b.label,
          kind: b.kind,
          effective: b.effectiveFrom,
          status: incrementBatchStatusLabel(b.status),
          included: b.lines.filter((l) => l.status === "included").length,
          created: (b.createdAt || "").slice(0, 10),
          applied: (b.appliedAt || "").slice(0, 10),
        }));
      break;
    }
    case "increment_staff_lines": {
      columns = [
        { key: "batch", header: "Batch" },
        { key: "effective", header: "Effective" },
        { key: "emp", header: "Emp" },
        { key: "name", header: "Name" },
        { key: "old", header: "Old basic", align: "right" },
        { key: "mode", header: "Mode" },
        { key: "value", header: "Value", align: "right" },
        { key: "new", header: "New basic", align: "right" },
        { key: "status", header: "Line" },
        { key: "batchStatus", header: "Batch status" },
      ];
      const { from, to } = resolveMonthBounds(filters);
      for (const b of loadIncrementState().batches) {
        const ym = b.effectiveFrom.slice(0, 7);
        if (!inMonthRange(ym, from, to)) continue;
        for (const l of b.lines) {
          if (filters.staffId && l.staffId !== filters.staffId) continue;
          if (
            filters.stream &&
            filters.stream !== "all" &&
            l.stream !== filters.stream
          ) {
            continue;
          }
          rows.push({
            batch: b.label,
            effective: b.effectiveFrom,
            emp: l.empCode,
            name: l.fullName,
            old: money(l.oldBasic),
            mode: l.mode,
            value: l.value,
            new: money(l.newBasic),
            status: l.status,
            batchStatus: incrementBatchStatusLabel(b.status),
          });
        }
      }
      break;
    }
    case "salary_account_postings": {
      columns = [
        { key: "month", header: "Month" },
        { key: "emp", header: "Emp" },
        { key: "name", header: "Name" },
        { key: "type", header: "Entry type" },
        { key: "amount", header: "Amount ₹", align: "right" },
        { key: "account", header: "Account" },
        { key: "posted", header: "Posted at" },
        { key: "by", header: "By" },
        { key: "voided", header: "Voided" },
      ];
      const { from, to } = resolveMonthBounds(filters);
      rows = loadSalaryAccount()
        .entries.filter((e) => {
          if (!filters.includeVoidedAccount && e.voided) return false;
          if (filters.staffId && e.staffId !== filters.staffId) return false;
          return inMonthRange(e.month, from, to);
        })
        .map((e) => ({
          month: e.month,
          emp: e.empCode,
          name: e.fullName,
          type: entryTypeLabel(e.entryType),
          amount: money(e.amount),
          account: e.salaryAccountLabel,
          posted: (e.postedAt || "").slice(0, 10),
          by: e.postedBy || "",
          voided: e.voided ? "yes" : "no",
        }));
      break;
    }
    default:
      return { ok: false, error: "Report not implemented" };
  }

  if (rows.length === 0) {
    return {
      ok: false,
      error: "No rows for these filters — adjust month/status/staff and retry",
    };
  }

  const result = exportFilterReport(
    {
      title,
      subtitle: "Payroll reports",
      filterNote: note,
      columns,
      rows,
      fileBaseName: fileBase,
    },
    format,
  );
  if (!result.ok) return result;
  return {
    ok: true,
    message: `${title}: ${rows.length} row(s) exported as ${format.toUpperCase()}`,
  };
}
