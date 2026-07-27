import { assertModulePermission } from "@/lib/rbacGuard";
/**
 * PF / ESIC remittance to Government.
 * When staff avails PF and/or ESIC, employee deduction + employer
 * contribution are payable to Govt (EPFO / ESIC) — not to staff.
 */

export type StatutoryRemitLine = {
  staffId: string;
  empCode: string;
  fullName: string;
  statutoryCover: string;
  pfEmployee: number;
  pfEmployer: number;
  esicEmployee: number;
  esicEmployer: number;
};

export type StatutoryRemitStatus = "pending_deposit" | "deposited";

export type StatutoryRemitBatch = {
  id: string;
  month: string;
  academicYearCode: string;
  payrollRunId: string;
  status: StatutoryRemitStatus;
  lines: StatutoryRemitLine[];
  pfTotal: number;
  esicTotal: number;
  grandTotal: number;
  createdAt: string;
  depositedAt: string;
  depositedBy: string;
  challanNote: string;
};

export type StatutoryRemitState = {
  version: 1;
  batches: StatutoryRemitBatch[];
};

const STORAGE_KEY = "bhb_statutory_remit_v1";

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function isPfHeadCode(code: string): boolean {
  const c = (code || "").toUpperCase();
  return c === "PF_EE" || c === "PF_ER" || c.startsWith("PF_");
}

export function isEsicHeadCode(code: string): boolean {
  const c = (code || "").toUpperCase();
  return (
    c === "ESIC_EE" ||
    c === "ESIC_ER" ||
    c.startsWith("ESIC_") ||
    c === "ESI_EE" ||
    c === "ESI_ER" ||
    c.startsWith("ESI_")
  );
}

export function isPfEmployeeCode(code: string): boolean {
  const c = (code || "").toUpperCase();
  if (c === "PF_EE") return true;
  return c.endsWith("_EE") && isPfHeadCode(c);
}

export function isPfEmployerCode(code: string): boolean {
  const c = (code || "").toUpperCase();
  if (c === "PF_ER") return true;
  return c.endsWith("_ER") && isPfHeadCode(c);
}

export function isEsicEmployeeCode(code: string): boolean {
  const c = (code || "").toUpperCase();
  if (c === "ESIC_EE" || c === "ESI_EE") return true;
  return c.endsWith("_EE") && isEsicHeadCode(c);
}

export function isEsicEmployerCode(code: string): boolean {
  const c = (code || "").toUpperCase();
  if (c === "ESIC_ER" || c === "ESI_ER") return true;
  return c.endsWith("_ER") && isEsicHeadCode(c);
}

export type PayrollComponentLike = {
  headCode: string;
  kind: string;
  amount: number;
};

/** Split PF/ESIC components into govt deposit buckets (EE + ER). */
export function govtDepositFromComponents(
  components: PayrollComponentLike[],
): {
  pfEmployee: number;
  pfEmployer: number;
  esicEmployee: number;
  esicEmployer: number;
  pfTotal: number;
  esicTotal: number;
  govtTotal: number;
} {
  let pfEmployee = 0;
  let pfEmployer = 0;
  let esicEmployee = 0;
  let esicEmployer = 0;
  for (const c of components) {
    const amt = Math.max(0, Number(c.amount) || 0);
    if (!amt) continue;
    const code = c.headCode || "";
    if (isPfEmployerCode(code) || (c.kind === "employer" && isPfHeadCode(code))) {
      pfEmployer += amt;
    } else if (isPfEmployeeCode(code) || (c.kind === "deduction" && isPfHeadCode(code))) {
      pfEmployee += amt;
    } else if (
      isEsicEmployerCode(code) ||
      (c.kind === "employer" && isEsicHeadCode(code))
    ) {
      esicEmployer += amt;
    } else if (
      isEsicEmployeeCode(code) ||
      (c.kind === "deduction" && isEsicHeadCode(code))
    ) {
      esicEmployee += amt;
    }
  }
  const pfTotal = pfEmployee + pfEmployer;
  const esicTotal = esicEmployee + esicEmployer;
  return {
    pfEmployee,
    pfEmployer,
    esicEmployee,
    esicEmployer,
    pfTotal,
    esicTotal,
    govtTotal: pfTotal + esicTotal,
  };
}

export function loadStatutoryRemit(): StatutoryRemitState {
  if (typeof window === "undefined") return { version: 1, batches: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, batches: [] };
    const parsed = JSON.parse(raw) as Partial<StatutoryRemitState>;
    return {
      version: 1,
      batches: Array.isArray(parsed.batches) ? parsed.batches : [],
    };
  } catch {
    return { version: 1, batches: [] };
  }
}

export function saveStatutoryRemit(state: StatutoryRemitState) {
  if (!assertModulePermission("payroll", "edit", "saveStatutoryRemit")) return;
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/** Create / refresh remittance batch when payroll is published to accounts. */
export function syncRemitFromPayrollRun(input: {
  runId: string;
  month: string;
  academicYearCode: string;
  lines: {
    staffId: string;
    empCode: string;
    fullName: string;
    statutoryCover?: string;
    components: PayrollComponentLike[];
  }[];
}): StatutoryRemitState {
  const state = loadStatutoryRemit();
  const remitLines: StatutoryRemitLine[] = [];
  for (const line of input.lines) {
    const g = govtDepositFromComponents(line.components);
    if (g.govtTotal <= 0) continue;
    remitLines.push({
      staffId: line.staffId,
      empCode: line.empCode,
      fullName: line.fullName,
      statutoryCover: line.statutoryCover || "",
      pfEmployee: g.pfEmployee,
      pfEmployer: g.pfEmployer,
      esicEmployee: g.esicEmployee,
      esicEmployer: g.esicEmployer,
    });
  }

  if (remitLines.length === 0) {
    // Remove empty pending batch for this run if any
    const next = {
      ...state,
      batches: state.batches.filter(
        (b) =>
          !(
            b.payrollRunId === input.runId &&
            b.status === "pending_deposit"
          ),
      ),
    };
    saveStatutoryRemit(next);
    return next;
  }

  const pfTotal = remitLines.reduce(
    (s, l) => s + l.pfEmployee + l.pfEmployer,
    0,
  );
  const esicTotal = remitLines.reduce(
    (s, l) => s + l.esicEmployee + l.esicEmployer,
    0,
  );

  const existingIdx = state.batches.findIndex(
    (b) => b.payrollRunId === input.runId,
  );
  const existing = existingIdx >= 0 ? state.batches[existingIdx] : null;
  // Don't overwrite already deposited batches
  if (existing?.status === "deposited") return state;

  const batch: StatutoryRemitBatch = {
    id: existing?.id || nid("sr"),
    month: input.month,
    academicYearCode: input.academicYearCode,
    payrollRunId: input.runId,
    status: "pending_deposit",
    lines: remitLines,
    pfTotal,
    esicTotal,
    grandTotal: pfTotal + esicTotal,
    createdAt: existing?.createdAt || new Date().toISOString(),
    depositedAt: "",
    depositedBy: "",
    challanNote: "",
  };

  const batches =
    existingIdx >= 0
      ? state.batches.map((b, i) => (i === existingIdx ? batch : b))
      : [batch, ...state.batches];

  const next = { version: 1 as const, batches };
  saveStatutoryRemit(next);
  return next;
}

export function markRemitDeposited(input: {
  batchId: string;
  by: string;
  challanNote?: string;
}): { ok: true } | { ok: false; error: string } {
  const state = loadStatutoryRemit();
  const batch = state.batches.find((b) => b.id === input.batchId);
  if (!batch) return { ok: false, error: "Remittance batch not found" };
  if (batch.status === "deposited") {
    return { ok: false, error: "Already marked deposited" };
  }
  saveStatutoryRemit({
    ...state,
    batches: state.batches.map((b) =>
      b.id === input.batchId
        ? {
            ...b,
            status: "deposited",
            depositedAt: new Date().toISOString(),
            depositedBy: input.by,
            challanNote: input.challanNote?.trim() || b.challanNote,
          }
        : b,
    ),
  });
  return { ok: true };
}

export function remitStatusLabel(s: StatutoryRemitStatus): string {
  return s === "deposited" ? "Deposited to Govt" : "Pending govt deposit";
}

export function statutoryRemitCsv(batch: StatutoryRemitBatch): string {
  const rows: string[][] = [
    [
      "Month",
      "EmpCode",
      "Name",
      "Cover",
      "PF Employee",
      "PF Employer",
      "PF Total",
      "ESIC Employee",
      "ESIC Employer",
      "ESIC Total",
      "Govt Payable",
      "Status",
    ],
  ];
  for (const l of batch.lines) {
    const pf = l.pfEmployee + l.pfEmployer;
    const esic = l.esicEmployee + l.esicEmployer;
    rows.push([
      batch.month,
      l.empCode,
      l.fullName,
      l.statutoryCover,
      String(l.pfEmployee),
      String(l.pfEmployer),
      String(pf),
      String(l.esicEmployee),
      String(l.esicEmployer),
      String(esic),
      String(pf + esic),
      batch.status,
    ]);
  }
  rows.push([
    batch.month,
    "",
    "TOTAL",
    "",
    "",
    "",
    String(batch.pfTotal),
    "",
    "",
    String(batch.esicTotal),
    String(batch.grandTotal),
    batch.status,
  ]);
  return rows
    .map((r) =>
      r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");
}
