import { assertModulePermission } from "@/lib/rbacGuard";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";
import { loadMasters } from "@/lib/masters";
import { normalizeStatutoryConfig } from "@/lib/foundationMasters";
import {
  splitEmployerPfContribution,
  type StatutoryDue,
} from "@/lib/statutoryCompliance";
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
  /** EPF/EPS/EDLI wage-ceiling reporting split (money already withheld — see statutoryCompliance.ts) */
  epfWages: number;
  epsWages: number;
  edliWages: number;
  epsAmount: number;
  edliAmount: number;
  uanNumber: string;
  esicIpNumber: string;
};

export type StatutoryRemitStatus = "pending_deposit" | "deposited";

/** Filing/payment progress for one statutory scheme (EPF or ESIC) within a batch. */
export type StatutoryFilingProgress = {
  filedAt: string;
  filedBy: string;
  challanRefNo: string;
  paidAt: string;
  paidBy: string;
  receiptFileUrl: string;
};

function emptyFilingProgress(): StatutoryFilingProgress {
  return {
    filedAt: "",
    filedBy: "",
    challanRefNo: "",
    paidAt: "",
    paidBy: "",
    receiptFileUrl: "",
  };
}

export type StatutoryRemitBatch = {
  id: string;
  month: string;
  academicYearCode: string;
  payrollRunId: string;
  /** @deprecated kept for batches created before EPF/ESIC were tracked independently — read via epf/esic instead */
  status: StatutoryRemitStatus;
  lines: StatutoryRemitLine[];
  pfTotal: number;
  esicTotal: number;
  grandTotal: number;
  createdAt: string;
  /** @deprecated */
  depositedAt: string;
  /** @deprecated */
  depositedBy: string;
  /** @deprecated free-text note — use epf.challanRefNo / esic.challanRefNo instead */
  challanNote: string;
  totalMembers: number;
  returnFileId: string;
  contributionRatePct: number;
  totalEpfContribution: number;
  totalEpsContribution: number;
  totalEpfEpsContribution: number;
  totalEdliContribution: number;
  totalIpContribution: number;
  epf: StatutoryFilingProgress;
  esic: StatutoryFilingProgress;
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

/** Back-fills new fields on batches/lines saved before EPF/EPS/EDLI + independent EPF/ESIC filing existed. */
function normalizeBatch(b: Partial<StatutoryRemitBatch>): StatutoryRemitBatch {
  const lines: StatutoryRemitLine[] = (b.lines || []).map((l) => ({
    staffId: l.staffId,
    empCode: l.empCode,
    fullName: l.fullName,
    statutoryCover: l.statutoryCover,
    pfEmployee: l.pfEmployee || 0,
    pfEmployer: l.pfEmployer || 0,
    esicEmployee: l.esicEmployee || 0,
    esicEmployer: l.esicEmployer || 0,
    epfWages: l.epfWages || 0,
    epsWages: l.epsWages || 0,
    edliWages: l.edliWages || 0,
    epsAmount: l.epsAmount || 0,
    edliAmount: l.edliAmount || 0,
    uanNumber: l.uanNumber || "",
    esicIpNumber: l.esicIpNumber || "",
  }));
  return {
    id: b.id || nid("sr"),
    month: b.month || "",
    academicYearCode: b.academicYearCode || "",
    payrollRunId: b.payrollRunId || "",
    status: b.status || "pending_deposit",
    lines,
    pfTotal: b.pfTotal || 0,
    esicTotal: b.esicTotal || 0,
    grandTotal: b.grandTotal || 0,
    createdAt: b.createdAt || new Date().toISOString(),
    depositedAt: b.depositedAt || "",
    depositedBy: b.depositedBy || "",
    challanNote: b.challanNote || "",
    totalMembers: b.totalMembers || lines.length,
    returnFileId: b.returnFileId || "",
    contributionRatePct: b.contributionRatePct || 12,
    totalEpfContribution:
      b.totalEpfContribution ??
      lines.reduce((s, l) => s + l.pfEmployee + Math.max(0, l.pfEmployer - l.epsAmount), 0),
    totalEpsContribution:
      b.totalEpsContribution ?? lines.reduce((s, l) => s + l.epsAmount, 0),
    totalEpfEpsContribution:
      b.totalEpfEpsContribution ??
      lines.reduce((s, l) => s + l.pfEmployee + l.pfEmployer, 0),
    totalEdliContribution:
      b.totalEdliContribution ?? lines.reduce((s, l) => s + l.edliAmount, 0),
    totalIpContribution:
      b.totalIpContribution ?? lines.reduce((s, l) => s + l.esicEmployee, 0),
    epf:
      b.epf ||
      (b.status === "deposited"
        ? {
            ...emptyFilingProgress(),
            filedAt: b.depositedAt || "",
            filedBy: b.depositedBy || "",
            paidAt: b.depositedAt || "",
            paidBy: b.depositedBy || "",
            challanRefNo: b.challanNote || "",
          }
        : emptyFilingProgress()),
    esic:
      b.esic ||
      (b.status === "deposited"
        ? {
            ...emptyFilingProgress(),
            filedAt: b.depositedAt || "",
            filedBy: b.depositedBy || "",
            paidAt: b.depositedAt || "",
            paidBy: b.depositedBy || "",
            challanRefNo: b.challanNote || "",
          }
        : emptyFilingProgress()),
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
      batches: Array.isArray(parsed.batches)
        ? parsed.batches.map(normalizeBatch)
        : [],
    };
  } catch {
    return { version: 1, batches: [] };
  }
}

export function saveStatutoryRemit(state: StatutoryRemitState) {
  if (!assertModulePermission("payroll", "edit", "saveStatutoryRemit")) return;
  if (typeof window === "undefined") return;
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(state));
  void import("@/lib/statutoryNormalizedClient").then(
    ({ scheduleStatutoryDeskSync }) => {
      scheduleStatutoryDeskSync(state);
    },
  );
}

/** Permission-bypassing raw writer — hydration-only, mirrors payroll.ts's writePayrollLocalRaw.
 * Does not re-trigger the sync scheduler (would otherwise push straight back what was just pulled). */
export function writeStatutoryRemitLocalRaw(state: StatutoryRemitState) {
  if (typeof window === "undefined") return;
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(state));
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
  const masters = loadMasters();
  const config = normalizeStatutoryConfig(masters.statutoryConfig);
  const staffById = new Map(masters.staff.map((s) => [s.id, s]));
  const remitLines: StatutoryRemitLine[] = [];
  for (const line of input.lines) {
    const g = govtDepositFromComponents(line.components);
    if (g.govtTotal <= 0) continue;
    const basic =
      line.components.find((c) => c.headCode === "BASIC")?.amount || 0;
    const split = splitEmployerPfContribution(basic, g.pfEmployer, config);
    const staff = staffById.get(line.staffId);
    remitLines.push({
      staffId: line.staffId,
      empCode: line.empCode,
      fullName: line.fullName,
      statutoryCover: line.statutoryCover || "",
      pfEmployee: g.pfEmployee,
      pfEmployer: g.pfEmployer,
      esicEmployee: g.esicEmployee,
      esicEmployer: g.esicEmployer,
      epfWages: split.epfWages,
      epsWages: split.epsWages,
      edliWages: split.edliWages,
      epsAmount: split.epsAmount,
      edliAmount: split.edliAmount,
      uanNumber: staff?.uanNumber || "",
      esicIpNumber: staff?.esicNumber || "",
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
  const totalEpfContribution = remitLines.reduce(
    (s, l) => s + l.pfEmployee + Math.max(0, l.pfEmployer - l.epsAmount),
    0,
  );
  const totalEpsContribution = remitLines.reduce(
    (s, l) => s + l.epsAmount,
    0,
  );
  const totalEdliContribution = remitLines.reduce(
    (s, l) => s + l.edliAmount,
    0,
  );
  const totalIpContribution = remitLines.reduce(
    (s, l) => s + l.esicEmployee,
    0,
  );

  const existingIdx = state.batches.findIndex(
    (b) => b.payrollRunId === input.runId,
  );
  const existing = existingIdx >= 0 ? state.batches[existingIdx] : null;
  // Don't overwrite a batch once both EPF and ESIC are fully paid — the money has already moved.
  if (existing?.epf.paidAt && existing?.esic.paidAt) return state;

  const batch: StatutoryRemitBatch = {
    id: existing?.id || nid("sr"),
    month: input.month,
    academicYearCode: input.academicYearCode,
    payrollRunId: input.runId,
    status: existing?.status || "pending_deposit",
    lines: remitLines,
    pfTotal,
    esicTotal,
    grandTotal: pfTotal + esicTotal,
    createdAt: existing?.createdAt || new Date().toISOString(),
    depositedAt: existing?.depositedAt || "",
    depositedBy: existing?.depositedBy || "",
    challanNote: existing?.challanNote || "",
    totalMembers: existing?.totalMembers || remitLines.length,
    returnFileId: existing?.returnFileId || "",
    contributionRatePct: existing?.contributionRatePct || config.epfContributionRatePct,
    totalEpfContribution,
    totalEpsContribution,
    totalEpfEpsContribution: totalEpfContribution + totalEpsContribution,
    totalEdliContribution,
    totalIpContribution,
    epf: existing?.epf || emptyFilingProgress(),
    esic: existing?.esic || emptyFilingProgress(),
  };

  const batches =
    existingIdx >= 0
      ? state.batches.map((b, i) => (i === existingIdx ? batch : b))
      : [batch, ...state.batches];

  const next = { version: 1 as const, batches };
  saveStatutoryRemit(next);
  return next;
}

function updateBatch(
  batchId: string,
  fn: (b: StatutoryRemitBatch) => StatutoryRemitBatch,
): { ok: true } | { ok: false; error: string } {
  const state = loadStatutoryRemit();
  const batch = state.batches.find((b) => b.id === batchId);
  if (!batch) return { ok: false, error: "Remittance batch not found" };
  const updated = fn(batch);
  const bothPaid = !!(updated.epf.paidAt && updated.esic.paidAt);
  saveStatutoryRemit({
    ...state,
    batches: state.batches.map((b) =>
      b.id === batchId
        ? { ...updated, status: bothPaid ? "deposited" : "pending_deposit" }
        : b,
    ),
  });
  return { ok: true };
}

/** File the EPF return (ECR) for a batch — Return File ID + member count, before payment. */
export function markEpfReturnFiled(input: {
  batchId: string;
  by: string;
  returnFileId: string;
  totalMembers?: number;
}): { ok: true } | { ok: false; error: string } {
  return updateBatch(input.batchId, (b) => ({
    ...b,
    returnFileId: input.returnFileId.trim() || b.returnFileId,
    totalMembers: input.totalMembers || b.totalMembers,
    epf: {
      ...b.epf,
      filedAt: new Date().toISOString(),
      filedBy: input.by,
    },
  }));
}

/** Record the EPF challan payment + uploaded receipt. */
export function markEpfChallanPaid(input: {
  batchId: string;
  by: string;
  challanRefNo: string;
  receiptFileUrl: string;
}): { ok: true } | { ok: false; error: string } {
  return updateBatch(input.batchId, (b) => ({
    ...b,
    epf: {
      ...b.epf,
      paidAt: new Date().toISOString(),
      paidBy: input.by,
      challanRefNo: input.challanRefNo.trim() || b.epf.challanRefNo,
      receiptFileUrl: input.receiptFileUrl || b.epf.receiptFileUrl,
    },
  }));
}

/** Record the ESIC challan payment + uploaded receipt (ESIC has no separate "return file" step). */
export function markEsicChallanPaid(input: {
  batchId: string;
  by: string;
  challanRefNo: string;
  receiptFileUrl: string;
}): { ok: true } | { ok: false; error: string } {
  return updateBatch(input.batchId, (b) => ({
    ...b,
    esic: {
      ...b.esic,
      filedAt: b.esic.filedAt || new Date().toISOString(),
      filedBy: b.esic.filedBy || input.by,
      paidAt: new Date().toISOString(),
      paidBy: input.by,
      challanRefNo: input.challanRefNo.trim() || b.esic.challanRefNo,
      receiptFileUrl: input.receiptFileUrl || b.esic.receiptFileUrl,
    },
  }));
}

/** @deprecated use markEpfChallanPaid / markEsicChallanPaid — kept for any old call sites, marks both paid at once. */
export function markRemitDeposited(input: {
  batchId: string;
  by: string;
  challanNote?: string;
}): { ok: true } | { ok: false; error: string } {
  const state = loadStatutoryRemit();
  const batch = state.batches.find((b) => b.id === input.batchId);
  if (!batch) return { ok: false, error: "Remittance batch not found" };
  if (batch.epf.paidAt && batch.esic.paidAt) {
    return { ok: false, error: "Already marked deposited" };
  }
  return updateBatch(input.batchId, (b) => {
    const now = new Date().toISOString();
    const note = input.challanNote?.trim() || b.challanNote;
    return {
      ...b,
      depositedAt: now,
      depositedBy: input.by,
      challanNote: note,
      epf: { ...b.epf, filedAt: b.epf.filedAt || now, filedBy: b.epf.filedBy || input.by, paidAt: now, paidBy: input.by, challanRefNo: note || b.epf.challanRefNo },
      esic: { ...b.esic, filedAt: b.esic.filedAt || now, filedBy: b.esic.filedBy || input.by, paidAt: now, paidBy: input.by, challanRefNo: note || b.esic.challanRefNo },
    };
  });
}

/** Maps batches into the decoupled StatutoryDue shape statutoryCompliance.ts's alert logic consumes. */
export function statutoryDuesFromBatches(
  batches: StatutoryRemitBatch[],
): StatutoryDue[] {
  const dues: StatutoryDue[] = [];
  for (const b of batches) {
    const epfAmount = b.totalEpfEpsContribution + b.totalEdliContribution;
    if (epfAmount > 0) {
      dues.push({
        batchId: b.id,
        kind: "epf",
        month: b.month,
        href: "/payroll?tab=govt",
        amountDue: epfAmount,
        paidAt: b.epf.paidAt,
      });
    }
    if (b.esicTotal > 0) {
      dues.push({
        batchId: b.id,
        kind: "esic",
        month: b.month,
        href: "/payroll?tab=govt",
        amountDue: b.esicTotal,
        paidAt: b.esic.paidAt,
      });
    }
  }
  return dues;
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
      "UAN",
      "Cover",
      "Gross(EPF wages)",
      "EPF EE",
      "EPS",
      "EPF ER",
      "EDLI",
      "PF Total",
      "ESIC IP No",
      "IP Contribution",
      "ESIC Employer",
      "ESIC Total",
      "Govt Payable",
      "Status",
    ],
  ];
  for (const l of batch.lines) {
    const epfEr = Math.max(0, l.pfEmployer - l.epsAmount);
    const pf = l.pfEmployee + l.pfEmployer;
    const esic = l.esicEmployee + l.esicEmployer;
    rows.push([
      batch.month,
      l.empCode,
      l.fullName,
      l.uanNumber,
      l.statutoryCover,
      String(l.epfWages),
      String(l.pfEmployee),
      String(l.epsAmount),
      String(epfEr),
      String(l.edliAmount),
      String(pf),
      l.esicIpNumber,
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
    "",
    String(batch.totalEpsContribution),
    "",
    String(batch.totalEdliContribution),
    String(batch.pfTotal),
    "",
    String(batch.totalIpContribution),
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
