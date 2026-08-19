/**
 * Payroll runs — process draft (individual/bulk) → edit while draft →
 * approve → publish to salary account → paid.
 * Account ledger / PF-ESIC remit / June holds only update on publish.
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import type { StaffRecord } from "@/lib/foundationMasters";
import {
  classifyStaffHolidayDay,
} from "@/lib/holidayPolicy";
import type { MastersState } from "@/lib/masters";
import { DEFAULT_AY, loadMasters } from "@/lib/masters";
import {
  findStaffRegister,
  loadStaffAttendance,
  type StaffAttendanceMark,
} from "@/lib/staffAttendance";
import { hasEndedSurveyWorkForStaff } from "@/lib/surveyAttendanceBridge";
import { loadStaffHr, unpaidLeaveDaysInMonth } from "@/lib/staffHr";
import {
  govtDepositFromComponents,
  syncRemitFromPayrollRun,
} from "@/lib/statutoryRemit";
import {
  isEligibleForJuneDraw,
  shouldHoldJuneSalary,
  syncHoldsFromPayrollRun,
} from "@/lib/salaryHold";
import {
  postPayrollToSalaryAccount,
  voidSalaryAccountForRun,
} from "@/lib/salaryAccount";
import {
  outstandingForStaff,
  syncAdvanceRecoveriesFromPayroll,
  voidAdvanceRecoveriesForRun,
} from "@/lib/staffAdvance";
import {
  computeStructureAmounts,
  loadSalarySetup,
  normalizeSalarySettings,
  resolveStructureForStaff,
  type SalaryHead,
  type SalarySetupState,
} from "@/lib/salarySetup";

export type PayrollRunStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "posted"
  | "paid";

export type PayrollRunKind = "bulk" | "individual";

export type PayrollLineComponent = {
  headId: string;
  headCode: string;
  headName: string;
  kind: "earning" | "deduction" | "employer";
  amount: number;
};

export type PayrollPaymentMode =
  | "bank_transfer"
  | "cash"
  | "cheque"
  | "upi"
  | "other";

export const PAYROLL_PAYMENT_MODES: {
  value: PayrollPaymentMode;
  label: string;
}[] = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "upi", label: "UPI" },
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
];

export type PayrollStaffLine = {
  staffId: string;
  empCode: string;
  fullName: string;
  stream: string;
  structureId: string;
  structureName: string;
  /** Attendance summary for the month */
  daysPresent: number;
  daysAbsent: number;
  daysHalf: number;
  daysLeavePaid: number;
  daysLwp: number;
  daysHoliday: number;
  latePenalty: number;
  lwpDeduction: number;
  components: PayrollLineComponent[];
  gross: number;
  totalDeductions: number;
  employerCost: number;
  netPay: number;
  /** Teaching June hold — amount not paid this month */
  juneHold: boolean;
  /** True if ≥1 year completed by this June (drawable on exit) */
  eligibleForJuneDraw: boolean;
  /** Cash payable this month (0 when held) */
  amountPayable: number;
  holdNote: string;
  /** Cover used for PF/ESIC filtering */
  statutoryCover: string;
  /** Employee + employer PF → Govt (EPFO) */
  pfGovtDeposit: number;
  /** Employee + employer ESIC → Govt */
  esicGovtDeposit: number;
  /** One-time / month bonus (earning) */
  bonus: number;
  /** Ad-hoc deduction this month only */
  specialDeduction: number;
  /** Label for special deduction (e.g. uniform, fine) */
  specialDeductionLabel: string;
  /** Total advance outstanding from ledger (locked display) */
  advanceTaken: number;
  /** Advance recovery deducted this month */
  advanceDeduct: number;
  /** Extra advance disbursed with this month's salary (creates new ledger entry on publish) */
  advanceNewWithSalary: number;
  /** Planned / actual payment date YYYY-MM-DD */
  paymentDate: string;
  paymentMode: PayrollPaymentMode;
  note: string;
};

export type PayrollRun = {
  id: string;
  academicYearCode: string;
  /** YYYY-MM */
  month: string;
  dayCount: number;
  kind: PayrollRunKind;
  status: PayrollRunStatus;
  lines: PayrollStaffLine[];
  createdBy: string;
  createdAt: string;
  submittedBy: string;
  submittedAt: string;
  approvedBy: string;
  approvedAt: string;
  /** Published to salary account — first time accounts are touched */
  postedBy: string;
  postedAt: string;
  paidBy: string;
  paidAt: string;
  remark: string;
  /** Note from submitter when sending for approval */
  submissionNote: string;
  /** Set when Principal rejects — run returns to draft */
  rejectionNote: string;
  rejectedBy: string;
  rejectedAt: string;
  /** Incremented on each lock transition; stale clients cannot re-publish */
  lockVersion: number;
};

export type PayrollAuditAction =
  | "draft_created"
  | "draft_replaced"
  | "draft_merged"
  | "draft_rebuilt"
  | "line_edited"
  | "submitted"
  | "approved"
  | "rejected"
  | "published"
  | "recalled"
  | "paid"
  | "deleted"
  | "tally_export";

export type PayrollAuditEntry = {
  id: string;
  at: string;
  by: string;
  action: PayrollAuditAction;
  runId: string;
  month: string;
  academicYearCode: string;
  detail: string;
};

export type PayrollState = {
  version: 2;
  runs: PayrollRun[];
  audit: PayrollAuditEntry[];
};

const STORAGE_KEY = "bhb_payroll_v1";
const AUDIT_MAX = 500;

let serverPayrollCache: PayrollState | null = null;

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function loadPayroll(): PayrollState {
  if (typeof window === "undefined") {
    if (serverPayrollCache) return serverPayrollCache;
    return { version: 2, runs: [], audit: [] };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 2, runs: [], audit: [] };
    const parsed = JSON.parse(raw) as Partial<PayrollState>;
    const runs = (Array.isArray(parsed.runs) ? parsed.runs : []).map(
      (r) => ({
        ...r,
        kind: r.kind === "individual" ? ("individual" as const) : ("bulk" as const),
        postedBy: r.postedBy || "",
        postedAt: r.postedAt || "",
        submissionNote: r.submissionNote || "",
        rejectionNote: r.rejectionNote || "",
        rejectedBy: r.rejectedBy || "",
        rejectedAt: r.rejectedAt || "",
        lockVersion: Number(r.lockVersion) || 0,
        lines: (r.lines ?? []).map((l) => normalizePayrollLine(l)),
      }),
    );
    return {
      version: 2,
      runs,
      audit: Array.isArray(parsed.audit) ? parsed.audit : [],
    };
  } catch {
    return { version: 2, runs: [], audit: [] };
  }
}

export function savePayroll(state: PayrollState) {
  if (!assertModulePermission("payroll", "edit", "savePayroll")) return;

  if (typeof window === "undefined") return;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...state, version: 2 }),
  );
  void import("@/lib/payrollPersistence").then(({ schedulePayrollSync }) => {
    schedulePayrollSync(state);
  });
}

export function writePayrollLocalRaw(state: PayrollState) {
  if (typeof window === "undefined") {
    serverPayrollCache = state;
    return;
  }
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...state, version: 2 }),
  );
}

export function payrollStateIsEmpty(state: PayrollState): boolean {
  return !state.runs?.length;
}

function normalizePaymentMode(v?: string | null): PayrollPaymentMode {
  if (
    v === "cash" ||
    v === "cheque" ||
    v === "upi" ||
    v === "other" ||
    v === "bank_transfer"
  ) {
    return v;
  }
  return "bank_transfer";
}

export function normalizePayrollLine(
  l: Partial<PayrollStaffLine>,
): PayrollStaffLine {
  return {
    staffId: String(l.staffId || ""),
    empCode: String(l.empCode || ""),
    fullName: String(l.fullName || ""),
    stream: String(l.stream || ""),
    structureId: String(l.structureId || ""),
    structureName: String(l.structureName || ""),
    daysPresent: Number(l.daysPresent) || 0,
    daysAbsent: Number(l.daysAbsent) || 0,
    daysHalf: Number(l.daysHalf) || 0,
    daysLeavePaid: Number(l.daysLeavePaid) || 0,
    daysLwp: Number(l.daysLwp) || 0,
    daysHoliday: Number(l.daysHoliday) || 0,
    latePenalty: Number(l.latePenalty) || 0,
    lwpDeduction: Number(l.lwpDeduction) || 0,
    components: Array.isArray(l.components) ? l.components : [],
    gross: Number(l.gross) || 0,
    totalDeductions: Number(l.totalDeductions) || 0,
    employerCost: Number(l.employerCost) || 0,
    netPay: Number(l.netPay) || 0,
    juneHold: !!l.juneHold,
    eligibleForJuneDraw: l.eligibleForJuneDraw !== false,
    amountPayable:
      typeof l.amountPayable === "number"
        ? l.amountPayable
        : l.juneHold
          ? 0
          : Number(l.netPay) || 0,
    holdNote: l.holdNote || "",
    statutoryCover: l.statutoryCover || "",
    pfGovtDeposit: Number(l.pfGovtDeposit) || 0,
    esicGovtDeposit: Number(l.esicGovtDeposit) || 0,
    bonus: Math.max(0, Number(l.bonus) || 0),
    specialDeduction: Math.max(0, Number(l.specialDeduction) || 0),
    specialDeductionLabel: String(l.specialDeductionLabel || ""),
    advanceTaken: Math.max(0, Number(l.advanceTaken) || 0),
    advanceDeduct: Math.max(0, Number(l.advanceDeduct) || 0),
    advanceNewWithSalary: Math.max(0, Number(l.advanceNewWithSalary) || 0),
    paymentDate: String(l.paymentDate || "").slice(0, 10),
    paymentMode: normalizePaymentMode(l.paymentMode),
    note: String(l.note || ""),
  };
}

function daysInMonth(ym: string): string[] {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return [];
  const last = new Date(y, m, 0).getDate();
  const out: string[] = [];
  for (let d = 1; d <= last; d++) {
    out.push(
      `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    );
  }
  return out;
}

function unpaidLeaveDaysForStaff(
  staffId: string,
  ym: string,
  ay: string,
): number {
  return unpaidLeaveDaysInMonth(staffId, ym, ay);
}

function markForStaff(
  date: string,
  ay: string,
  staffId: string,
): StaffAttendanceMark | null {
  const state = loadStaffAttendance();
  const reg = findStaffRegister(state, date, ay);
  if (!reg) return null;
  return reg.marks.find((m) => m.staffId === staffId) ?? null;
}

export type BuildPayrollOpts = {
  masters: MastersState;
  salary?: SalarySetupState;
  month: string;
  academicYearCode?: string;
  createdBy: string;
  dayCountOverride?: number;
  /** If set, only these staff (individual / partial process) */
  staffIds?: string[];
  kind?: PayrollRunKind;
};

/** Build a draft payroll run for active staff with a resolvable structure. */
export function buildPayrollDraft(opts: BuildPayrollOpts): PayrollRun {
  const ay = opts.academicYearCode || DEFAULT_AY;
  const salary = opts.salary || loadSalarySetup();
  const settings = normalizeSalarySettings(salary.settings);
  const dayCount = opts.dayCountOverride || settings.dayCount;
  const monthDays = daysInMonth(opts.month);
  const headsById = new Map(salary.heads.map((h) => [h.id, h]));
  const lwpHead = salary.heads.find((h) => h.code === "LWP");
  const lateHead = salary.heads.find((h) => h.code === "LATE");

  const roster = (opts.masters.staff ?? []).filter((s) => {
    if (s.status !== "active") return false;
    if (opts.staffIds?.length) return opts.staffIds.includes(s.id);
    return true;
  });
  const kind: PayrollRunKind =
    opts.kind ||
    (opts.staffIds?.length === 1
      ? "individual"
      : opts.staffIds?.length
        ? "individual"
        : "bulk");
  const lines: PayrollStaffLine[] = [];

  for (const staff of roster) {
    const structure = resolveStructureForStaff(salary, staff);
    if (!structure) continue;
    const link = salary.staffLinks.find((l) => l.staffId === staff.id);
    const amounts = computeStructureAmounts(
      salary,
      structure,
      link?.basicOverride || 0,
      link?.statutoryCover || "both",
      opts.masters.statutoryConfig,
    );

    let daysPresent = 0;
    let daysAbsent = 0;
    let daysHalf = 0;
    let daysLeavePaid = 0;
    let daysHoliday = 0;
    let lateCount = 0;

    for (const d of monthDays) {
      const hol = classifyStaffHolidayDay(
        opts.masters,
        d,
        ay,
        staff.stream,
      );
      if (hol.status === "holiday" && hol.paidForStaff) {
        daysHoliday += 1;
        continue;
      }
      if (hol.status === "holiday" && !hol.paidForStaff) {
        // unpaid holiday — treat like absent for LWP math lightly
        daysAbsent += 1;
        continue;
      }

      const mark = markForStaff(d, ay, staff.id);
      if (!mark) {
        // no register — ended field survey still counts as present (outdoor duty)
        if (hasEndedSurveyWorkForStaff(staff.id, d)) {
          daysPresent += 1;
          continue;
        }
        // no register — assume present for draft (office may not have marked)
        daysPresent += 1;
        continue;
      }
      if (mark.status === "A" && hasEndedSurveyWorkForStaff(staff.id, d)) {
        // Survey End completed that day — outdoor duty overrides absent for LWP
        daysPresent += 1;
        continue;
      }
      if (mark.status === "P") daysPresent += 1;
      else if (mark.status === "A") daysAbsent += 1;
      else if (mark.status === "HD") daysHalf += 1;
      else if (mark.status === "LE") daysLeavePaid += 1;
      else if (mark.status === "L") {
        daysPresent += 1;
        lateCount += 1;
      } else daysPresent += 1;
    }

    const unpaidLeave = unpaidLeaveDaysForStaff(staff.id, opts.month, ay);
    const halfAsAbsent = daysHalf * 0.5;
    const daysLwp = daysAbsent + halfAsAbsent + unpaidLeave;
    const dayRate = amounts.gross / dayCount;
    const lwpDeduction = Math.round(dayRate * daysLwp);
    /** Simple late penalty: 1 hour ≈ dayRate/8 per late beyond 3 */
    const latePenalty =
      lateCount > 3
        ? Math.round((dayRate / 8) * (lateCount - 3))
        : 0;

    const components: PayrollLineComponent[] = [];
    for (const e of amounts.earnings) {
      components.push({
        headId: e.head.id,
        headCode: e.head.code,
        headName: e.head.name,
        kind: "earning",
        amount: e.amount,
      });
    }
    for (const d of amounts.deductions) {
      if (d.head.code === "LWP" || d.head.code === "LATE") continue;
      components.push({
        headId: d.head.id,
        headCode: d.head.code,
        headName: d.head.name,
        kind: "deduction",
        amount: d.amount,
      });
    }
    if (lwpDeduction > 0 && lwpHead) {
      components.push({
        headId: lwpHead.id,
        headCode: lwpHead.code,
        headName: lwpHead.name,
        kind: "deduction",
        amount: lwpDeduction,
      });
    } else if (lwpDeduction > 0) {
      components.push({
        headId: "lwp",
        headCode: "LWP",
        headName: "Loss of pay",
        kind: "deduction",
        amount: lwpDeduction,
      });
    }
    if (latePenalty > 0 && lateHead) {
      components.push({
        headId: lateHead.id,
        headCode: lateHead.code,
        headName: lateHead.name,
        kind: "deduction",
        amount: latePenalty,
      });
    } else if (latePenalty > 0) {
      components.push({
        headId: "late",
        headCode: "LATE",
        headName: "Late penalty",
        kind: "deduction",
        amount: latePenalty,
      });
    }
    for (const e of amounts.employer) {
      components.push({
        headId: e.head.id,
        headCode: e.head.code,
        headName: e.head.name,
        kind: "employer",
        amount: e.amount,
      });
    }

    const gross = amounts.gross;
    const totalDeductions = components
      .filter((c) => c.kind === "deduction")
      .reduce((s, c) => s + c.amount, 0);
    const employerCost = components
      .filter((c) => c.kind === "employer")
      .reduce((s, c) => s + c.amount, 0);
    const netPay = Math.max(0, gross - totalDeductions);

    const juneHold = shouldHoldJuneSalary(staff, opts.month);
    const eligibleForJuneDraw = isEligibleForJuneDraw(staff, opts.month);
    const amountPayable = juneHold ? 0 : netPay;
    const holdNote = juneHold
      ? eligibleForJuneDraw
        ? "Teaching June salary held till exit / Super Admin release"
        : "Teaching June held — <1 year service: not drawable later"
      : "";

    const cover = link?.statutoryCover || "both";
    const govt = govtDepositFromComponents(components);

    void headsById;
    const outstanding = outstandingForStaff(staff.id);
    lines.push({
      staffId: staff.id,
      empCode: staff.empCode,
      fullName: staff.fullName,
      stream: staff.stream,
      structureId: structure.id,
      structureName: structure.name,
      daysPresent,
      daysAbsent,
      daysHalf,
      daysLeavePaid,
      daysLwp,
      daysHoliday,
      latePenalty,
      lwpDeduction,
      components,
      gross,
      totalDeductions,
      employerCost,
      netPay,
      juneHold,
      eligibleForJuneDraw,
      amountPayable,
      holdNote,
      statutoryCover: cover,
      pfGovtDeposit: govt.pfTotal,
      esicGovtDeposit: govt.esicTotal,
      bonus: 0,
      specialDeduction: 0,
      specialDeductionLabel: "",
      advanceTaken: outstanding,
      advanceDeduct: 0,
      advanceNewWithSalary: 0,
      paymentDate: "",
      paymentMode: "bank_transfer",
      note: [
        link?.salaryAccountNote || "",
        unpaidLeave > 0
          ? `LWP includes ${unpaidLeave} approved unpaid leave day(s)`
          : "",
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }

  lines.sort((a, b) => a.empCode.localeCompare(b.empCode));

  return {
    id: nid("pr"),
    academicYearCode: ay,
    month: opts.month,
    dayCount,
    kind,
    status: "draft",
    lines,
    createdBy: opts.createdBy,
    createdAt: new Date().toISOString(),
    submittedBy: "",
    submittedAt: "",
    approvedBy: "",
    approvedAt: "",
    postedBy: "",
    postedAt: "",
    paidBy: "",
    paidAt: "",
    remark: "",
    submissionNote: "",
    rejectionNote: "",
    rejectedBy: "",
    rejectedAt: "",
    lockVersion: 0,
  };
}

export function isPayrollEditable(run: PayrollRun): boolean {
  return run.status === "draft";
}

export function accountsTouched(run: PayrollRun): boolean {
  return run.status === "posted" || run.status === "paid";
}

export function isPayrollLocked(run: PayrollRun): boolean {
  return (
    run.status === "approved" ||
    run.status === "posted" ||
    run.status === "paid"
  );
}

/** Month already has approved / posted / paid payroll. */
export function monthHasCommittedRun(
  month: string,
  academicYearCode: string,
  exceptRunId?: string,
): PayrollRun | null {
  const state = loadPayroll();
  return (
    state.runs.find(
      (r) =>
        r.id !== exceptRunId &&
        r.month === month &&
        r.academicYearCode === academicYearCode &&
        (r.status === "approved" ||
          r.status === "posted" ||
          r.status === "paid"),
    ) ?? null
  );
}

/** Staff already included in a committed (approved+) run for the month. */
export function staffCommittedInMonth(
  month: string,
  academicYearCode: string,
  staffIds: string[],
  exceptRunId?: string,
): string[] {
  const state = loadPayroll();
  const set = new Set(staffIds);
  const hit: string[] = [];
  for (const r of state.runs) {
    if (exceptRunId && r.id === exceptRunId) continue;
    if (r.month !== month || r.academicYearCode !== academicYearCode) continue;
    if (
      r.status !== "approved" &&
      r.status !== "posted" &&
      r.status !== "paid"
    ) {
      continue;
    }
    for (const l of r.lines) {
      if (set.has(l.staffId) && !hit.includes(l.empCode)) {
        hit.push(l.empCode || l.staffId);
      }
    }
  }
  return hit;
}

export function appendPayrollAudit(
  entry: Omit<PayrollAuditEntry, "id" | "at">,
): PayrollState {
  const state = loadPayroll();
  const row: PayrollAuditEntry = {
    ...entry,
    id: nid("pa"),
    at: new Date().toISOString(),
  };
  const audit = [row, ...(state.audit || [])].slice(0, AUDIT_MAX);
  const next = { ...state, version: 2 as const, audit };
  savePayroll(next);
  return next;
}

export function listPayrollAudit(limit = 80): PayrollAuditEntry[] {
  return (loadPayroll().audit || []).slice(0, limit);
}

export function payrollAuditActionLabel(a: PayrollAuditAction): string {
  switch (a) {
    case "draft_created":
      return "Draft created";
    case "draft_replaced":
      return "Draft replaced";
    case "draft_merged":
      return "Staff merged into draft";
    case "draft_rebuilt":
      return "Draft rebuilt";
    case "line_edited":
      return "Line edited";
    case "submitted":
      return "Submitted";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "published":
      return "Published to account";
    case "recalled":
      return "Recalled to draft";
    case "paid":
      return "Marked paid";
    case "deleted":
      return "Deleted";
    case "tally_export":
      return "Tally export / sync";
    default:
      return a;
  }
}

function guardDraftOnly(run: PayrollRun): string | null {
  if (run.status === "draft") return null;
  return `Run is locked (${run.status}) — recall to draft before editing`;
}

function recalculateLineFromComponents(line: PayrollStaffLine): PayrollStaffLine {
  const gross = line.components
    .filter((c) => c.kind === "earning")
    .reduce((s, c) => s + c.amount, 0);
  const totalDeductions = line.components
    .filter((c) => c.kind === "deduction")
    .reduce((s, c) => s + c.amount, 0);
  const employerCost = line.components
    .filter((c) => c.kind === "employer")
    .reduce((s, c) => s + c.amount, 0);
  const netPay = Math.max(0, gross - totalDeductions);
  const newAdv = Math.max(0, Math.round(line.advanceNewWithSalary || 0));
  /** Cash out: salary net + optional new advance with salary (held June → 0 salary part) */
  const amountPayable = line.juneHold ? newAdv : netPay + newAdv;
  const govt = govtDepositFromComponents(line.components);
  const lockedOutstanding = outstandingForStaff(line.staffId);
  return {
    ...line,
    advanceTaken: lockedOutstanding,
    advanceNewWithSalary: newAdv,
    gross,
    totalDeductions,
    employerCost,
    netPay,
    amountPayable,
    pfGovtDeposit: govt.pfTotal,
    esicGovtDeposit: govt.esicTotal,
  };
}

const ADJ_CODES = {
  bonus: "BONUS",
  special: "SPECIAL_DED",
  advance: "ADVANCE",
} as const;

function upsertAdjustmentComponent(
  components: PayrollLineComponent[],
  headCode: string,
  headName: string,
  kind: "earning" | "deduction",
  amount: number,
): PayrollLineComponent[] {
  const amt = Math.max(0, Math.round(amount));
  const without = components.filter((c) => c.headCode !== headCode);
  if (amt <= 0) return without;
  return [
    ...without,
    {
      headId: headCode.toLowerCase(),
      headCode,
      headName,
      kind,
      amount: amt,
    },
  ];
}

/** Sync bonus / special deduction / advance into salary heads and recalc. */
export function applyMonthAdjustments(line: PayrollStaffLine): PayrollStaffLine {
  const bonus = Math.max(0, Math.round(line.bonus || 0));
  const special = Math.max(0, Math.round(line.specialDeduction || 0));
  const advance = Math.max(0, Math.round(line.advanceDeduct || 0));
  const specialLabel =
    (line.specialDeductionLabel || "").trim() || "Special deduction";

  let components = [...line.components];
  components = upsertAdjustmentComponent(
    components,
    ADJ_CODES.bonus,
    "Bonus",
    "earning",
    bonus,
  );
  components = upsertAdjustmentComponent(
    components,
    ADJ_CODES.special,
    specialLabel,
    "deduction",
    special,
  );
  components = upsertAdjustmentComponent(
    components,
    ADJ_CODES.advance,
    "Advance recovery",
    "deduction",
    advance,
  );

  return recalculateLineFromComponents({
    ...line,
    bonus,
    specialDeduction: special,
    specialDeductionLabel: line.specialDeductionLabel || "",
    advanceDeduct: advance,
    advanceNewWithSalary: Math.max(
      0,
      Math.round(line.advanceNewWithSalary || 0),
    ),
    components,
  });
}

export type DraftLineAdjustmentPatch = Partial<
  Pick<
    PayrollStaffLine,
    | "bonus"
    | "specialDeduction"
    | "specialDeductionLabel"
    | "advanceDeduct"
    | "advanceNewWithSalary"
    | "paymentDate"
    | "paymentMode"
    | "note"
    | "amountPayable"
    | "lwpDeduction"
  >
>;

/** Edit month adjustments / payment fields on a draft line.
 * advanceTaken is always locked from the advance ledger.
 */
export function updateDraftLineAdjustments(
  runId: string,
  staffId: string,
  patch: DraftLineAdjustmentPatch,
  by = "system",
): { ok: true; run: PayrollRun } | { ok: false; error: string } {
  const state = loadPayroll();
  const run = state.runs.find((r) => r.id === runId);
  if (!run) return { ok: false, error: "Run not found" };
  const locked = guardDraftOnly(run);
  if (locked) return { ok: false, error: locked };

  const moneyKeys = [
    "bonus",
    "specialDeduction",
    "advanceDeduct",
    "advanceNewWithSalary",
  ] as const;
  const touchesMoney = moneyKeys.some((k) => patch[k] !== undefined);

  const due = outstandingForStaff(staffId);

  const lines = run.lines.map((l) => {
    if (l.staffId !== staffId) {
      return recalculateLineFromComponents({
        ...l,
        advanceTaken: outstandingForStaff(l.staffId),
      });
    }
    let next: PayrollStaffLine = {
      ...l,
      ...patch,
      advanceTaken: due,
      paymentMode: patch.paymentMode
        ? normalizePaymentMode(patch.paymentMode)
        : l.paymentMode,
      paymentDate:
        patch.paymentDate !== undefined
          ? String(patch.paymentDate).slice(0, 10)
          : l.paymentDate,
    };

    if (patch.advanceDeduct !== undefined && patch.advanceDeduct > due) {
      next = { ...next, advanceDeduct: due };
    }

    if (patch.lwpDeduction !== undefined) {
      const components = next.components.map((c) =>
        c.headCode === "LWP"
          ? { ...c, amount: Math.max(0, Math.round(patch.lwpDeduction!)) }
          : c,
      );
      const hasLwp = components.some((c) => c.headCode === "LWP");
      if (!hasLwp && patch.lwpDeduction > 0) {
        components.push({
          headId: "lwp",
          headCode: "LWP",
          headName: "Loss of pay",
          kind: "deduction",
          amount: Math.max(0, Math.round(patch.lwpDeduction)),
        });
      }
      next = {
        ...next,
        components,
        lwpDeduction: Math.max(0, Math.round(patch.lwpDeduction)),
      };
    }

    if (touchesMoney || patch.specialDeductionLabel !== undefined) {
      next = applyMonthAdjustments(next);
    } else {
      next = recalculateLineFromComponents(next);
    }

    if (patch.amountPayable !== undefined && !touchesMoney) {
      next = {
        ...next,
        amountPayable: Math.max(0, Math.round(patch.amountPayable)),
      };
    }

    return next;
  });

  const nextRun = { ...run, lines };
  upsertPayrollRun(nextRun);
  appendPayrollAudit({
    by,
    action: "line_edited",
    runId: run.id,
    month: run.month,
    academicYearCode: run.academicYearCode,
    detail: `Adjustments for ${staffId}: ${Object.keys(patch).join(", ")}`,
  });
  return { ok: true, run: nextRun };
}

/** Preserve bonus / advance / payment fields when rebuilding a line. */
export function mergePreservedAdjustments(
  fresh: PayrollStaffLine,
  previous?: PayrollStaffLine | null,
): PayrollStaffLine {
  const due = outstandingForStaff(fresh.staffId);
  if (!previous) {
    return recalculateLineFromComponents({
      ...fresh,
      advanceTaken: due,
      advanceDeduct: 0,
      advanceNewWithSalary: 0,
    });
  }
  return applyMonthAdjustments({
    ...fresh,
    bonus: previous.bonus || 0,
    specialDeduction: previous.specialDeduction || 0,
    specialDeductionLabel: previous.specialDeductionLabel || "",
    advanceTaken: due,
    advanceDeduct: Math.min(previous.advanceDeduct || 0, due),
    advanceNewWithSalary: previous.advanceNewWithSalary || 0,
    paymentDate: previous.paymentDate || "",
    paymentMode: previous.paymentMode || "bank_transfer",
    note: previous.note || fresh.note,
  });
}

export function paymentModeLabel(mode: PayrollPaymentMode): string {
  return (
    PAYROLL_PAYMENT_MODES.find((m) => m.value === mode)?.label || mode
  );
}

/** Edit a component amount on a draft run (recalculates gross/net). */
export function updateDraftLineComponent(
  runId: string,
  staffId: string,
  headCode: string,
  amount: number,
  by = "system",
): { ok: true; run: PayrollRun } | { ok: false; error: string } {
  const state = loadPayroll();
  const run = state.runs.find((r) => r.id === runId);
  if (!run) return { ok: false, error: "Run not found" };
  const locked = guardDraftOnly(run);
  if (locked) return { ok: false, error: locked };
  const lines = run.lines.map((l) => {
    if (l.staffId !== staffId) return l;
    const components = l.components.map((c) =>
      c.headCode === headCode
        ? { ...c, amount: Math.max(0, Math.round(amount)) }
        : c,
    );
    return recalculateLineFromComponents({ ...l, components });
  });
  const next = { ...run, lines };
  upsertPayrollRun(next);
  appendPayrollAudit({
    by,
    action: "line_edited",
    runId: run.id,
    month: run.month,
    academicYearCode: run.academicYearCode,
    detail: `Head ${headCode} → ${Math.round(amount)} (${staffId})`,
  });
  return { ok: true, run: next };
}

/** Override payable / note on draft. */
export function updateDraftLineMeta(
  runId: string,
  staffId: string,
  patch: DraftLineAdjustmentPatch,
): { ok: true; run: PayrollRun } | { ok: false; error: string } {
  return updateDraftLineAdjustments(runId, staffId, patch);
}

export function removeDraftStaffLine(
  runId: string,
  staffId: string,
  by = "system",
): { ok: true; run: PayrollRun } | { ok: false; error: string } {
  const state = loadPayroll();
  const run = state.runs.find((r) => r.id === runId);
  if (!run) return { ok: false, error: "Run not found" };
  const locked = guardDraftOnly(run);
  if (locked) return { ok: false, error: locked };
  const next = {
    ...run,
    lines: run.lines.filter((l) => l.staffId !== staffId),
    kind: run.lines.filter((l) => l.staffId !== staffId).length <= 1
      ? ("individual" as const)
      : run.kind,
  };
  upsertPayrollRun(next);
  appendPayrollAudit({
    by,
    action: "line_edited",
    runId: run.id,
    month: run.month,
    academicYearCode: run.academicYearCode,
    detail: `Removed staff ${staffId}`,
  });
  return { ok: true, run: next };
}

/**
 * Process / reprocess salary into a draft. Never posts to accounts.
 * Blocks if month already has approved/posted/paid payroll.
 */
export function processPayrollDraft(opts: {
  masters: MastersState;
  month: string;
  academicYearCode: string;
  createdBy: string;
  mode: "bulk" | "individual";
  staffIds?: string[];
  replaceExistingDraft?: boolean;
}):
  | { ok: true; run: PayrollRun; merged: boolean }
  | { ok: false; error: string } {
  if (opts.mode === "individual" && !opts.staffIds?.length) {
    return { ok: false, error: "Select at least one staff member" };
  }

  const committed = monthHasCommittedRun(
    opts.month,
    opts.academicYearCode,
  );
  if (committed) {
    return {
      ok: false,
      error: `Month ${opts.month} already has ${payrollStatusLabel(committed.status)} payroll — recall that run before reprocessing`,
    };
  }

  if (opts.mode === "individual" && opts.staffIds?.length) {
    const clash = staffCommittedInMonth(
      opts.month,
      opts.academicYearCode,
      opts.staffIds,
    );
    if (clash.length) {
      return {
        ok: false,
        error: `Staff already on committed payroll this month: ${clash.join(", ")}`,
      };
    }
  }

  const state = loadPayroll();
  const open = state.runs.find(
    (r) =>
      r.month === opts.month &&
      r.academicYearCode === opts.academicYearCode &&
      (r.status === "draft" || r.status === "pending_approval"),
  );

  if (open && open.status === "pending_approval") {
    return {
      ok: false,
      error:
        "A run for this month is pending approval — recall to draft before changing",
    };
  }

  if (opts.mode === "bulk") {
    if (open && !opts.replaceExistingDraft) {
      return {
        ok: false,
        error:
          "A draft already exists for this month — open it to edit, or confirm replace",
      };
    }
    const built = buildPayrollDraft({
      masters: opts.masters,
      month: opts.month,
      academicYearCode: opts.academicYearCode,
      createdBy: opts.createdBy,
      kind: "bulk",
    });
    if (open) {
      const next = {
        ...built,
        id: open.id,
        createdBy: open.createdBy,
        createdAt: open.createdAt,
        remark: open.remark,
        kind: "bulk" as const,
        status: "draft" as const,
        lockVersion: open.lockVersion || 0,
      };
      upsertPayrollRun(next);
      appendPayrollAudit({
        by: opts.createdBy,
        action: "draft_replaced",
        runId: next.id,
        month: next.month,
        academicYearCode: next.academicYearCode,
        detail: `Bulk replace · ${next.lines.length} staff`,
      });
      return { ok: true, run: next, merged: false };
    }
    upsertPayrollRun(built);
    appendPayrollAudit({
      by: opts.createdBy,
      action: "draft_created",
      runId: built.id,
      month: built.month,
      academicYearCode: built.academicYearCode,
      detail: `Bulk draft · ${built.lines.length} staff`,
    });
    return { ok: true, run: built, merged: false };
  }

  const built = buildPayrollDraft({
    masters: opts.masters,
    month: opts.month,
    academicYearCode: opts.academicYearCode,
    createdBy: opts.createdBy,
    staffIds: opts.staffIds,
    kind: "individual",
  });
  if (built.lines.length === 0) {
    return {
      ok: false,
      error: "No salary structure for selected staff — assign in Salary setup",
    };
  }

  if (open && open.status === "draft") {
    const keep = open.lines.filter(
      (l) => !opts.staffIds!.includes(l.staffId),
    );
    const next: PayrollRun = {
      ...open,
      kind: "individual",
      lines: [...keep, ...built.lines].sort((a, b) =>
        a.empCode.localeCompare(b.empCode),
      ),
      status: "draft",
    };
    upsertPayrollRun(next);
    appendPayrollAudit({
      by: opts.createdBy,
      action: "draft_merged",
      runId: next.id,
      month: next.month,
      academicYearCode: next.academicYearCode,
      detail: `Merged ${opts.staffIds!.length} staff · now ${next.lines.length} lines`,
    });
    return { ok: true, run: next, merged: true };
  }

  upsertPayrollRun(built);
  appendPayrollAudit({
    by: opts.createdBy,
    action: "draft_created",
    runId: built.id,
    month: built.month,
    academicYearCode: built.academicYearCode,
    detail: `Individual draft · ${built.lines.map((l) => l.empCode).join(", ")}`,
  });
  return { ok: true, run: built, merged: false };
}

export function upsertPayrollRun(run: PayrollRun): PayrollState {
  const state = loadPayroll();
  const existing = state.runs.find((r) => r.id === run.id);
  if (
    existing &&
    accountsTouched(existing) &&
    accountsTouched(run) &&
    JSON.stringify(run.lines) !== JSON.stringify(existing.lines)
  ) {
    // Hard lock: never mutate posted/paid salary lines in place
    return state;
  }

  const idx = state.runs.findIndex((r) => r.id === run.id);
  const normalized: PayrollRun = {
    ...run,
    lockVersion: run.lockVersion ?? existing?.lockVersion ?? 0,
  };
  const runs =
    idx >= 0
      ? state.runs.map((r, i) => (i === idx ? normalized : r))
      : [normalized, ...state.runs];
  const next = {
    version: 2 as const,
    runs,
    audit: state.audit || [],
  };
  savePayroll(next);
  return next;
}

export function submitPayrollForApproval(
  runId: string,
  by: string,
  submissionNote = "",
): { ok: true; run: PayrollRun } | { ok: false; error: string } {
  const state = loadPayroll();
  const run = state.runs.find((r) => r.id === runId);
  if (!run) return { ok: false, error: "Run not found" };
  if (run.status !== "draft") {
    return { ok: false, error: "Only draft runs can be submitted" };
  }
  if (run.lines.length === 0) {
    return { ok: false, error: "No staff lines in this run" };
  }
  const clash = monthHasCommittedRun(
    run.month,
    run.academicYearCode,
    run.id,
  );
  if (clash) {
    return {
      ok: false,
      error: `Month already has ${payrollStatusLabel(clash.status)} payroll`,
    };
  }
  const next: PayrollRun = {
    ...run,
    status: "pending_approval",
    submittedBy: by,
    submittedAt: new Date().toISOString(),
    submissionNote: (submissionNote || run.submissionNote || "").trim(),
    rejectionNote: "",
    rejectedBy: "",
    rejectedAt: "",
  };
  upsertPayrollRun(next);
  appendPayrollAudit({
    by,
    action: "submitted",
    runId: next.id,
    month: next.month,
    academicYearCode: next.academicYearCode,
    detail: `${next.lines.length} staff submitted${
      next.submissionNote ? ` · ${next.submissionNote}` : ""
    }`,
  });
  return { ok: true, run: next };
}

export function approvePayrollRun(
  runId: string,
  by: string,
  approvalNote = "",
): { ok: true; run: PayrollRun } | { ok: false; error: string } {
  const state = loadPayroll();
  const run = state.runs.find((r) => r.id === runId);
  if (!run) return { ok: false, error: "Run not found" };
  if (run.status !== "pending_approval" && run.status !== "draft") {
    return { ok: false, error: "Run is not awaiting approval" };
  }
  if (run.lines.length === 0) {
    return { ok: false, error: "No staff lines in this run" };
  }
  const clash = monthHasCommittedRun(
    run.month,
    run.academicYearCode,
    run.id,
  );
  if (clash) {
    return {
      ok: false,
      error: `Cannot approve — month already has ${payrollStatusLabel(clash.status)} payroll`,
    };
  }
  const note = (approvalNote || "").trim();
  const next: PayrollRun = {
    ...run,
    status: "approved",
    approvedBy: by,
    approvedAt: new Date().toISOString(),
    submittedBy: run.submittedBy || by,
    submittedAt: run.submittedAt || new Date().toISOString(),
    rejectionNote: "",
    rejectedBy: "",
    rejectedAt: "",
    remark: note
      ? [run.remark, `Approved: ${note}`].filter(Boolean).join(" · ")
      : run.remark,
    lockVersion: (run.lockVersion || 0) + 1,
  };
  upsertPayrollRun(next);
  appendPayrollAudit({
    by,
    action: "approved",
    runId: next.id,
    month: next.month,
    academicYearCode: next.academicYearCode,
    detail: `Approved · lock v${next.lockVersion} · ${next.lines.length} staff${
      note ? ` · ${note}` : ""
    }`,
  });
  return { ok: true, run: next };
}

/** Principal rejects — return to draft with reason (required). */
export function rejectPayrollRun(
  runId: string,
  by: string,
  reason: string,
): { ok: true; run: PayrollRun } | { ok: false; error: string } {
  const state = loadPayroll();
  const run = state.runs.find((r) => r.id === runId);
  if (!run) return { ok: false, error: "Run not found" };
  if (run.status !== "pending_approval") {
    return { ok: false, error: "Only pending runs can be rejected" };
  }
  const note = (reason || "").trim();
  if (!note) {
    return { ok: false, error: "Rejection reason is required" };
  }
  const next: PayrollRun = {
    ...run,
    status: "draft",
    submittedBy: "",
    submittedAt: "",
    approvedBy: "",
    approvedAt: "",
    rejectionNote: note,
    rejectedBy: by,
    rejectedAt: new Date().toISOString(),
    lockVersion: (run.lockVersion || 0) + 1,
  };
  upsertPayrollRun(next);
  appendPayrollAudit({
    by,
    action: "rejected",
    runId: next.id,
    month: next.month,
    academicYearCode: next.academicYearCode,
    detail: `Rejected · ${note}`,
  });
  return { ok: true, run: next };
}

/**
 * Publish approved payroll to salary account.
 * First point at which accounts, PF/ESIC remit batches, and June holds update.
 * Blocks double-publish for the same month.
 */
export function publishPayrollToAccounts(
  runId: string,
  by: string,
  expectedLockVersion?: number,
): { ok: true; run: PayrollRun } | { ok: false; error: string } {
  const state = loadPayroll();
  const run = state.runs.find((r) => r.id === runId);
  if (!run) return { ok: false, error: "Run not found" };
  if (run.status !== "approved") {
    return {
      ok: false,
      error: "Approve the run before publishing to salary account",
    };
  }
  if (
    expectedLockVersion !== undefined &&
    expectedLockVersion !== (run.lockVersion || 0)
  ) {
    return {
      ok: false,
      error: "Payroll changed since you opened it — refresh and try again",
    };
  }
  const otherPosted = state.runs.find(
    (r) =>
      r.id !== run.id &&
      r.month === run.month &&
      r.academicYearCode === run.academicYearCode &&
      (r.status === "posted" || r.status === "paid"),
  );
  if (otherPosted) {
    return {
      ok: false,
      error: `Double-publish blocked — ${otherPosted.month} already ${payrollStatusLabel(otherPosted.status)}`,
    };
  }
  const staffClash = staffCommittedInMonth(
    run.month,
    run.academicYearCode,
    run.lines.map((l) => l.staffId),
    run.id,
  );
  if (staffClash.length) {
    return {
      ok: false,
      error: `Staff already posted this month: ${staffClash.join(", ")}`,
    };
  }

  const next: PayrollRun = {
    ...run,
    status: "posted",
    postedBy: by,
    postedAt: new Date().toISOString(),
    lockVersion: (run.lockVersion || 0) + 1,
  };
  upsertPayrollRun(next);
  postPayrollToSalaryAccount(next, by);
  syncAdvanceRecoveriesFromPayroll({
    run: next,
    by,
    masters: loadMasters(),
  });
  syncHoldsFromPayrollRun({
    runId: next.id,
    month: next.month,
    lines: next.lines.map((l) => ({
      staffId: l.staffId,
      empCode: l.empCode,
      fullName: l.fullName,
      stream: l.stream,
      netPay: l.netPay,
      juneHold: l.juneHold,
      eligibleForJuneDraw: l.eligibleForJuneDraw,
    })),
  });
  syncRemitFromPayrollRun({
    runId: next.id,
    month: next.month,
    academicYearCode: next.academicYearCode,
    lines: next.lines.map((l) => ({
      staffId: l.staffId,
      empCode: l.empCode,
      fullName: l.fullName,
      statutoryCover: l.statutoryCover,
      components: l.components,
    })),
  });
  appendPayrollAudit({
    by,
    action: "published",
    runId: next.id,
    month: next.month,
    academicYearCode: next.academicYearCode,
    detail: `Posted to salary account · lock v${next.lockVersion} · ${next.lines.length} staff`,
  });
  return { ok: true, run: next };
}

/** Pull back to draft for corrections. Voids account entries if was posted. */
export function recallPayrollToDraft(
  runId: string,
  by = "system",
): { ok: true; run: PayrollRun } | { ok: false; error: string } {
  const state = loadPayroll();
  const run = state.runs.find((r) => r.id === runId);
  if (!run) return { ok: false, error: "Run not found" };
  if (run.status === "paid") {
    return { ok: false, error: "Paid runs cannot be recalled — reverse payment first" };
  }
  if (run.status === "draft") {
    return { ok: true, run };
  }
  const fromStatus = run.status;
  if (run.status === "posted") {
    voidSalaryAccountForRun(run.id);
    voidAdvanceRecoveriesForRun(run.id);
  }
  const next: PayrollRun = {
    ...run,
    status: "draft",
    submittedBy: "",
    submittedAt: "",
    approvedBy: "",
    approvedAt: "",
    postedBy: "",
    postedAt: "",
    rejectionNote:
      fromStatus === "pending_approval" ? run.rejectionNote || "" : "",
    rejectedBy: fromStatus === "pending_approval" ? run.rejectedBy || "" : "",
    rejectedAt: fromStatus === "pending_approval" ? run.rejectedAt || "" : "",
    lockVersion: (run.lockVersion || 0) + 1,
  };
  upsertPayrollRun(next);
  appendPayrollAudit({
    by,
    action: "recalled",
    runId: next.id,
    month: next.month,
    academicYearCode: next.academicYearCode,
    detail: `Recalled from ${fromStatus} · accounts/advances voided if posted · lock v${next.lockVersion}`,
  });
  return { ok: true, run: next };
}

export function markPayrollPaid(
  runId: string,
  by: string,
): { ok: true; run: PayrollRun } | { ok: false; error: string } {
  const state = loadPayroll();
  const run = state.runs.find((r) => r.id === runId);
  if (!run) return { ok: false, error: "Run not found" };
  if (run.status !== "posted") {
    return {
      ok: false,
      error: "Publish to salary account before marking paid",
    };
  }
  const next: PayrollRun = {
    ...run,
    status: "paid",
    paidBy: by,
    paidAt: new Date().toISOString(),
    lockVersion: (run.lockVersion || 0) + 1,
  };
  upsertPayrollRun(next);
  appendPayrollAudit({
    by,
    action: "paid",
    runId: next.id,
    month: next.month,
    academicYearCode: next.academicYearCode,
    detail: `Marked paid · lock v${next.lockVersion}`,
  });
  return { ok: true, run: next };
}

export function deletePayrollRun(runId: string, by = "system"): boolean {
  const state = loadPayroll();
  const run = state.runs.find((r) => r.id === runId);
  if (!run || (run.status !== "draft" && run.status !== "pending_approval")) {
    return false;
  }
  const entry: PayrollAuditEntry = {
    id: nid("pa"),
    at: new Date().toISOString(),
    by,
    action: "deleted",
    runId: run.id,
    month: run.month,
    academicYearCode: run.academicYearCode,
    detail: `Deleted ${run.status} run · ${run.lines.length} staff`,
  };
  savePayroll({
    version: 2,
    runs: state.runs.filter((r) => r.id !== runId),
    audit: [entry, ...(state.audit || [])].slice(0, AUDIT_MAX),
  });
  return true;
}

/** Record rebuild in audit (caller still upserts the run). */
export function auditDraftRebuilt(
  run: PayrollRun,
  by: string,
): void {
  appendPayrollAudit({
    by,
    action: "draft_rebuilt",
    runId: run.id,
    month: run.month,
    academicYearCode: run.academicYearCode,
    detail: `Rebuilt · ${run.lines.length} staff`,
  });
}

export function payslipForStaff(
  run: PayrollRun,
  staffId: string,
): PayrollStaffLine | null {
  return run.lines.find((l) => l.staffId === staffId) ?? null;
}

export function approvedPayslipsForStaff(
  staffId: string,
): { run: PayrollRun; line: PayrollStaffLine }[] {
  const state = loadPayroll();
  const out: { run: PayrollRun; line: PayrollStaffLine }[] = [];
  for (const run of state.runs) {
    if (
      run.status !== "approved" &&
      run.status !== "posted" &&
      run.status !== "paid"
    ) {
      continue;
    }
    const line = payslipForStaff(run, staffId);
    if (line) out.push({ run, line });
  }
  out.sort((a, b) => b.run.month.localeCompare(a.run.month));
  return out;
}

/** Simple Tally-style CSV for salary export */
export function payrollTallyCsv(
  run: PayrollRun,
  salaryAccountLabel: string,
): string {
  const rows: string[][] = [
    [
      "Month",
      "EmpCode",
      "Name",
      "Head",
      "Kind",
      "Amount",
      "SalaryAccount",
      "Status",
    ],
  ];
  for (const line of run.lines) {
    for (const c of line.components) {
      rows.push([
        run.month,
        line.empCode,
        line.fullName,
        c.headName,
        c.kind,
        String(c.amount),
        salaryAccountLabel,
        run.status,
      ]);
    }
    rows.push([
      run.month,
      line.empCode,
      line.fullName,
      "Net Pay",
      "net",
      String(line.netPay),
      salaryAccountLabel,
      run.status,
    ]);
    rows.push([
      run.month,
      line.empCode,
      line.fullName,
      "Payable",
      "payable",
      String(line.amountPayable ?? line.netPay),
      salaryAccountLabel,
      run.status,
    ]);
    if (line.paymentDate || line.paymentMode || line.note) {
      rows.push([
        run.month,
        line.empCode,
        line.fullName,
        `Payment ${line.paymentDate || "—"} / ${line.paymentMode || "—"} / ${line.note || ""}`,
        "payment_meta",
        String(line.amountPayable ?? line.netPay),
        salaryAccountLabel,
        run.status,
      ]);
    }
    if ((line.advanceTaken || 0) > 0) {
      rows.push([
        run.month,
        line.empCode,
        line.fullName,
        `Advance taken (ref) ${line.advanceTaken}; deduct this month ${line.advanceDeduct || 0}`,
        "advance_meta",
        String(line.advanceDeduct || 0),
        salaryAccountLabel,
        run.status,
      ]);
    }
    if ((line.pfGovtDeposit || 0) > 0) {
      rows.push([
        run.month,
        line.empCode,
        line.fullName,
        "PF remittance (EE+ER) to Govt",
        "govt_pf",
        String(line.pfGovtDeposit),
        "EPFO",
        run.status,
      ]);
    }
    if ((line.advanceNewWithSalary || 0) > 0) {
      rows.push([
        run.month,
        line.empCode,
        line.fullName,
        "New advance with salary",
        "advance_new",
        String(line.advanceNewWithSalary),
        salaryAccountLabel,
        run.status,
      ]);
    }
    if ((line.esicGovtDeposit || 0) > 0) {
      rows.push([
        run.month,
        line.empCode,
        line.fullName,
        "ESIC remittance (EE+ER) to Govt",
        "govt_esic",
        String(line.esicGovtDeposit),
        "ESIC",
        run.status,
      ]);
    }
  }
  return rows
    .map((r) =>
      r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");
}

export function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function formatInr(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

export function payrollStatusLabel(s: PayrollRunStatus): string {
  switch (s) {
    case "draft":
      return "Draft (not in accounts)";
    case "pending_approval":
      return "Pending approval";
    case "approved":
      return "Approved (awaiting publish)";
    case "posted":
      return "Posted to account";
    case "paid":
      return "Paid";
    default:
      return s;
  }
}

export function currentMonthIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Prefer paid → posted → approved for a given month. */
export function pickPayslipRun(
  runs: PayrollRun[],
  month: string,
  ay: string,
): PayrollRun | null {
  const list = runs.filter(
    (r) =>
      r.month === month &&
      r.academicYearCode === ay &&
      (r.status === "paid" ||
        r.status === "posted" ||
        r.status === "approved"),
  );
  if (list.length === 0) return null;
  const rank = (s: PayrollRunStatus) =>
    s === "paid" ? 3 : s === "posted" ? 2 : 1;
  return [...list].sort((a, b) => rank(b.status) - rank(a.status))[0];
}

export type { SalaryHead, StaffRecord };
