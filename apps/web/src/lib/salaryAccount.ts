/**
 * Salary account ledger — entries are written only when a payroll run
 * is published (posted). Draft / pending / approved (pre-publish) never touch this.
 */

import { loadSalarySetup, normalizeSalarySettings } from "@/lib/salarySetup";
import type { PayrollRun, PayrollStaffLine } from "@/lib/payroll";

import { assertModulePermission } from "@/lib/rbacGuard";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";
export type SalaryAccountEntryType =
  | "net_payable"
  | "june_hold"
  | "pf_govt"
  | "esic_govt"
  | "employer_cost";

export type SalaryAccountEntry = {
  id: string;
  runId: string;
  month: string;
  academicYearCode: string;
  staffId: string;
  empCode: string;
  fullName: string;
  entryType: SalaryAccountEntryType;
  amount: number;
  salaryAccountLabel: string;
  postedBy: string;
  postedAt: string;
  /** voided if run republished after recall (we replace by runId) */
  voided: boolean;
};

export type SalaryAccountState = {
  version: 1;
  entries: SalaryAccountEntry[];
};

const STORAGE_KEY = "bhb_salary_account_v1";

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function loadSalaryAccount(): SalaryAccountState {
  if (typeof window === "undefined") return { version: 1, entries: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, entries: [] };
    const parsed = JSON.parse(raw) as Partial<SalaryAccountState>;
    return {
      version: 1,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    return { version: 1, entries: [] };
  }
}

export function saveSalaryAccount(state: SalaryAccountState) {
  if (!assertModulePermission("payroll", "edit", "saveSalaryAccount")) return;
  if (typeof window === "undefined") return;
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(state));
  void import("@/lib/localModulesPersistence").then((m) => m.scheduleModuleStateSync("salary_account", state));
}

/** Hydrate path (module_local_state) — cache write only, no RBAC, no push. */
export function writeSalaryAccountLocalRaw(state: SalaryAccountState): void {
  if (typeof window === "undefined") return;
  try {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota — the server copy is the truth anyway */
  }
}

function entriesFromLine(
  run: PayrollRun,
  line: PayrollStaffLine,
  label: string,
  by: string,
  at: string,
): SalaryAccountEntry[] {
  const base = {
    runId: run.id,
    month: run.month,
    academicYearCode: run.academicYearCode,
    staffId: line.staffId,
    empCode: line.empCode,
    fullName: line.fullName,
    salaryAccountLabel: label,
    postedBy: by,
    postedAt: at,
    voided: false,
  };
  const out: SalaryAccountEntry[] = [];
  const payable = line.amountPayable ?? (line.juneHold ? 0 : line.netPay);
  if (payable > 0) {
    out.push({
      ...base,
      id: nid("sa"),
      entryType: "net_payable",
      amount: payable,
    });
  }
  if (line.juneHold && line.netPay > 0) {
    out.push({
      ...base,
      id: nid("sa"),
      entryType: "june_hold",
      amount: line.netPay,
    });
  }
  if ((line.pfGovtDeposit || 0) > 0) {
    out.push({
      ...base,
      id: nid("sa"),
      entryType: "pf_govt",
      amount: line.pfGovtDeposit,
      salaryAccountLabel: "EPFO",
    });
  }
  if ((line.esicGovtDeposit || 0) > 0) {
    out.push({
      ...base,
      id: nid("sa"),
      entryType: "esic_govt",
      amount: line.esicGovtDeposit,
      salaryAccountLabel: "ESIC",
    });
  }
  if (line.employerCost > 0) {
    out.push({
      ...base,
      id: nid("sa"),
      entryType: "employer_cost",
      amount: line.employerCost,
    });
  }
  return out;
}

/**
 * Replace any prior live entries for this run and post fresh ones.
 * Call only from publishPayrollToAccounts.
 */
export function postPayrollToSalaryAccount(
  run: PayrollRun,
  by: string,
): SalaryAccountState {
  const salary = loadSalarySetup();
  const label =
    normalizeSalarySettings(salary.settings).salaryAccountLabel ||
    "Salary account";
  const at = new Date().toISOString();
  const state = loadSalaryAccount();
  const kept = state.entries.map((e) =>
    e.runId === run.id && !e.voided ? { ...e, voided: true } : e,
  );
  const fresh: SalaryAccountEntry[] = [];
  for (const line of run.lines) {
    fresh.push(...entriesFromLine(run, line, label, by, at));
  }
  const next = { version: 1 as const, entries: [...kept, ...fresh] };
  saveSalaryAccount(next);
  return next;
}

/** Soft-void all account entries for a run (when recalled to draft). */
export function voidSalaryAccountForRun(runId: string): SalaryAccountState {
  const state = loadSalaryAccount();
  const next = {
    version: 1 as const,
    entries: state.entries.map((e) =>
      e.runId === runId ? { ...e, voided: true } : e,
    ),
  };
  saveSalaryAccount(next);
  return next;
}

export function liveEntriesForRun(runId: string): SalaryAccountEntry[] {
  return loadSalaryAccount().entries.filter(
    (e) => e.runId === runId && !e.voided,
  );
}

export function salaryAccountCsv(
  entries: SalaryAccountEntry[],
): string {
  const rows: string[][] = [
    [
      "Month",
      "EmpCode",
      "Name",
      "EntryType",
      "Amount",
      "Account",
      "PostedAt",
      "PostedBy",
      "RunId",
      "Voided",
    ],
  ];
  for (const e of entries) {
    rows.push([
      e.month,
      e.empCode,
      e.fullName,
      e.entryType,
      String(e.amount),
      e.salaryAccountLabel,
      e.postedAt,
      e.postedBy,
      e.runId,
      e.voided ? "yes" : "no",
    ]);
  }
  return rows
    .map((r) =>
      r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");
}

export function entryTypeLabel(t: SalaryAccountEntryType): string {
  switch (t) {
    case "net_payable":
      return "Net payable";
    case "june_hold":
      return "June hold";
    case "pf_govt":
      return "PF → Govt";
    case "esic_govt":
      return "ESIC → Govt";
    case "employer_cost":
      return "Employer cost";
    default:
      return t;
  }
}
