/**
 * Salary register — one row per staff for a payroll run, every earning /
 * deduction head as its own column (only heads that occur in the run),
 * then gross · total deductions · net · payable · payment · employer
 * contributions · Govt remittances, with a totals row. Pure: used by the
 * CSV / Excel / PDF exports and the on-screen preview.
 *
 * (The old "Preview CSV" was the Tally-style ledger — one row per head per
 * staff — which reads as duplicates in a spreadsheet. That export remains
 * as "Tally ledger CSV" for accounts import.)
 */

import type { ReportColumn } from "@/lib/reportExport";
import type { PayrollRun, PayrollStaffLine } from "@/lib/payroll";
import { paymentModeLabel } from "@/lib/payroll";

export type SalaryRegister = {
  columns: ReportColumn[];
  rows: Record<string, string | number>[];
  totals: Record<string, string | number>;
  earningHeads: { code: string; name: string }[];
  deductionHeads: { code: string; name: string }[];
  employerHeads: { code: string; name: string }[];
};

function headKey(kind: string, code: string): string {
  return `${kind}:${code}`;
}

/** Short column headers so a landscape A4 fits; unknown heads keep their name. */
const SHORT_HEAD: Record<string, string> = {
  BASIC: "Basic",
  ADDL: "Additional",
  PF_EE: "PF (EE)",
  ESIC_EE: "ESIC (EE)",
  ESI_EE: "ESIC (EE)",
  PF_ER: "PF (ER)",
  ESIC_ER: "ESIC (ER)",
  ESI_ER: "ESIC (ER)",
  PT: "Prof. tax",
  TDS: "TDS",
  ADV: "Advance",
  LWP: "LWP",
  LATE: "Late",
  DA: "DA",
  HRA: "HRA",
  TA: "TA",
  SA: "Special",
};
function shortHead(code: string, name: string): string {
  return SHORT_HEAD[code.toUpperCase()] || (name.length > 14 ? `${name.slice(0, 13)}…` : name);
}

export function buildSalaryRegister(run: PayrollRun, opts?: { salaryAccountLabel?: string }): SalaryRegister {
  // Collect heads in first-seen order per kind.
  const seen = new Map<string, { kind: "earning" | "deduction" | "employer"; code: string; name: string }>();
  for (const l of run.lines) {
    for (const c of l.components) {
      const k = headKey(c.kind, c.headCode);
      if (!seen.has(k)) seen.set(k, { kind: c.kind, code: c.headCode, name: c.headName });
    }
  }
  const heads = [...seen.values()];
  const order = (kind: "earning" | "deduction" | "employer") =>
    heads.filter((h) => h.kind === kind).sort((a, b) => (a.code === "BASIC" ? -1 : b.code === "BASIC" ? 1 : 0));
  const earningHeads = order("earning");
  const deductionHeads = order("deduction");
  const employerHeads = order("employer");

  const columns: ReportColumn[] = [
    { key: "sno", header: "#", width: 0.4, align: "right" },
    { key: "empCode", header: "Emp code", width: 0.9 },
    { key: "name", header: "Name", width: 1.8 },
    { key: "days", header: "Paid days", width: 0.7, align: "right" },
    ...earningHeads.map((h) => ({ key: headKey("earning", h.code), header: shortHead(h.code, h.name), width: 0.9, align: "right" as const })),
    { key: "gross", header: "Gross", width: 0.9, align: "right" },
    ...deductionHeads.map((h) => ({ key: headKey("deduction", h.code), header: shortHead(h.code, h.name), width: 0.9, align: "right" as const })),
    { key: "totalDeductions", header: "Total ded.", width: 0.9, align: "right" },
    { key: "net", header: "Net pay", width: 0.9, align: "right" },
    { key: "payable", header: "Payable", width: 0.9, align: "right" },
    { key: "payment", header: "Payment", width: 1.1 },
    ...employerHeads.map((h) => ({ key: headKey("employer", h.code), header: shortHead(h.code, h.name), width: 0.9, align: "right" as const })),
    { key: "govtPf", header: "PF→Govt", width: 0.8, align: "right" },
    { key: "govtEsic", header: "ESIC→Govt", width: 0.8, align: "right" },
    { key: "employerCost", header: "Emp. cost", width: 0.9, align: "right" },
  ];

  const numericKeys = columns.filter((c) => c.align === "right" && c.key !== "sno" && c.key !== "days").map((c) => c.key);
  const totals: Record<string, string | number> = { sno: "", empCode: "", name: "TOTAL", days: "", payment: "" };
  for (const k of numericKeys) totals[k] = 0;

  const rows = [...run.lines]
    .sort((a, b) => a.empCode.localeCompare(b.empCode, undefined, { numeric: true }))
    .map((l: PayrollStaffLine, i) => {
      const row: Record<string, string | number> = {
        sno: i + 1,
        empCode: l.empCode,
        name: l.fullName,
        days: `${l.daysPresent + l.daysLeavePaid + l.daysHoliday}${l.daysLwp ? ` (LWP ${l.daysLwp})` : ""}`,
        gross: l.gross,
        totalDeductions: l.totalDeductions,
        net: l.netPay,
        payable: l.amountPayable ?? l.netPay,
        payment: [paymentModeLabel(l.paymentMode), l.paymentDate, l.juneHold ? "HOLD" : ""].filter(Boolean).join(" · "),
        govtPf: l.pfGovtDeposit || 0,
        govtEsic: l.esicGovtDeposit || 0,
        employerCost: l.employerCost,
      };
      for (const h of heads) row[headKey(h.kind, h.code)] = 0;
      for (const c of l.components) {
        const k = headKey(c.kind, c.headCode);
        row[k] = (Number(row[k]) || 0) + c.amount;
      }
      for (const k of numericKeys) totals[k] = (Number(totals[k]) || 0) + (Number(row[k]) || 0);
      return row;
    });

  void opts;
  return { columns, rows, totals, earningHeads, deductionHeads, employerHeads };
}

export function salaryRegisterTitle(run: PayrollRun): string {
  return `Salary register · ${run.month} · ${run.status}`;
}
