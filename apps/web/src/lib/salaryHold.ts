/**
 * Teaching-staff June (summer vacation) salary hold rules.
 *
 * Policy (school):
 * - Only teaching staff — non-teaching paid normally every month.
 * - June net salary is held until leaving the school.
 * - To draw that held June pay: staff must have completed ≥1 year
 *   of service by that June; else hold is not drawable (forfeited).
 * - On resignation with notice ≥ min months before leaving date:
 *   running-month salary + drawable held June is released.
 * - Without proper notice: stays held until Super Admin approval.
 */

import type { StaffRecord } from "@/lib/foundationMasters";
import {
  loadSalarySetup,
  normalizeSalarySettings,
  type SalarySettings,
} from "@/lib/salarySetup";

import { assertModulePermission } from "@/lib/rbacGuard";
import { isSuperAdminSession } from "@/lib/superAdmin";
export type JuneHoldStatus =
  | "held"
  | "forfeited_incomplete_year"
  | "pending_super_admin"
  | "released_on_exit"
  | "released_super_admin";

export type JuneSalaryHold = {
  id: string;
  staffId: string;
  empCode: string;
  fullName: string;
  /** Calendar year of the June month */
  year: number;
  /** YYYY-MM e.g. 2026-06 */
  month: string;
  amount: number;
  /** Completed ≥1 year by that June → drawable later */
  eligibleForDraw: boolean;
  status: JuneHoldStatus;
  payrollRunId: string;
  heldAt: string;
  releasedAt: string;
  releasedBy: string;
  releaseNote: string;
};

export type ExitSettlementStatus =
  | "draft"
  | "pending_super_admin"
  | "approved"
  | "paid";

export type ExitSettlement = {
  id: string;
  staffId: string;
  empCode: string;
  fullName: string;
  /** Date resignation was intimated */
  noticeDate: string;
  /** Planned / actual leaving date */
  leavingDate: string;
  /** Months between notice and leaving ≥ policy min */
  noticeOk: boolean;
  noticeMonths: number;
  runningMonth: string;
  runningMonthAmount: number;
  juneHoldIds: string[];
  juneHoldReleaseAmount: number;
  juneHoldPendingIds: string[];
  totalPayable: number;
  status: ExitSettlementStatus;
  createdBy: string;
  createdAt: string;
  approvedBy: string;
  approvedAt: string;
  note: string;
};

export type SalaryHoldSettings = {
  enabled: boolean;
  /** 1–12, default 6 = June */
  holdMonth: number;
  teachingOnly: boolean;
  /** Min completed years by hold month to draw June later */
  minServiceYearsForJuneDraw: number;
  /** Min months notice before leaving for auto release */
  resignationNoticeMonthsMin: number;
};

export type SalaryHoldState = {
  version: 1;
  settings: SalaryHoldSettings;
  holds: JuneSalaryHold[];
  settlements: ExitSettlement[];
};

const STORAGE_KEY = "bhb_salary_hold_v1";

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultSalaryHoldSettings(): SalaryHoldSettings {
  return {
    enabled: true,
    holdMonth: 6,
    teachingOnly: true,
    minServiceYearsForJuneDraw: 1,
    resignationNoticeMonthsMin: 2,
  };
}

export function normalizeSalaryHoldSettings(
  s?: Partial<SalaryHoldSettings> | null,
): SalaryHoldSettings {
  const d = defaultSalaryHoldSettings();
  const holdMonth = Number(s?.holdMonth);
  const years = Number(s?.minServiceYearsForJuneDraw);
  const notice = Number(s?.resignationNoticeMonthsMin);
  return {
    enabled: s?.enabled !== false,
    holdMonth:
      Number.isFinite(holdMonth) && holdMonth >= 1 && holdMonth <= 12
        ? Math.round(holdMonth)
        : d.holdMonth,
    teachingOnly: s?.teachingOnly !== false,
    minServiceYearsForJuneDraw:
      Number.isFinite(years) && years >= 0 && years <= 5
        ? Math.round(years)
        : d.minServiceYearsForJuneDraw,
    resignationNoticeMonthsMin:
      Number.isFinite(notice) && notice >= 1 && notice <= 6
        ? Math.round(notice)
        : d.resignationNoticeMonthsMin,
  };
}

export function loadSalaryHold(): SalaryHoldState {
  if (typeof window === "undefined") {
    return {
      version: 1,
      settings: defaultSalaryHoldSettings(),
      holds: [],
      settlements: [],
    };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seed: SalaryHoldState = {
        version: 1,
        settings: defaultSalaryHoldSettings(),
        holds: [],
        settlements: [],
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
      return seed;
    }
    const parsed = JSON.parse(raw) as Partial<SalaryHoldState>;
    return {
      version: 1,
      settings: normalizeSalaryHoldSettings(parsed.settings),
      holds: Array.isArray(parsed.holds) ? parsed.holds : [],
      settlements: Array.isArray(parsed.settlements) ? parsed.settlements : [],
    };
  } catch {
    return {
      version: 1,
      settings: defaultSalaryHoldSettings(),
      holds: [],
      settlements: [],
    };
  }
}

export function saveSalaryHold(state: SalaryHoldState) {
  if (!assertModulePermission("payroll", "edit", "saveSalaryHold")) return;
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function monthIsHoldMonth(
  ym: string,
  settings?: SalaryHoldSettings,
): boolean {
  const cfg = normalizeSalaryHoldSettings(
    settings ?? loadSalaryHold().settings,
  );
  if (!cfg.enabled) return false;
  const m = Number(ym.split("-")[1]);
  return m === cfg.holdMonth;
}

/** Joining on/before the same calendar day one year before hold month end. */
export function completedServiceYearsByHoldMonth(
  joiningDate: string,
  holdMonthYm: string,
): number {
  const join = joiningDate?.slice(0, 10);
  if (!join || join.length < 10) return 0;
  const [y, m] = holdMonthYm.split("-").map(Number);
  if (!y || !m) return 0;
  // Last day of hold month as the checkpoint
  const lastDay = new Date(y, m, 0).getDate();
  const checkpoint = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const j = new Date(`${join}T12:00:00`);
  const c = new Date(`${checkpoint}T12:00:00`);
  if (Number.isNaN(j.getTime()) || Number.isNaN(c.getTime()) || j > c) {
    return 0;
  }
  let years = c.getFullYear() - j.getFullYear();
  const anniv = new Date(j);
  anniv.setFullYear(j.getFullYear() + years);
  if (anniv > c) years -= 1;
  return Math.max(0, years);
}

export function isEligibleForJuneDraw(
  staff: StaffRecord,
  holdMonthYm: string,
  settings?: SalaryHoldSettings,
): boolean {
  const cfg = normalizeSalaryHoldSettings(
    settings ?? loadSalaryHold().settings,
  );
  const years = completedServiceYearsByHoldMonth(
    staff.joiningDate,
    holdMonthYm,
  );
  return years >= cfg.minServiceYearsForJuneDraw;
}

/** Should this month's net for this staff be held (not paid out now)? */
export function shouldHoldJuneSalary(
  staff: StaffRecord,
  monthYm: string,
  settings?: SalaryHoldSettings,
): boolean {
  const cfg = normalizeSalaryHoldSettings(
    settings ?? loadSalaryHold().settings,
  );
  if (!cfg.enabled) return false;
  if (!monthIsHoldMonth(monthYm, cfg)) return false;
  if (cfg.teachingOnly && staff.stream !== "teaching") return false;
  return true;
}

export function monthsBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso.slice(0, 10)}T12:00:00`);
  const b = new Date(`${toIso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) {
    return 0;
  }
  const months =
    (b.getFullYear() - a.getFullYear()) * 12 +
    (b.getMonth() - a.getMonth()) +
    (b.getDate() >= a.getDate() ? 0 : -1);
  return Math.max(0, months);
}

export function noticePeriodOk(
  noticeDate: string,
  leavingDate: string,
  settings?: SalaryHoldSettings,
): { ok: boolean; months: number } {
  const cfg = normalizeSalaryHoldSettings(
    settings ?? loadSalaryHold().settings,
  );
  const months = monthsBetween(noticeDate, leavingDate);
  return {
    ok: months >= cfg.resignationNoticeMonthsMin,
    months,
  };
}

/** Upsert hold rows when a June payroll run is approved/paid. */
export function syncHoldsFromPayrollRun(input: {
  runId: string;
  month: string;
  lines: {
    staffId: string;
    empCode: string;
    fullName: string;
    stream: string;
    netPay: number;
    juneHold?: boolean;
    eligibleForJuneDraw?: boolean;
  }[];
}): SalaryHoldState {
  const state = loadSalaryHold();
  const cfg = state.settings;
  if (!monthIsHoldMonth(input.month, cfg)) return state;

  const year = Number(input.month.split("-")[0]);
  const holds = [...state.holds];

  for (const line of input.lines) {
    if (!line.juneHold || line.netPay <= 0) continue;
    const existingIdx = holds.findIndex(
      (h) =>
        h.staffId === line.staffId &&
        h.month === input.month &&
        (h.status === "held" ||
          h.status === "forfeited_incomplete_year" ||
          h.status === "pending_super_admin"),
    );
    const eligible = line.eligibleForJuneDraw !== false;
    const row: JuneSalaryHold = {
      id: existingIdx >= 0 ? holds[existingIdx]!.id : nid("jh"),
      staffId: line.staffId,
      empCode: line.empCode,
      fullName: line.fullName,
      year,
      month: input.month,
      amount: line.netPay,
      eligibleForDraw: eligible,
      status: eligible ? "held" : "forfeited_incomplete_year",
      payrollRunId: input.runId,
      heldAt:
        existingIdx >= 0
          ? holds[existingIdx]!.heldAt
          : new Date().toISOString(),
      releasedAt: "",
      releasedBy: "",
      releaseNote: eligible
        ? "June teaching salary held till exit / approved release"
        : "One year not completed till this June — not drawable",
    };
    if (existingIdx >= 0) holds[existingIdx] = row;
    else holds.push(row);
  }

  const next = { ...state, holds };
  saveSalaryHold(next);
  return next;
}

export function openExitSettlement(input: {
  staff: StaffRecord;
  noticeDate: string;
  leavingDate: string;
  runningMonth: string;
  runningMonthAmount: number;
  createdBy: string;
}): { ok: true; settlement: ExitSettlement } | { ok: false; error: string } {
  if (!input.noticeDate || !input.leavingDate) {
    return { ok: false, error: "Notice date and leaving date are required" };
  }
  if (input.leavingDate < input.noticeDate) {
    return { ok: false, error: "Leaving date must be on/after notice date" };
  }

  const state = loadSalaryHold();
  const notice = noticePeriodOk(
    input.noticeDate,
    input.leavingDate,
    state.settings,
  );

  const openHolds = state.holds.filter(
    (h) =>
      h.staffId === input.staff.id &&
      (h.status === "held" || h.status === "pending_super_admin"),
  );

  const drawable = openHolds.filter((h) => h.eligibleForDraw);
  const notDrawable = openHolds.filter((h) => !h.eligibleForDraw);

  let juneRelease = 0;
  let juneHoldIds: string[] = [];
  let juneHoldPendingIds: string[] = [];
  let status: ExitSettlementStatus = "draft";

  if (notice.ok) {
    // Proper notice → release drawable holds + running month
    juneRelease = drawable.reduce((s, h) => s + h.amount, 0);
    juneHoldIds = drawable.map((h) => h.id);
    status = "approved";
  } else {
    // Short notice → running month ok after super admin; held June needs approval
    juneRelease = 0;
    juneHoldPendingIds = drawable.map((h) => h.id);
    status = "pending_super_admin";
  }

  // Mark forfeited/ineligible stays as-is on ledger
  void notDrawable;

  const settlement: ExitSettlement = {
    id: nid("es"),
    staffId: input.staff.id,
    empCode: input.staff.empCode,
    fullName: input.staff.fullName,
    noticeDate: input.noticeDate.slice(0, 10),
    leavingDate: input.leavingDate.slice(0, 10),
    noticeOk: notice.ok,
    noticeMonths: notice.months,
    runningMonth: input.runningMonth,
    runningMonthAmount: Math.max(0, input.runningMonthAmount),
    juneHoldIds,
    juneHoldReleaseAmount: juneRelease,
    juneHoldPendingIds,
    totalPayable:
      Math.max(0, input.runningMonthAmount) +
      (notice.ok ? juneRelease : 0),
    status,
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
    approvedBy: notice.ok ? input.createdBy : "",
    approvedAt: notice.ok ? new Date().toISOString() : "",
    note: notice.ok
      ? `Notice ${notice.months} month(s) — auto release of drawable June hold`
      : `Notice only ${notice.months} month(s) — Super Admin must approve June hold release`,
  };

  // Update hold statuses
  const holds = state.holds.map((h) => {
    if (juneHoldIds.includes(h.id)) {
      return {
        ...h,
        status: "released_on_exit" as const,
        releasedAt: new Date().toISOString(),
        releasedBy: input.createdBy,
        releaseNote: "Released with proper resignation notice",
      };
    }
    if (juneHoldPendingIds.includes(h.id)) {
      return {
        ...h,
        status: "pending_super_admin" as const,
        releaseNote: "Awaiting Super Admin approval (short notice)",
      };
    }
    return h;
  });

  const next: SalaryHoldState = {
    ...state,
    holds,
    settlements: [settlement, ...state.settlements],
  };
  saveSalaryHold(next);
  return { ok: true, settlement };
}

export function superAdminReleaseHolds(input: {
  settlementId: string;
  by: string;
  note?: string;
}): { ok: true } | { ok: false; error: string } {
  const state = loadSalaryHold();
  const settlement = state.settlements.find((s) => s.id === input.settlementId);
  if (!settlement) return { ok: false, error: "Settlement not found" };
  if (settlement.status !== "pending_super_admin") {
    return { ok: false, error: "Settlement is not awaiting Super Admin" };
  }

  const releaseIds = settlement.juneHoldPendingIds;
  const releaseAmount = state.holds
    .filter((h) => releaseIds.includes(h.id) && h.eligibleForDraw)
    .reduce((s, h) => s + h.amount, 0);

  const holds = state.holds.map((h) =>
    releaseIds.includes(h.id) && h.eligibleForDraw
      ? {
          ...h,
          status: "released_super_admin" as const,
          releasedAt: new Date().toISOString(),
          releasedBy: input.by,
          releaseNote: input.note || "Released by Super Admin",
        }
      : h,
  );

  const settlements = state.settlements.map((s) =>
    s.id === input.settlementId
      ? {
          ...s,
          status: "approved" as const,
          juneHoldIds: [...s.juneHoldIds, ...releaseIds],
          juneHoldPendingIds: [],
          juneHoldReleaseAmount: s.juneHoldReleaseAmount + releaseAmount,
          totalPayable: s.runningMonthAmount + s.juneHoldReleaseAmount + releaseAmount,
          approvedBy: input.by,
          approvedAt: new Date().toISOString(),
          note: input.note || s.note,
        }
      : s,
  );

  saveSalaryHold({ ...state, holds, settlements });
  return { ok: true };
}

export function markSettlementPaid(
  settlementId: string,
  by: string,
): { ok: true } | { ok: false; error: string } {
  const state = loadSalaryHold();
  const settlement = state.settlements.find((s) => s.id === settlementId);
  if (!settlement) return { ok: false, error: "Settlement not found" };
  if (settlement.status !== "approved") {
    return { ok: false, error: "Approve settlement before marking paid" };
  }
  saveSalaryHold({
    ...state,
    settlements: state.settlements.map((s) =>
      s.id === settlementId
        ? {
            ...s,
            status: "paid",
            note: `${s.note} · Paid by ${by}`,
          }
        : s,
    ),
  });
  return { ok: true };
}

export function holdStatusLabel(s: JuneHoldStatus): string {
  switch (s) {
    case "held":
      return "Held";
    case "forfeited_incomplete_year":
      return "Not drawable (< 1 year)";
    case "pending_super_admin":
      return "Pending Super Admin";
    case "released_on_exit":
      return "Released (notice)";
    case "released_super_admin":
      return "Released (Super Admin)";
    default:
      return s;
  }
}


export function canApproveSalaryHoldAsSuperAdmin(session: {
  roleCode: string;
  fullName: string;
  email?: string;
}): boolean {
  if (isSuperAdminSession(session)) return true;
  const rc = (session.roleCode || "").toLowerCase();
  return /owner|super.?admin|principal|admin|hm|head.?master/.test(rc);
}

/** Optional merge of hold settings onto pay-cycle settings display. */
export function describeHoldPolicy(
  settings: SalaryHoldSettings,
  _pay?: SalarySettings,
): string {
  const cfg = normalizeSalaryHoldSettings(settings);
  if (!cfg.enabled) return "June hold disabled";
  const monthName = new Date(2000, cfg.holdMonth - 1, 1).toLocaleString(
    "en-IN",
    { month: "long" },
  );
  return `${monthName} hold for teaching · ≥${cfg.minServiceYearsForJuneDraw}y for draw · ≥${cfg.resignationNoticeMonthsMin} months notice for auto-release`;
}

export { loadSalarySetup, normalizeSalarySettings };
