/**
 * Payroll runs — process draft (individual/bulk) → edit while draft →
 * approve → publish to salary account → paid.
 * Account ledger / PF-ESIC remit / June holds only update on publish.
 */

import { readCache, writeCacheOrInvalidate } from "@/lib/browserStorage";
import { assertModulePermission } from "@/lib/rbacGuard";
import { loadRbac } from "@/lib/rbac";
import type { StaffRecord } from "@/lib/foundationMasters";
import {
  classifyStaffHolidayDay,
} from "@/lib/holidayPolicy";
import type { MastersState } from "@/lib/masters";
import { DEFAULT_AY, loadMasters } from "@/lib/masters";
import { isVisitingStaff } from "@/lib/visitingPay";
import {
  findStaffRegister,
  attendanceExemptStaffIds,
  loadStaffAttendance,
  normalizeAttendanceSettings,
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
  additionalFromLink,
  computeStructureAmounts,
  grossUpFromLink,
  loadSalarySetup,
  normalizeSalarySettings,
  resolveStructureForStaff,
  type SalaryHead,
  type SalarySetupState,
} from "@/lib/salarySetup";
import { trackServerWork } from "@/lib/serverWork";
import { recordPayrollRunDeletion } from "@/lib/payrollNormalizedClient";
import { payrollPaidProgress } from "@/lib/payrollPayGroups";
import {
  NO_SETUP_NOTE,
  figuresOf,
  payrollEmploymentStart,
  setupDiffReasons,
  statutoryCoverFor,
  type SetupSyncRow,
} from "@/lib/payrollSetupSync";

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
  /**
   * Typed by hand on the draft (updateDraftLineComponent). A rebuild from
   * salary setup keeps it unless that line is reset (14 Oct 2026).
   */
  manual?: boolean;
};

export type PayrollPaymentMode =
  | "bank_transfer"
  | "cash"
  | "cheque"
  | "upi"
  | "neft"
  | "other";

export const PAYROLL_PAYMENT_MODES: {
  value: PayrollPaymentMode;
  label: string;
}[] = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "upi", label: "UPI" },
  { value: "neft", label: "NEFT / RTGS" },
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
  /**
   * Day this person's salary was actually paid (YYYY-MM-DD), "" = not yet.
   * Set only by marking the line paid on a posted run (14 Oct 2026): the book
   * posts one payment voucher per (day paid, money account) from these.
   * paymentDate stays the planned day the draft carried.
   */
  paidOn?: string;
  paidBy?: string;
  /** UTR / cheque no. / reference of this person's payment. */
  paymentRef?: string;
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
    const raw = readCache(STORAGE_KEY);
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
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify({ ...state, version: 2 }));
  void trackServerWork(import("@/lib/payrollPersistence").then(({ schedulePayrollSync }) => {
    schedulePayrollSync(state);
  }));
}

export function writePayrollLocalRaw(state: PayrollState) {
  if (typeof window === "undefined") {
    serverPayrollCache = state;
    return;
  }
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify({ ...state, version: 2 }));
}

export function payrollStateIsEmpty(state: PayrollState): boolean {
  return !state.runs?.length;
}

function normalizePaymentMode(v?: string | null): PayrollPaymentMode {
  if (
    v === "cash" ||
    v === "cheque" ||
    v === "upi" ||
    v === "neft" ||
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
    paidOn: String(l.paidOn || "").slice(0, 10),
    paidBy: String(l.paidBy || ""),
    paymentRef: String(l.paymentRef || ""),
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

/** An approved leave request covering this date (any type). */
function approvedLeaveOn(
  hr: ReturnType<typeof loadStaffHr>,
  staffId: string,
  date: string,
  ay: string,
): boolean {
  return hr.leaveRequests.some(
    (r) =>
      r.staffId === staffId &&
      r.status === "approved" &&
      (!r.academicYearCode || r.academicYearCode === ay) &&
      r.fromDate <= date &&
      r.toDate >= date,
  );
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
  /** Filled with who was left out because they joined after the month. */
  excludedOut?: { staffId: string; fullName: string; joiningDate: string }[];
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
    // Visiting staff are paid from their month work sheet (Staff → Visiting
    // pay), never from payroll — no salary, PF, ESIC, payslip or bank file.
    if (isVisitingStaff(s)) return false;
    if (opts.staffIds?.length && !opts.staffIds.includes(s.id)) return false;
    // Joined after the month: no salary for it (Sanjay Pratap, joined
    // 1 Aug 2026, was in the July draft).
    const link = salary.staffLinks.find((l) => l.staffId === s.id);
    const start = payrollEmploymentStart(opts.month, s.joiningDate, link?.effectiveFrom);
    if (start.excluded) {
      // Said in the result, never silent: joining dates were repaired for a
      // day/month mix-up on 7 Oct 2026, and a wrong one would drop a person.
      opts.excludedOut?.push({ staffId: s.id, fullName: s.fullName, joiningDate: start.from });
      return false;
    }
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
  // Read once per run: who keeps no attendance, leave, and "today" (IST).
  const attState = loadStaffAttendance();
  const exemptIds = attendanceExemptStaffIds(
    normalizeAttendanceSettings(attState.settings),
    (() => {
      try {
        return loadRbac();
      } catch {
        return null;
      }
    })(),
  );
  const hr = loadStaffHr();
  const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

  for (const staff of roster) {
    const structure = resolveStructureForStaff(salary, staff);
    if (!structure) continue;
    const link = salary.staffLinks.find((l) => l.staffId === staff.id);
    // No salary setup = no PF/ESI decision made: never PF + ESIC by default.
    const coverFor = statutoryCoverFor(link);
    const employed = payrollEmploymentStart(opts.month, staff.joiningDate, link?.effectiveFrom);
    const amounts = computeStructureAmounts(
      salary,
      structure,
      link?.basicOverride || 0,
      coverFor.cover,
      opts.masters.statutoryConfig,
      additionalFromLink(link),
      grossUpFromLink(link),
    );

    let daysPresent = 0;
    let daysAbsent = 0;
    let daysHalf = 0;
    let daysLeavePaid = 0;
    let daysHoliday = 0;
    let lateCount = 0;
    // Days before joining are not paid — not a holiday, not present, not
    // absent (14 Oct 2026; the July draft paid new joiners a full month).
    let daysNotJoined = 0;
    // Working days with no register mark, counted absent — said on the line.
    let daysUnmarked = 0;

    for (const d of monthDays) {
      if (d < employed.from) {
        daysNotJoined += 1;
        continue;
      }
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
        // Staff who keep no attendance (owner/admin by main role, and the
        // office's exempt list) are never on a register — they are paid.
        if (exemptIds.has(staff.id)) {
          daysPresent += 1;
          continue;
        }
        // ended field survey still counts as present (outdoor duty)
        if (hasEndedSurveyWorkForStaff(staff.id, d)) {
          daysPresent += 1;
          continue;
        }
        // A day still to come in a run built mid-month is not an absence.
        if (d > todayIso) {
          daysPresent += 1;
          continue;
        }
        // Approved leave with no register — leave, not absence (unpaid
        // types are deducted once, by unpaidLeave below).
        if (approvedLeaveOn(hr, staff.id, d, ay)) {
          daysLeavePaid += 1;
          continue;
        }
        // No register, no mark, working day: ABSENT. Until 2026-09-29 this
        // was "assume present", so a month nobody marked paid everyone in
        // full. The director: a day with no register is absent unless it is
        // a holiday; anything the office marks before the run counts.
        daysAbsent += 1;
        daysUnmarked += 1;
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
    // Days before joining go through loss of pay, so the book reduces the
    // salary expense for them (payroll_ledger_post reads the LWP component).
    // They are pro-rated on the month's calendar days — joined on 22 Jul is
    // 10/31 of the month paid — while absences stay on the configured day
    // count (notJoinedDeduction, one rule for a build and a rebuild).
    const daysLwp = daysAbsent + halfAsAbsent + unpaidLeave + daysNotJoined;
    const dayRate = amounts.gross / dayCount;
    const lwpDeduction =
      Math.round(dayRate * (daysLwp - daysNotJoined)) +
      notJoinedDeduction(amounts.gross, daysNotJoined, monthDays.length);
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

    const cover = coverFor.cover;
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
        coverFor.noSetup ? NO_SETUP_NOTE : "",
        link?.salaryAccountNote || "",
        unpaidLeave > 0
          ? `LWP includes ${unpaidLeave} approved unpaid leave day(s)`
          : "",
        daysNotJoined > 0
          ? `Joined ${employed.from}: LWP includes ${daysNotJoined} day(s) before joining`
          : "",
        daysUnmarked > 0
          ? `No attendance marked on ${daysUnmarked} working day(s) — counted absent`
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

/**
 * Staff whose salary for the month is already approved, posted or paid, in
 * any run (staff id → "EMP-CODE Name"). A month is no longer one run: the
 * school pays staff on different days (director, 13 Oct 2026), so the rule is
 * per person — nobody is paid twice for a month — never per month.
 */
export function committedStaffInMonth(
  month: string,
  academicYearCode: string,
  exceptRunId?: string,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of loadPayroll().runs) {
    if (exceptRunId && r.id === exceptRunId) continue;
    if (r.month !== month || r.academicYearCode !== academicYearCode) continue;
    if (!isPayrollLocked(r)) continue;
    for (const l of r.lines) {
      if (!out.has(l.staffId)) out.set(l.staffId, `${l.empCode} ${l.fullName}`.trim());
    }
  }
  return out;
}

function namesList(names: string[], max = 4): string {
  return names.length <= max
    ? names.join(", ")
    : `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
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
    // A recalled run keeps who was already paid, and on which day.
    paidOn: previous.paidOn || "",
    paidBy: previous.paidBy || "",
    paymentRef: previous.paymentRef || "",
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
        ? { ...c, amount: Math.max(0, Math.round(amount)), manual: true }
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

/** Put the draft's hand-typed head amounts back on a rebuilt line. */
function keepManualComponents(line: PayrollStaffLine, manual: PayrollLineComponent[]): PayrollStaffLine {
  const components = line.components.map((c) => {
    const m = manual.find((x) => x.headCode === c.headCode && x.kind === c.kind);
    return m ? { ...c, amount: m.amount, manual: true } : c;
  });
  for (const m of manual) {
    if (!components.some((c) => c.headCode === m.headCode && c.kind === m.kind)) components.push(m);
  }
  return recalculateLineFromComponents({ ...line, components });
}

/** Head-by-head amounts that a rebuild changes ("PF (employee) 1800 → 0"). */
function headChanges(before: PayrollLineComponent[], after: PayrollLineComponent[]): string[] {
  const key = (c: PayrollLineComponent) => `${c.kind}:${c.headCode}`;
  const out: string[] = [];
  const keys = [...new Set([...before.map(key), ...after.map(key)])];
  for (const k of keys) {
    const b = before.find((c) => key(c) === k);
    const a = after.find((c) => key(c) === k);
    const was = b?.amount ?? 0;
    const now = a?.amount ?? 0;
    if (was !== now) out.push(`${(a ?? b)!.headName} ${was} → ${now}`);
  }
  return out;
}

/** Pay not earned before joining: the month's calendar-day share. */
export function notJoinedDeduction(gross: number, daysNotJoined: number, monthDayCount: number): number {
  if (daysNotJoined <= 0 || monthDayCount <= 0) return 0;
  return Math.round((gross * Math.min(daysNotJoined, monthDayCount)) / monthDayCount);
}

/** Notes the draft builder writes itself — replaced, not kept, on a rebuild. */
const SYSTEM_NOTE = /^(No salary setup — |Joined \d{4}-\d{2}-\d{2}: |No attendance marked on |LWP includes \d+(\.\d+)? approved unpaid leave)/;

function mergeNotes(fresh: string, previous: string): string {
  const parts = [
    ...fresh.split(" · "),
    ...previous.split(" · ").filter((p) => !SYSTEM_NOTE.test(p.trim())),
  ].map((p) => p.trim()).filter(Boolean);
  return [...new Set(parts)].join(" · ");
}

/**
 * A rebuilt line with the draft's own attendance: days, loss of pay (re-rated
 * on the rebuilt gross) and late penalty. The registers for a month can be
 * incomplete (July 2026: registers on 26 days, most staff on 7 of them), so a
 * setup rebuild never re-reads attendance for someone employed all month —
 * only for someone who joined during it, whose days must change.
 */
function keepDraftAttendance(
  fresh: PayrollStaffLine,
  draft: PayrollStaffLine,
  dayCount: number,
  /** Calendar days of the month before this person joined (0 = all month). */
  notJoined: number,
  monthDayCount: number,
): PayrollStaffLine {
  // One rule for every unmarked day (re-review of #620, 14 Oct 2026): a
  // rebuild keeps the basis the draft counted its days on, for everyone. For
  // someone who joined during the month only the days before joining are
  // cut: the draft's own day counts are scaled to the days in service, and
  // the days before joining are pro-rated on calendar days.
  // A draft built since this fix already counts only days in service (its
  // day columns add up to them, and its LWP holds the days before joining):
  // it is not cut again. A draft built before it counted the whole month.
  const counted =
    (draft.daysPresent || 0) + (draft.daysAbsent || 0) + (draft.daysHalf || 0) +
    (draft.daysLeavePaid || 0) + (draft.daysHoliday || 0);
  const wholeMonthBasis = notJoined > 0 && counted > monthDayCount - notJoined + 0.5;
  const frac = wholeMonthBasis ? Math.max(0, monthDayCount - notJoined) / monthDayCount : 1;
  const scale = (n: number) => (wholeMonthBasis ? Math.round((n || 0) * frac * 2) / 2 : n || 0);
  const otherLwp = wholeMonthBasis
    ? scale(draft.daysLwp || 0)
    : Math.max(0, (draft.daysLwp || 0) - notJoined);
  const lwpDeduction =
    Math.round((fresh.gross / (dayCount || 30)) * otherLwp) +
    notJoinedDeduction(fresh.gross, notJoined, monthDayCount);
  const latePenalty = draft.gross > 0 ? Math.round((draft.latePenalty || 0) * (fresh.gross / draft.gross)) : 0;
  const keep = fresh.components.filter((c) => c.headCode !== "LWP" && c.headCode !== "LATE");
  const lwpC = draft.components.find((c) => c.headCode === "LWP");
  const lateC = draft.components.find((c) => c.headCode === "LATE");
  const components = [...keep];
  if (lwpDeduction > 0) {
    components.push({ headId: lwpC?.headId || "lwp", headCode: "LWP", headName: lwpC?.headName || "Loss of pay", kind: "deduction", amount: lwpDeduction });
  }
  if (latePenalty > 0) {
    components.push({ headId: lateC?.headId || "late", headCode: "LATE", headName: lateC?.headName || "Late penalty", kind: "deduction", amount: latePenalty });
  }
  return recalculateLineFromComponents({
    ...fresh,
    components,
    daysPresent: scale(draft.daysPresent),
    daysAbsent: scale(draft.daysAbsent),
    daysHalf: scale(draft.daysHalf),
    daysLeavePaid: scale(draft.daysLeavePaid),
    daysLwp: otherLwp + notJoined,
    daysHoliday: scale(draft.daysHoliday),
    lwpDeduction,
    latePenalty,
    // The builder's attendance notes belong to the attendance it read.
    note: fresh.note.split(" · ").filter((p) => !/^No attendance marked on /.test(p)).join(" · "),
  });
}

/**
 * Each line of a run against salary setup, attendance and the joining date
 * as they are now (director, 14 Oct 2026). A line is rebuilt exactly as
 * processing would build it today, with its own adjustments kept (bonus,
 * special deduction, advance, payment day / mode / note —
 * mergePreservedAdjustments); a person who joined after the month is offered
 * for removal. Nothing is changed here — see applyDraftSetupSync.
 */
export function previewDraftSetupSync(
  run: PayrollRun,
  masters: MastersState,
  salary: SalarySetupState = loadSalarySetup(),
  /** Lines whose hand-typed head amounts go back to salary setup. */
  resetStaffIds: ReadonlySet<string> = new Set(),
): { rows: SetupSyncRow[]; rebuilt: Map<string, PayrollStaffLine> } {
  const fresh = buildPayrollDraft({
    masters,
    salary,
    month: run.month,
    academicYearCode: run.academicYearCode,
    createdBy: "preview",
    dayCountOverride: run.dayCount,
    staffIds: run.lines.map((l) => l.staffId),
    kind: run.kind,
  });
  const byId = new Map(fresh.lines.map((l) => [l.staffId, l]));
  const rebuilt = new Map<string, PayrollStaffLine>();
  const rows: SetupSyncRow[] = run.lines.map((line) => {
    const staff = (masters.staff ?? []).find((s) => s.id === line.staffId);
    const link = salary.staffLinks.find((l) => l.staffId === line.staffId);
    const noSetup = statutoryCoverFor(link).noSetup;
    const f = byId.get(line.staffId);
    if (!f) {
      const employed = staff ? payrollEmploymentStart(run.month, staff.joiningDate, link?.effectiveFrom) : null;
      const excludedReason = !staff
        ? "Not on the staff list any more"
        : employed?.excluded
          ? `Joined ${employed.from} — after ${run.month}`
          : staff.status !== "active"
            ? "Not an active staff member"
            : isVisitingStaff(staff)
              ? "Visiting staff — paid from the work sheet"
              : "No salary structure";
      return {
        staffId: line.staffId,
        fullName: line.fullName,
        empCode: line.empCode,
        action: employed?.excluded ? ("remove" as const) : ("none" as const),
        reasons: employed?.excluded ? [`${excludedReason} — fix the joining date in Masters if it is wrong`] : [excludedReason],
        noSetup,
        before: figuresOf(line),
        after: null,
        kept: [],
        reset: [],
        headChanges: [],
      };
    }
    const employed = payrollEmploymentStart(run.month, staff?.joiningDate, link?.effectiveFrom);
    const monthDayCount = daysInMonth(run.month).length;
    const notJoined = employed.joinedInMonth ? Number(employed.from.slice(8, 10)) - 1 : 0;
    const attended = keepDraftAttendance(f, line, run.dayCount, notJoined, monthDayCount);
    // Hand-typed head amounts stay, unless this line is reset to setup.
    const manual = line.components.filter((c) => c.manual);
    const reset = resetStaffIds.has(line.staffId);
    const base = manual.length && !reset ? keepManualComponents(attended, manual) : attended;
    const merged = { ...mergePreservedAdjustments(base, line), note: mergeNotes(base.note, line.note || "") };
    rebuilt.set(line.staffId, merged);
    const reasons = setupDiffReasons(figuresOf(line), figuresOf(merged), { noSetup });
    return {
      staffId: line.staffId,
      fullName: line.fullName,
      empCode: line.empCode,
      action: reasons.length ? ("rebuild" as const) : ("none" as const),
      reasons,
      noSetup,
      before: figuresOf(line),
      after: figuresOf(merged),
      kept: reset ? [] : manual.map((c) => `${c.headName} ${c.amount}`),
      reset: reset ? manual.map((c) => c.headName) : [],
      headChanges: headChanges(line.components, merged.components),
    };
  });
  return { rows, rebuilt };
}

/** Rebuild (or remove) the chosen lines of a draft from salary setup. Audited per person. */
export function applyDraftSetupSync(
  runId: string,
  staffIds: string[],
  masters: MastersState,
  by: string,
  /** Lines whose hand-typed head amounts are reset to salary setup. */
  resetStaffIds: string[] = [],
): {
  ok: true;
  run: PayrollRun;
  rebuilt: number;
  removed: number;
  /** Who was removed and why (joining date) — said in the result. */
  removedWho: string[];
} | { ok: false; error: string } {
  const state = loadPayroll();
  const run = state.runs.find((r) => r.id === runId);
  if (!run) return { ok: false, error: "Run not found" };
  const locked = guardDraftOnly(run);
  if (locked) return { ok: false, error: locked };
  const { rows, rebuilt } = previewDraftSetupSync(run, masters, loadSalarySetup(), new Set(resetStaffIds));
  const chosen = rows.filter((r) => staffIds.includes(r.staffId) && r.action !== "none");
  if (!chosen.length) return { ok: false, error: "Nothing on this run differs from salary setup" };
  const remove = new Set(chosen.filter((r) => r.action === "remove").map((r) => r.staffId));
  const rebuild = new Set(chosen.filter((r) => r.action === "rebuild").map((r) => r.staffId));
  const lines = run.lines
    .filter((l) => !remove.has(l.staffId))
    .map((l) => (rebuild.has(l.staffId) ? rebuilt.get(l.staffId)! : l));
  const next: PayrollRun = {
    ...run,
    lines,
    kind: lines.length <= 1 ? "individual" : run.kind,
    lockVersion: (run.lockVersion || 0) + 1,
  };
  upsertPayrollRun(next);
  for (const r of chosen) {
    appendPayrollAudit({
      by,
      action: "line_edited",
      runId: run.id,
      month: run.month,
      academicYearCode: run.academicYearCode,
      detail:
        r.action === "remove"
          ? `${r.fullName}: removed — ${r.reasons.join("; ")}`
          : `${r.fullName}: rebuilt from salary setup — ${r.reasons.join("; ")} · net ${r.before.netPay} → ${r.after!.netPay}, employer ${r.before.employerCost} → ${r.after!.employerCost}${r.kept.length ? ` · kept your edits: ${r.kept.join(", ")}` : ""}${r.reset.length ? ` · reset to setup: ${r.reset.join(", ")}` : ""}`,
    });
  }
  return {
    ok: true,
    run: next,
    rebuilt: rebuild.size,
    removed: remove.size,
    removedWho: chosen.filter((r) => r.action === "remove").map((r) => `${r.fullName}: ${r.reasons[0]}`),
  };
}

/**
 * Lines a run should not move on with silently: no salary setup, or not as
 * salary setup, attendance and joining dates give them now. Asked before
 * submit / approve / publish (director, 14 Oct 2026).
 */
export function runSetupWarnings(run: PayrollRun, masters: MastersState): string[] {
  const { rows } = previewDraftSetupSync(run, masters);
  return rows
    .filter((r) => r.noSetup || r.action !== "none")
    .map((r) => `${r.fullName} (${r.empCode}): ${r.noSetup && r.action === "none" ? "No salary setup" : r.reasons.join("; ")}`);
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
  | {
      ok: true;
      run: PayrollRun;
      merged: boolean;
      skipped: string[];
      /** Left out: joined after the month ("Name (joined YYYY-MM-DD)"). */
      excluded: string[];
    }
  | { ok: false; error: string } {
  if (opts.mode === "individual" && !opts.staffIds?.length) {
    return { ok: false, error: "Select at least one staff member" };
  }

  // Staff already paid (or approved/posted) for this month are left out —
  // whoever is still due can be processed now, one, several or all at once.
  const committed = committedStaffInMonth(opts.month, opts.academicYearCode);
  const skipped: string[] = [];
  let staffIds = opts.staffIds;
  if (opts.mode === "individual" && staffIds?.length) {
    for (const id of staffIds) {
      const name = committed.get(id);
      if (name) skipped.push(name);
    }
    staffIds = staffIds.filter((id) => !committed.has(id));
    if (staffIds.length === 0) {
      return {
        ok: false,
        error: `Nothing was created — ${namesList(skipped)} already ${skipped.length === 1 ? "has" : "have"} ${opts.month} salary approved, posted or paid.`,
      };
    }
  } else if (opts.mode === "bulk" && committed.size > 0) {
    const due = (opts.masters.staff ?? [])
      .filter((s) => s.status === "active" && !committed.has(s.id))
      .map((s) => s.id);
    skipped.push(...committed.values());
    if (due.length === 0) {
      return {
        ok: false,
        error: `Nothing was created — every active staff member already has ${opts.month} salary approved, posted or paid.`,
      };
    }
    staffIds = due;
  }

  // Joined after the month: said in the result (fix the date in Masters if wrong).
  const excludedOut: { staffId: string; fullName: string; joiningDate: string }[] = [];
  const excludedNames = () => [...new Set(excludedOut.map((e) => `${e.fullName} (joined ${e.joiningDate})`))];
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
      staffIds,
      kind: "bulk",
      excludedOut,
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
      return { ok: true, run: next, merged: false, skipped, excluded: excludedNames() };
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
    return { ok: true, run: built, merged: false, skipped, excluded: excludedNames() };
  }

  const built = buildPayrollDraft({
    masters: opts.masters,
    month: opts.month,
    academicYearCode: opts.academicYearCode,
    createdBy: opts.createdBy,
    staffIds,
    kind: "individual",
    excludedOut,
  });
  if (built.lines.length === 0) {
    const ex = excludedNames();
    return {
      ok: false,
      error: ex.length
        ? `Nothing was created — ${ex.join(", ")} joined after ${opts.month}. Fix the joining date in Masters if it is wrong.`
        : "No salary structure for selected staff — assign in Salary setup",
    };
  }

  if (open && open.status === "draft") {
    const keep = open.lines.filter(
      (l) => !staffIds!.includes(l.staffId),
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
      detail: `Merged ${staffIds!.length} staff · now ${next.lines.length} lines`,
    });
    return { ok: true, run: next, merged: true, skipped, excluded: excludedNames() };
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
  return { ok: true, run: built, merged: false, skipped, excluded: excludedNames() };
}

/** The payment fields of a line — all a posted run's line may change. */
const LINE_PAYMENT_FIELDS = ["paymentDate", "paymentMode", "note", "paidOn", "paidBy", "paymentRef"] as const;

/** Same staff, same order, same amounts — at most the payment fields differ. */
export function onlyPaymentFieldsDiffer(before: PayrollStaffLine[], after: PayrollStaffLine[]): boolean {
  if (before.length !== after.length) return false;
  const strip = (l: PayrollStaffLine) => {
    const o: Record<string, unknown> = { ...l };
    for (const k of LINE_PAYMENT_FIELDS) delete o[k];
    return JSON.stringify(o, Object.keys(o).sort());
  };
  return before.every((l, i) => strip(normalizePayrollLine(l)) === strip(normalizePayrollLine(after[i]!)));
}

export function upsertPayrollRun(run: PayrollRun): PayrollState {
  const state = loadPayroll();
  const existing = state.runs.find((r) => r.id === run.id);
  if (
    existing &&
    accountsTouched(existing) &&
    accountsTouched(run) &&
    !onlyPaymentFieldsDiffer(existing.lines, run.lines)
  ) {
    // Hard lock: never mutate posted/paid salary lines in place. Who was
    // paid, on which day, how and with what reference are the only fields a
    // posted run's lines take (14 Oct 2026) — the amounts never move. This
    // lock used to drop "Pay by UPI" line payments silently as well.
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
  const already = committedStaffInMonth(run.month, run.academicYearCode, run.id);
  const twice = run.lines.filter((l) => already.has(l.staffId)).map((l) => `${l.empCode} ${l.fullName}`.trim());
  if (twice.length) {
    return {
      ok: false,
      error: `Not submitted — ${namesList(twice)} already ${twice.length === 1 ? "has" : "have"} ${run.month} salary in another approved, posted or paid run. Remove ${twice.length === 1 ? "that line" : "those lines"} from this draft first.`,
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
  const already = committedStaffInMonth(run.month, run.academicYearCode, run.id);
  const twice = run.lines.filter((l) => already.has(l.staffId)).map((l) => `${l.empCode} ${l.fullName}`.trim());
  if (twice.length) {
    return {
      ok: false,
      error: `Not approved — ${namesList(twice)} already ${twice.length === 1 ? "has" : "have"} ${run.month} salary in another approved, posted or paid run. Remove ${twice.length === 1 ? "that line" : "those lines"} from this draft first.`,
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
  // Another run of the same month may be posted — staff are paid on
  // different days. What may never happen is one person posted twice.
  const staffClash = staffCommittedInMonth(
    run.month,
    run.academicYearCode,
    run.lines.map((l) => l.staffId),
    run.id,
  );
  if (staffClash.length) {
    return {
      ok: false,
      error: `Not published — ${namesList(staffClash)} already ${staffClash.length === 1 ? "has" : "have"} ${run.month} salary in another approved, posted or paid run. Nothing was posted.`,
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

/**
 * Why a run cannot go back to draft because salary on it was already paid
 * (null = it can). A partly paid run is still "posted", but the money of the
 * staff marked paid has left: recalling would reverse their payments in the
 * book and post them again on re-post — perhaps at changed amounts — or lose
 * them if the draft were deleted (review of PR #620, 14 Oct 2026).
 */
export function payrollRecallBlockedReason(run: Pick<PayrollRun, "status" | "lines">): string | null {
  if (run.status === "paid") {
    return "Not recalled — this salary is already marked paid, so it cannot go back to draft. Nothing was changed.";
  }
  const paid = run.lines.filter((l) => l.paidOn);
  if (paid.length) {
    return `Not recalled — ${namesList(paid.map((l) => l.fullName))} ${paid.length === 1 ? "is" : "are"} already marked paid on this run, so it cannot go back to draft. Un-mark a person only if that payment was not made. Nothing was changed.`;
  }
  return null;
}

/** Pull back to draft for corrections. Voids account entries if was posted. */
export function recallPayrollToDraft(
  runId: string,
  by = "system",
  /** What the server book reversed (lib/payrollBookClient) — for the audit trail. */
  book?: { reversed: { voucherNo: string; reversalNo: string }[] },
): { ok: true; run: PayrollRun } | { ok: false; error: string } {
  const state = loadPayroll();
  const run = state.runs.find((r) => r.id === runId);
  if (!run) return { ok: false, error: "Run not found" };
  const blocked = payrollRecallBlockedReason(run);
  if (blocked) return { ok: false, error: blocked };
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
    detail: `Recalled from ${fromStatus} · accounts/advances voided if posted${
      book?.reversed.length
        ? ` · book reversed ${book.reversed.map((r) => `${r.voucherNo} → ${r.reversalNo}`).join(", ")}`
        : ""
    } · lock v${next.lockVersion}`,
  });
  return { ok: true, run: next };
}

/**
 * The day a run's salary was actually paid, as the office enters it — the
 * books date the salary payment on this day (payroll_ledger_post reads
 * paid_at in India time). Director, 7 Oct 2026: "it should be enter date for
 * marked paid" — it used to be the moment the button was pressed.
 * Not in the future, and not before the run's own month began.
 */
export function payrollPaidOnError(month: string, paidOn: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return "Enter the date the salary was paid";
  if (paidOn > today) return "The paid date cannot be in the future";
  if (/^\d{4}-\d{2}$/.test(month) && paidOn < `${month}-01`) {
    return `The paid date cannot be before ${month}-01 — the month this salary is for`;
  }
  return null;
}

/** Today's date in India (YYYY-MM-DD), whatever the browser's zone. */
export function todayIstDate(now = new Date()): string {
  return new Date(now.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

/** The lines' own payment date when they all agree, else "" (the office picks). */
export function payrollRunPaymentDate(run: Pick<PayrollRun, "lines">): string {
  const dates = [...new Set(run.lines.map((l) => (l.paymentDate || "").slice(0, 10)).filter(Boolean))];
  return dates.length === 1 ? dates[0]! : "";
}

export type PayrollLinePaymentInput = {
  /** Day paid, YYYY-MM-DD (India). */
  date: string;
  /** Leave out to keep each line's own (planned) mode. */
  mode?: PayrollPaymentMode;
  /** UTR / cheque no. / reference. */
  ref?: string;
};

/**
 * Mark staff paid on a posted run, each on the day they were actually paid
 * (director, 14 Oct 2026: "I have to pay on different dates for every
 * staff"). Sets the line's paid day, mode and reference — never an amount.
 * The book (payroll_ledger_post, run on save) posts one payment voucher per
 * (day paid, money account). When every line with something payable is
 * paid, the run becomes paid on the latest of those days; until then it is
 * "posted · partly paid (n of m)".
 */
export function markPayrollLinesPaid(
  runId: string,
  staffIds: string[],
  paid: PayrollLinePaymentInput,
  by: string,
  now = new Date(),
): { ok: true; run: PayrollRun; marked: number } | { ok: false; error: string } {
  const state = loadPayroll();
  const run = state.runs.find((r) => r.id === runId);
  if (!run) return { ok: false, error: "Run not found" };
  if (run.status !== "posted" && run.status !== "paid") {
    return { ok: false, error: "Publish the run to the salary account before marking anyone paid" };
  }
  const err = payrollPaidOnError(run.month, paid.date, todayIstDate(now));
  if (err) return { ok: false, error: err };
  if (run.status === "paid" && !run.lines.some((l) => l.paidOn)) {
    return { ok: false, error: "This run was marked paid as a whole before per-person dates — its payment is already one voucher in the book" };
  }
  const wanted = new Set(staffIds);
  const targets = run.lines.filter((l) => wanted.has(l.staffId));
  if (!targets.length) return { ok: false, error: "Choose the staff who were paid" };
  const ref = (paid.ref || "").trim();
  const mode = paid.mode ? normalizePaymentMode(paid.mode) : null;
  let marked = 0;
  const lines = run.lines.map((l) => {
    if (!wanted.has(l.staffId)) return l;
    marked += 1;
    const note = ref && !(l.note || "").includes(ref)
      ? [l.note?.trim(), `${(mode ?? l.paymentMode) === "cheque" ? "Cheque" : "UTR"} ${ref}`].filter(Boolean).join(" · ")
      : l.note || "";
    return {
      ...l,
      paidOn: paid.date,
      paidBy: by,
      paymentDate: paid.date,
      paymentMode: mode ?? l.paymentMode,
      paymentRef: ref || l.paymentRef || "",
      note,
    };
  });
  const next = settlePaidStatus({ ...run, lines, lockVersion: (run.lockVersion || 0) + 1 }, by);
  upsertPayrollRun(next);
  const names = namesList(targets.map((l) => l.fullName));
  appendPayrollAudit({
    by,
    action: next.status === "paid" && run.status !== "paid" ? "paid" : "line_edited",
    runId: next.id,
    month: next.month,
    academicYearCode: next.academicYearCode,
    detail: `${names}: paid on ${paid.date}${mode ? ` by ${paymentModeLabel(mode)}` : ""}${ref ? ` · ref ${ref}` : ""}${next.status === "paid" && run.status !== "paid" ? " · every line paid — run marked paid" : ""} · lock v${next.lockVersion}`,
  });
  return { ok: true, run: next, marked };
}

/**
 * A line marked paid by mistake. Allowed only for a line marked paid on its
 * own (one with a paid day). Its payment group in the book is reversed and
 * re-posted for the others paid that day by the same means — the book does
 * that on save (payroll_ledger_post regroups); a voucher in a locked period
 * makes the save's book step fail, and the screen says so. A run paid as a
 * whole before 14 Oct (no line has a paid day) is not un-marked here.
 */
export function unmarkPayrollLinePaid(
  runId: string,
  staffId: string,
  by: string,
): { ok: true; run: PayrollRun } | { ok: false; error: string } {
  const state = loadPayroll();
  const run = state.runs.find((r) => r.id === runId);
  if (!run) return { ok: false, error: "Run not found" };
  const line = run.lines.find((l) => l.staffId === staffId);
  if (!line) return { ok: false, error: "That staff member is not on this run" };
  if (!line.paidOn) {
    return {
      ok: false,
      error: run.status === "paid"
        ? "This run was marked paid as a whole — its payment is one voucher in the book. Reverse it in Accounts if it is wrong."
        : `${line.fullName} is not marked paid`,
    };
  }
  const lines = run.lines.map((l) =>
    l.staffId === staffId ? { ...l, paidOn: "", paidBy: "", paymentRef: "" } : l,
  );
  const next = settlePaidStatus({ ...run, lines, lockVersion: (run.lockVersion || 0) + 1 }, by);
  upsertPayrollRun(next);
  appendPayrollAudit({
    by,
    action: "line_edited",
    runId: next.id,
    month: next.month,
    academicYearCode: next.academicYearCode,
    detail: `${line.fullName}: paid on ${line.paidOn} un-marked — the book regroups that day's payment · lock v${next.lockVersion}`,
  });
  return { ok: true, run: next };
}

/** posted ⇄ paid from the lines: paid only when everyone with something payable is. */
function settlePaidStatus(run: PayrollRun, by: string): PayrollRun {
  const p = payrollPaidProgress(run.lines);
  if (p.allPaid) {
    return {
      ...run,
      status: "paid",
      paidBy: run.status === "paid" ? run.paidBy || by : by,
      paidAt: new Date(`${p.lastPaidOn}T12:00:00+05:30`).toISOString(),
    };
  }
  if (run.status === "paid") return { ...run, status: "posted", paidBy: "", paidAt: "" };
  return run;
}

/**
 * One staff member's salary was paid (by UPI, from the ERP's "Pay by UPI" —
 * director, 7 Oct 2026): their line is marked paid on that day with the UPI
 * reference.
 */
export function recordPayrollLinePayment(
  runId: string,
  staffId: string,
  paid: { mode: PayrollPaymentMode; date: string; ref: string },
  by: string,
): { ok: true; run: PayrollRun } | { ok: false; error: string } {
  const r = markPayrollLinesPaid(runId, [staffId], paid, by);
  return r.ok ? { ok: true, run: r.run } : r;
}

/**
 * The whole run paid on one day: every line not yet paid is marked paid on
 * that day (each by its own mode unless one is given). Lines already paid on
 * their own day keep it.
 */
export function markPayrollPaid(
  runId: string,
  by: string,
  paidOn?: string,
  mode?: PayrollPaymentMode,
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
  const day = paidOn ?? todayIstDate();
  const unpaid = run.lines.filter((l) => !l.paidOn).map((l) => l.staffId);
  if (!unpaid.length) {
    return { ok: false, error: "Everyone on this run is already marked paid" };
  }
  const r = markPayrollLinesPaid(runId, unpaid, { date: day, mode }, by);
  if (!r.ok) return r;
  // Nothing payable at all (every line held): still a paid run.
  if (r.run.status !== "paid") {
    const next: PayrollRun = {
      ...r.run,
      status: "paid",
      paidBy: by,
      paidAt: new Date(`${day}T12:00:00+05:30`).toISOString(),
    };
    upsertPayrollRun(next);
    return { ok: true, run: next };
  }
  return { ok: true, run: r.run };
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
  if (typeof window !== "undefined") recordPayrollRunDeletion(run.id);
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

/**
 * Every staff member's salary line for the month, across all its runs — a
 * month can be paid in several runs (staff paid on different days). Each
 * person comes from their best run (paid → posted → approved); `run` is the
 * run that line belongs to, for its status and dates.
 */
export function monthPayslipLines(
  runs: PayrollRun[],
  month: string,
  ay: string,
  statuses: PayrollRunStatus[] = ["paid", "posted", "approved"],
): { run: PayrollRun; line: PayrollStaffLine }[] {
  const rank = (s: PayrollRunStatus) =>
    s === "paid" ? 3 : s === "posted" ? 2 : 1;
  const best = new Map<string, { run: PayrollRun; line: PayrollStaffLine }>();
  for (const r of runs) {
    if (r.month !== month || r.academicYearCode !== ay) continue;
    if (!statuses.includes(r.status)) continue;
    for (const line of r.lines) {
      const have = best.get(line.staffId);
      if (!have || rank(r.status) > rank(have.run.status)) {
        best.set(line.staffId, { run: r, line });
      }
    }
  }
  return [...best.values()].sort((a, b) =>
    a.line.empCode.localeCompare(b.line.empCode),
  );
}

export type { SalaryHead, StaffRecord };
