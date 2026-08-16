/**
 * Staff leave & appraisal — localStorage HR slice (separate from Masters roster).
 */

import {
  assertModulePermission,
  assertSelfOrModulePermission,
} from "@/lib/rbacGuard";
import { DEFAULT_AY } from "@/lib/masters";
import type { StaffRecord } from "@/lib/foundationMasters";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";

export type LeaveTypeCode = string;

export type LeaveType = {
  code: LeaveTypeCode;
  name: string;
  paid: boolean;
  defaultDaysPerYear: number;
  /**
   * Adjustment rules (0 = no limit).
   * Example: CL maxDaysPerMonth = 1 → only 1 day CL in any calendar month.
   */
  maxDaysPerMonth: number;
  /** Max days in one application (0 = no limit). */
  maxDaysPerRequest: number;
  /** Max unused days that may roll into the next AY (0 = no carry). */
  maxCarryForward: number;
};

export type LeaveStatus = "pending" | "pending_l2" | "approved" | "rejected";

export type LeaveSettings = {
  /** When true, new leave requests are approved immediately (skips queues). */
  autoApproveLeaves: boolean;
  /** When true (and auto-approve off), approval needs level-1 then level-2. */
  twoLevelApproval: boolean;
  /**
   * Rule 3 — minutes after school start still counted present;
   * beyond this duration is considered late. Also softens leave
   * half-day time cutoffs. 0 = any minute after start is late.
   */
  gracePeriodMinutes: number;
};

export type LeaveRequest = {
  id: string;
  academicYearCode: string;
  staffId: string;
  typeCode: LeaveTypeCode;
  fromDate: string;
  toDate: string;
  days: number;
  halfDay: boolean;
  reason: string;
  status: LeaveStatus;
  /** How the leave was created / last changed */
  origin: "request" | "direct" | "adjusted";
  appliedBy: string;
  appliedAt: string;
  /** Final decision actor (approve/reject) */
  decidedBy: string;
  decidedAt: string;
  decisionNote: string;
  /** Level-1 approver when 2-level is on */
  level1By: string;
  level1At: string;
};

export type LeaveBalance = {
  id: string;
  academicYearCode: string;
  staffId: string;
  typeCode: LeaveTypeCode;
  allotted: number;
  /** Unused days rolled from previous AY (capped by type.maxCarryForward). */
  carriedForward: number;
  /** Days cashed out this AY (encashment stub). */
  encashed: number;
  used: number;
};

export type LeaveEncashment = {
  id: string;
  academicYearCode: string;
  staffId: string;
  typeCode: LeaveTypeCode;
  days: number;
  note: string;
  recordedBy: string;
  recordedAt: string;
};

export type AppraisalCriterionKey =
  | "teaching"
  | "duty"
  | "punctuality"
  | "conduct"
  | "overall";

export type AppraisalScores = Record<AppraisalCriterionKey, number>;

export type AppraisalCycle = {
  id: string;
  academicYearCode: string;
  label: string;
  status: "open" | "closed";
  createdAt: string;
};

export type AppraisalRecord = {
  id: string;
  cycleId: string;
  staffId: string;
  scores: AppraisalScores;
  comment: string;
  ratedBy: string;
  ratedAt: string;
};

export type StaffRequestType =
  | "supplies"
  | "maintenance"
  | "vehicle"
  | "classroom_issue"
  | "other";

export type StaffRequestStatus = "open" | "in_progress" | "resolved" | "closed";

export const STAFF_REQUEST_TYPE_LABELS: Record<StaffRequestType, string> = {
  supplies: "Stationery / supplies",
  maintenance: "Repair / maintenance",
  vehicle: "Vehicle / driver issue",
  classroom_issue: "Classroom issue",
  other: "Other",
};

export type StaffRequestTicket = {
  id: string;
  staffId: string;
  raisedByName: string;
  type: StaffRequestType;
  subject: string;
  description: string;
  date: string;
  assignedToStaffId: string;
  status: StaffRequestStatus;
  resolutionNote: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StaffHrState = {
  version: 1;
  leaveSettings: LeaveSettings;
  leaveTypes: LeaveType[];
  leaveRequests: LeaveRequest[];
  leaveBalances: LeaveBalance[];
  leaveEncashments: LeaveEncashment[];
  appraisalCycles: AppraisalCycle[];
  appraisals: AppraisalRecord[];
  staffRequests: StaffRequestTicket[];
};

const STORAGE_KEY = "bhb_staff_hr_v1";

export const DEFAULT_LEAVE_TYPES: LeaveType[] = [
  {
    code: "CL",
    name: "Casual leave",
    paid: true,
    defaultDaysPerYear: 12,
    maxDaysPerMonth: 1,
    maxDaysPerRequest: 1,
    maxCarryForward: 0,
  },
  {
    code: "EL",
    name: "Earned leave",
    paid: true,
    defaultDaysPerYear: 15,
    maxDaysPerMonth: 0,
    maxDaysPerRequest: 0,
    maxCarryForward: 15,
  },
  {
    code: "SL",
    name: "Sick leave",
    paid: true,
    defaultDaysPerYear: 10,
    maxDaysPerMonth: 0,
    maxDaysPerRequest: 0,
    maxCarryForward: 0,
  },
  {
    code: "LWP",
    name: "Leave without pay",
    paid: false,
    defaultDaysPerYear: 0,
    maxDaysPerMonth: 0,
    maxDaysPerRequest: 0,
    maxCarryForward: 0,
  },
];

export const APPRAISAL_CRITERIA: {
  key: AppraisalCriterionKey;
  label: string;
}[] = [
  { key: "teaching", label: "Teaching" },
  { key: "duty", label: "Duty" },
  { key: "punctuality", label: "Punctuality" },
  { key: "conduct", label: "Conduct" },
  { key: "overall", label: "Overall" },
];

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function emptyScores(): AppraisalScores {
  return {
    teaching: 3,
    duty: 3,
    punctuality: 3,
    conduct: 3,
    overall: 3,
  };
}

function normalizeLeaveType(t: Partial<LeaveType>): LeaveType | null {
  const code = (t.code || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  if (!code || code.length > 12) return null;
  const seeded = DEFAULT_LEAVE_TYPES.find((x) => x.code === code);
  const days =
    typeof t.defaultDaysPerYear === "number" && Number.isFinite(t.defaultDaysPerYear)
      ? Math.max(0, Math.round(t.defaultDaysPerYear * 2) / 2)
      : (seeded?.defaultDaysPerYear ?? 0);
  const maxDaysPerMonth =
    typeof t.maxDaysPerMonth === "number" && Number.isFinite(t.maxDaysPerMonth)
      ? Math.max(0, Math.round(t.maxDaysPerMonth * 2) / 2)
      : (seeded?.maxDaysPerMonth ?? 0);
  const maxDaysPerRequest =
    typeof t.maxDaysPerRequest === "number" &&
    Number.isFinite(t.maxDaysPerRequest)
      ? Math.max(0, Math.round(t.maxDaysPerRequest * 2) / 2)
      : (seeded?.maxDaysPerRequest ?? 0);
  const maxCarryForward =
    typeof t.maxCarryForward === "number" && Number.isFinite(t.maxCarryForward)
      ? Math.max(0, Math.round(t.maxCarryForward * 2) / 2)
      : (seeded?.maxCarryForward ?? 0);
  return {
    code,
    name: (t.name || "").trim() || seeded?.name || code,
    paid: typeof t.paid === "boolean" ? t.paid : (seeded?.paid ?? true),
    defaultDaysPerYear: days,
    maxDaysPerMonth,
    maxDaysPerRequest,
    maxCarryForward,
  };
}

function normalizeLeaveRequest(
  r: Partial<LeaveRequest>,
): LeaveRequest | null {
  if (!r.staffId || !r.typeCode) return null;
  const typeCode = (r.typeCode || "").trim().toUpperCase();
  if (!typeCode) return null;
  const status: LeaveStatus =
    r.status === "approved" ||
    r.status === "rejected" ||
    r.status === "pending_l2"
      ? r.status
      : "pending";
  const days =
    typeof r.days === "number" && r.days > 0
      ? Math.round(r.days * 2) / 2
      : 1;
  return {
    id: r.id || nid("lv"),
    academicYearCode: r.academicYearCode || DEFAULT_AY,
    staffId: r.staffId,
    typeCode,
    fromDate: r.fromDate || "",
    toDate: r.toDate || r.fromDate || "",
    days,
    halfDay: !!r.halfDay,
    reason: r.reason || "",
    status,
    origin:
      r.origin === "direct" || r.origin === "adjusted" ? r.origin : "request",
    appliedBy: r.appliedBy || "",
    appliedAt: r.appliedAt || "",
    decidedBy: r.decidedBy || "",
    decidedAt: r.decidedAt || "",
    decisionNote: r.decisionNote || "",
    level1By: r.level1By || "",
    level1At: r.level1At || "",
  };
}

function normalizeBalance(b: Partial<LeaveBalance>): LeaveBalance | null {
  if (!b.staffId || !b.typeCode) return null;
  const typeCode = (b.typeCode || "").trim().toUpperCase();
  if (!typeCode) return null;
  return {
    id: b.id || nid("lb"),
    academicYearCode: b.academicYearCode || DEFAULT_AY,
    staffId: b.staffId,
    typeCode,
    allotted: typeof b.allotted === "number" ? b.allotted : 0,
    carriedForward:
      typeof b.carriedForward === "number" ? Math.max(0, b.carriedForward) : 0,
    encashed: typeof b.encashed === "number" ? Math.max(0, b.encashed) : 0,
    used: typeof b.used === "number" ? b.used : 0,
  };
}

function normalizeEncashment(
  e: Partial<LeaveEncashment>,
): LeaveEncashment | null {
  if (!e.staffId || !e.typeCode) return null;
  const days =
    typeof e.days === "number" && e.days > 0
      ? Math.round(e.days * 2) / 2
      : 0;
  if (days <= 0) return null;
  return {
    id: e.id || nid("enc"),
    academicYearCode: e.academicYearCode || DEFAULT_AY,
    staffId: e.staffId,
    typeCode: (e.typeCode || "").trim().toUpperCase(),
    days,
    note: e.note || "",
    recordedBy: e.recordedBy || "",
    recordedAt: e.recordedAt || new Date().toISOString(),
  };
}

const STAFF_REQUEST_TYPES: StaffRequestType[] = [
  "supplies",
  "maintenance",
  "vehicle",
  "classroom_issue",
  "other",
];
const STAFF_REQUEST_STATUSES: StaffRequestStatus[] = [
  "open",
  "in_progress",
  "resolved",
  "closed",
];

function normalizeStaffRequestTicket(
  t: Partial<StaffRequestTicket>,
): StaffRequestTicket | null {
  if (!t.staffId || !t.subject) return null;
  const type = STAFF_REQUEST_TYPES.includes(t.type as StaffRequestType)
    ? (t.type as StaffRequestType)
    : "other";
  const status = STAFF_REQUEST_STATUSES.includes(t.status as StaffRequestStatus)
    ? (t.status as StaffRequestStatus)
    : "open";
  const now = new Date().toISOString();
  return {
    id: t.id || nid("req"),
    staffId: t.staffId,
    raisedByName: (t.raisedByName || "").trim(),
    type,
    subject: (t.subject || "").trim(),
    description: (t.description || "").trim(),
    date: t.date || now.slice(0, 10),
    assignedToStaffId: t.assignedToStaffId || "",
    status,
    resolutionNote: (t.resolutionNote || "").trim(),
    resolvedAt: t.resolvedAt || null,
    createdAt: t.createdAt || now,
    updatedAt: t.updatedAt || now,
  };
}

function normalizeScores(raw: unknown): AppraisalScores {
  const base = emptyScores();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  for (const { key } of APPRAISAL_CRITERIA) {
    const n = Number(o[key]);
    if (Number.isFinite(n)) {
      base[key] = Math.min(5, Math.max(1, Math.round(n)));
    }
  }
  return base;
}

function normalizeCycle(c: Partial<AppraisalCycle>): AppraisalCycle | null {
  if (!c.academicYearCode && !c.label) return null;
  return {
    id: c.id || nid("apc"),
    academicYearCode: c.academicYearCode || DEFAULT_AY,
    label: c.label || `AY ${c.academicYearCode || DEFAULT_AY} Review`,
    status: c.status === "closed" ? "closed" : "open",
    createdAt: c.createdAt || new Date().toISOString(),
  };
}

function normalizeAppraisal(
  a: Partial<AppraisalRecord>,
): AppraisalRecord | null {
  if (!a.cycleId || !a.staffId) return null;
  return {
    id: a.id || nid("apr"),
    cycleId: a.cycleId,
    staffId: a.staffId,
    scores: normalizeScores(a.scores),
    comment: a.comment || "",
    ratedBy: a.ratedBy || "",
    ratedAt: a.ratedAt || "",
  };
}

export function defaultLeaveSettings(): LeaveSettings {
  return {
    autoApproveLeaves: false,
    twoLevelApproval: false,
    gracePeriodMinutes: 15,
  };
}

export function normalizeLeaveSettings(
  s?: Partial<LeaveSettings> | null,
): LeaveSettings {
  const raw =
    typeof s?.gracePeriodMinutes === "number"
      ? s.gracePeriodMinutes
      : 15;
  return {
    autoApproveLeaves: !!s?.autoApproveLeaves,
    twoLevelApproval: !!s?.twoLevelApproval,
    gracePeriodMinutes: Math.max(0, Math.min(240, Math.round(raw))),
  };
}

/** Campus grace period in minutes (attendance + leave time cutoffs). */
export function getGracePeriodMinutes(): number {
  return normalizeLeaveSettings(loadStaffHr().leaveSettings).gracePeriodMinutes;
}

export function emptyStaffHrState(): StaffHrState {
  return {
    version: 1,
    leaveSettings: defaultLeaveSettings(),
    leaveTypes: DEFAULT_LEAVE_TYPES.map((t) => ({ ...t })),
    leaveRequests: [],
    leaveBalances: [],
    leaveEncashments: [],
    appraisalCycles: [],
    appraisals: [],
    staffRequests: [],
  };
}

function normalizeState(raw: Partial<StaffHrState>): StaffHrState {
  const types = Array.isArray(raw.leaveTypes)
    ? raw.leaveTypes
        .map(normalizeLeaveType)
        .filter((t): t is LeaveType => !!t)
    : [];
  const leaveTypes =
    types.length > 0
      ? types
      : DEFAULT_LEAVE_TYPES.map((t) => ({ ...t }));

  return {
    version: 1,
    leaveSettings: normalizeLeaveSettings(raw.leaveSettings),
    leaveTypes,
    leaveRequests: Array.isArray(raw.leaveRequests)
      ? raw.leaveRequests
          .map(normalizeLeaveRequest)
          .filter((r): r is LeaveRequest => !!r)
      : [],
    leaveBalances: Array.isArray(raw.leaveBalances)
      ? raw.leaveBalances
          .map(normalizeBalance)
          .filter((b): b is LeaveBalance => !!b)
      : [],
    leaveEncashments: Array.isArray(raw.leaveEncashments)
      ? raw.leaveEncashments
          .map(normalizeEncashment)
          .filter((e): e is LeaveEncashment => !!e)
      : [],
    appraisalCycles: Array.isArray(raw.appraisalCycles)
      ? raw.appraisalCycles
          .map(normalizeCycle)
          .filter((c): c is AppraisalCycle => !!c)
      : [],
    appraisals: Array.isArray(raw.appraisals)
      ? raw.appraisals
          .map(normalizeAppraisal)
          .filter((a): a is AppraisalRecord => !!a)
      : [],
    staffRequests: Array.isArray(raw.staffRequests)
      ? raw.staffRequests
          .map(normalizeStaffRequestTicket)
          .filter((t): t is StaffRequestTicket => !!t)
      : [],
  };
}

export function loadStaffHr(): StaffHrState {
  if (typeof window === "undefined") return emptyStaffHrState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStaffHrState();
    const parsed = JSON.parse(raw) as StaffHrState;
    if (!parsed || parsed.version !== 1) return emptyStaffHrState();
    return normalizeState(parsed);
  } catch {
    return emptyStaffHrState();
  }
}

function persistStaffHr(state: StaffHrState) {
  if (typeof window === "undefined") return;
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(normalizeState(state)));
  void import("@/lib/staffHrPersistence").then(({ scheduleStaffHrSync }) => {
    scheduleStaffHrSync(state);
  });
}

export function saveStaffHr(state: StaffHrState) {
  if (!assertModulePermission("staff", "edit", "saveStaffHr")) return;
  persistStaffHr(state);
}

export function writeStaffHrLocalRaw(state: StaffHrState) {
  if (typeof window === "undefined") return;
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(normalizeState(state)));
}

export function staffHrStateIsEmpty(state: StaffHrState): boolean {
  return (
    (state.leaveRequests?.length ?? 0) === 0 &&
    (state.appraisals?.length ?? 0) === 0 &&
    (state.leaveEncashments?.length ?? 0) === 0
  );
}

/** Inclusive calendar days between ISO dates (YYYY-MM-DD). */
export function calendarDaysBetween(fromDate: string, toDate: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    return 0;
  }
  const a = new Date(`${fromDate}T00:00:00`);
  const b = new Date(`${toDate}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 0;
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / 86_400_000) + 1;
}

export function computeLeaveDays(
  fromDate: string,
  toDate: string,
  halfDay: boolean,
): number {
  if (halfDay) return 0.5;
  return calendarDaysBetween(fromDate, toDate) || 1;
}

function recomputeUsed(
  state: StaffHrState,
  staffId: string,
  typeCode: LeaveTypeCode,
  academicYearCode: string,
): number {
  return state.leaveRequests
    .filter(
      (r) =>
        r.staffId === staffId &&
        r.typeCode === typeCode &&
        r.academicYearCode === academicYearCode &&
        r.status === "approved",
    )
    .reduce((sum, r) => sum + r.days, 0);
}

function syncBalanceUsed(state: StaffHrState, balanceId: string): StaffHrState {
  const bal = state.leaveBalances.find((b) => b.id === balanceId);
  if (!bal) return state;
  const used = recomputeUsed(
    state,
    bal.staffId,
    bal.typeCode,
    bal.academicYearCode,
  );
  return {
    ...state,
    leaveBalances: state.leaveBalances.map((b) =>
      b.id === balanceId ? { ...b, used } : b,
    ),
  };
}

/** Ensure balance rows exist for active staff + leave types for an AY. */
export function ensureBalancesForAy(
  state: StaffHrState,
  staff: StaffRecord[],
  academicYearCode: string,
): StaffHrState {
  const active = staff.filter((s) => s.status === "active");
  let balances = [...state.leaveBalances];
  let changed = false;

  for (const s of active) {
    for (const t of state.leaveTypes) {
      const existing = balances.find(
        (b) =>
          b.staffId === s.id &&
          b.typeCode === t.code &&
          b.academicYearCode === academicYearCode,
      );
      if (existing) continue;
      balances.push({
        id: nid("lb"),
        academicYearCode,
        staffId: s.id,
        typeCode: t.code,
        allotted: t.defaultDaysPerYear,
        carriedForward: 0,
        encashed: 0,
        used: recomputeUsed(state, s.id, t.code, academicYearCode),
      });
      changed = true;
    }
  }

  if (!changed) {
    // Refresh used counters from approved requests
    balances = balances.map((b) =>
      b.academicYearCode === academicYearCode
        ? {
            ...b,
            used: recomputeUsed(state, b.staffId, b.typeCode, b.academicYearCode),
          }
        : b,
    );
  }

  return { ...state, leaveBalances: balances };
}

export function remainingBalance(b: LeaveBalance): number {
  const raw = b.allotted + b.carriedForward - b.used - b.encashed;
  return Math.max(0, Math.round(raw * 2) / 2);
}

/** Split leave days across calendar months (YYYY-MM → days). */
export function leaveDaysByMonth(
  fromDate: string,
  toDate: string,
  halfDay: boolean,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (halfDay) {
    const key = fromDate.slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(key)) out[key] = 0.5;
    return out;
  }
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(fromDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(toDate)
  ) {
    return out;
  }
  const start = new Date(`${fromDate}T00:00:00`);
  const end = new Date(`${toDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return out;
  }
  const cur = new Date(start);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const key = `${y}-${m}`;
    out[key] = (out[key] ?? 0) + 1;
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  const names = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const mi = Number(m) - 1;
  return `${names[mi] ?? m} ${y}`;
}

/**
 * Enforce leave adjustment rules (monthly cap, max per request).
 * Counts pending + approved requests for the same staff/type.
 */
export function validateLeaveAdjustmentRules(
  state: StaffHrState,
  input: {
    staffId: string;
    typeCode: LeaveTypeCode;
    fromDate: string;
    toDate: string;
    days: number;
    halfDay: boolean;
    excludeRequestId?: string;
  },
): string | null {
  const type = state.leaveTypes.find((t) => t.code === input.typeCode);
  if (!type) return "Unknown leave type";

  if (type.maxDaysPerRequest > 0 && input.days > type.maxDaysPerRequest + 0.001) {
    return `${type.code} allows max ${type.maxDaysPerRequest} day(s) per application`;
  }

  if (type.maxDaysPerMonth <= 0) return null;

  const proposed = leaveDaysByMonth(
    input.fromDate,
    input.toDate,
    input.halfDay,
  );
  const existing = state.leaveRequests.filter(
    (r) =>
      r.staffId === input.staffId &&
      r.typeCode === input.typeCode &&
      (r.status === "pending" ||
        r.status === "pending_l2" ||
        r.status === "approved") &&
      r.id !== input.excludeRequestId,
  );

  const usedByMonth: Record<string, number> = {};
  for (const r of existing) {
    const parts = leaveDaysByMonth(r.fromDate, r.toDate, r.halfDay);
    for (const [ym, d] of Object.entries(parts)) {
      usedByMonth[ym] = (usedByMonth[ym] ?? 0) + d;
    }
  }

  for (const [ym, add] of Object.entries(proposed)) {
    const total = (usedByMonth[ym] ?? 0) + add;
    if (total > type.maxDaysPerMonth + 0.001) {
      const used = usedByMonth[ym] ?? 0;
      return `${type.code} limited to ${type.maxDaysPerMonth} day(s) in ${monthLabel(ym)} (already ${used})`;
    }
  }
  return null;
}

export function describeLeaveRules(t: LeaveType): string {
  const bits: string[] = [];
  if (t.maxDaysPerMonth > 0) {
    bits.push(`max ${t.maxDaysPerMonth}/month`);
  }
  if (t.maxDaysPerRequest > 0) {
    bits.push(`max ${t.maxDaysPerRequest}/application`);
  }
  if (t.maxCarryForward > 0) {
    bits.push(`carry up to ${t.maxCarryForward}`);
  }
  return bits.length > 0 ? bits.join(" · ") : "no monthly/application cap";
}

export function applyLeave(input: {
  academicYearCode: string;
  staffId: string;
  typeCode: LeaveTypeCode;
  fromDate: string;
  toDate: string;
  halfDay?: boolean;
  reason: string;
  appliedBy: string;
  /** When true, approve immediately (principal/admin direct leave). */
  direct?: boolean;
}): { ok: true; state: StaffHrState; request: LeaveRequest } | { ok: false; error: string } {
  if (!input.staffId) return { ok: false, error: "Select a staff member" };
  if (!input.fromDate) return { ok: false, error: "From date is required" };
  const halfDay = !!input.halfDay;
  const toDate = halfDay ? input.fromDate : input.toDate || input.fromDate;
  if (!halfDay && toDate < input.fromDate) {
    return { ok: false, error: "To date must be on or after from date" };
  }
  const days = computeLeaveDays(input.fromDate, toDate, halfDay);
  if (days <= 0) return { ok: false, error: "Invalid leave duration" };

  let state = loadStaffHr();
  const type = state.leaveTypes.find((t) => t.code === input.typeCode);
  if (!type) return { ok: false, error: "Unknown leave type" };

  state = ensureBalancesForAy(
    state,
    [{ id: input.staffId, status: "active" } as StaffRecord],
    input.academicYearCode,
  );

  const bal = state.leaveBalances.find(
    (b) =>
      b.staffId === input.staffId &&
      b.typeCode === input.typeCode &&
      b.academicYearCode === input.academicYearCode,
  );
  if (bal && type.defaultDaysPerYear > 0) {
    const rem = remainingBalance(bal);
    if (days > rem + 0.001) {
      return {
        ok: false,
        error: `Insufficient ${type.code} balance (remaining ${rem})`,
      };
    }
  }

  const ruleErr = validateLeaveAdjustmentRules(state, {
    staffId: input.staffId,
    typeCode: input.typeCode,
    fromDate: input.fromDate,
    toDate,
    days,
    halfDay,
  });
  if (ruleErr) return { ok: false, error: ruleErr };

  const settings = normalizeLeaveSettings(state.leaveSettings);
  const now = new Date().toISOString();
  const direct = !!input.direct;

  let status: LeaveStatus = "pending";
  let decidedBy = "";
  let decidedAt = "";
  let decisionNote = "";
  let origin: LeaveRequest["origin"] = "request";
  if (direct) {
    status = "approved";
    decidedBy = input.appliedBy;
    decidedAt = now;
    decisionNote = "Direct leave";
    origin = "direct";
  } else if (settings.autoApproveLeaves) {
    status = "approved";
    decidedBy = input.appliedBy;
    decidedAt = now;
    decisionNote = "Auto-approved";
  }

  const request: LeaveRequest = {
    id: nid("lv"),
    academicYearCode: input.academicYearCode,
    staffId: input.staffId,
    typeCode: input.typeCode,
    fromDate: input.fromDate,
    toDate,
    days,
    halfDay,
    reason: input.reason.trim(),
    status,
    origin,
    appliedBy: input.appliedBy,
    appliedAt: now,
    decidedBy,
    decidedAt,
    decisionNote,
    level1By: "",
    level1At: "",
  };

  state = {
    ...state,
    leaveRequests: [request, ...state.leaveRequests],
  };

  if (status === "approved") {
    const balAfter = state.leaveBalances.find(
      (b) =>
        b.staffId === request.staffId &&
        b.typeCode === request.typeCode &&
        b.academicYearCode === request.academicYearCode,
    );
    if (balAfter) state = syncBalanceUsed(state, balAfter.id);
  }

  if (
    !assertSelfOrModulePermission("staff", "edit", input.staffId, "applyLeave")
  ) {
    return { ok: false, error: "You don't have permission to do this" };
  }
  persistStaffHr(state);
  return { ok: true, state, request };
}

export function directLeave(
  input: Omit<Parameters<typeof applyLeave>[0], "direct">,
): ReturnType<typeof applyLeave> {
  return applyLeave({ ...input, direct: true });
}

/**
 * Any staff member files a real, tracked operational request against
 * their own staffId — stationery/supplies, a repair/maintenance need, a
 * vehicle/driver issue, a classroom problem, or something uncategorized.
 * Self-scoped: assertSelfOrModulePermission lets the actor create only
 * for their own staffId without needing the broader "staff:edit" grant,
 * mirroring applyLeave's self-service fix above.
 */
export function createStaffRequestTicket(input: {
  staffId: string;
  raisedByName: string;
  type: StaffRequestType;
  subject: string;
  description: string;
}): { ok: true; state: StaffHrState; ticket: StaffRequestTicket } | { ok: false; error: string } {
  if (!input.staffId) return { ok: false, error: "Could not resolve your staff record" };
  if (!input.subject.trim()) return { ok: false, error: "Subject is required" };

  if (
    !assertSelfOrModulePermission(
      "staff",
      "edit",
      input.staffId,
      "createStaffRequestTicket",
    )
  ) {
    return { ok: false, error: "You don't have permission to do this" };
  }

  const now = new Date().toISOString();
  const ticket: StaffRequestTicket = {
    id: nid("req"),
    staffId: input.staffId,
    raisedByName: input.raisedByName.trim(),
    type: input.type,
    subject: input.subject.trim(),
    description: input.description.trim(),
    date: now.slice(0, 10),
    assignedToStaffId: "",
    status: "open",
    resolutionNote: "",
    resolvedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const state = loadStaffHr();
  const next: StaffHrState = {
    ...state,
    staffRequests: [ticket, ...state.staffRequests],
  };
  persistStaffHr(next);
  return { ok: true, state: next, ticket };
}

/** Admin/office triage — assign, change status, or resolve a ticket. */
export function updateStaffRequestTicket(
  ticketId: string,
  patch: {
    assignedToStaffId?: string;
    status?: StaffRequestStatus;
    resolutionNote?: string;
  },
): { ok: true; state: StaffHrState } | { ok: false; error: string } {
  const state = loadStaffHr();
  const idx = state.staffRequests.findIndex((t) => t.id === ticketId);
  if (idx < 0) return { ok: false, error: "Request not found" };
  const now = new Date().toISOString();
  const before = state.staffRequests[idx]!;
  const status = patch.status ?? before.status;
  const ticket: StaffRequestTicket = {
    ...before,
    assignedToStaffId: patch.assignedToStaffId ?? before.assignedToStaffId,
    status,
    resolutionNote: patch.resolutionNote ?? before.resolutionNote,
    resolvedAt:
      status === "resolved" || status === "closed"
        ? before.resolvedAt || now
        : status !== before.status
          ? null
          : before.resolvedAt,
    updatedAt: now,
  };
  const staffRequests = [...state.staffRequests];
  staffRequests[idx] = ticket;
  const next: StaffHrState = { ...state, staffRequests };
  saveStaffHr(next);
  return { ok: true, state: next };
}

export function listStaffRequestsForStaff(
  state: StaffHrState,
  staffId: string,
): StaffRequestTicket[] {
  return state.staffRequests
    .filter((t) => t.staffId === staffId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function decideLeave(input: {
  requestId: string;
  decision: "approved" | "rejected";
  decidedBy: string;
  decisionNote?: string;
}): { ok: true; state: StaffHrState } | { ok: false; error: string } {
  let state = loadStaffHr();
  const settings = normalizeLeaveSettings(state.leaveSettings);
  const req = state.leaveRequests.find((r) => r.id === input.requestId);
  if (!req) return { ok: false, error: "Leave request not found" };

  const awaitingL1 = req.status === "pending";
  const awaitingL2 = req.status === "pending_l2";
  if (!awaitingL1 && !awaitingL2) {
    return { ok: false, error: "Request already decided" };
  }

  const now = new Date().toISOString();

  if (input.decision === "rejected") {
    state = {
      ...state,
      leaveRequests: state.leaveRequests.map((r) =>
        r.id === req.id
          ? {
              ...r,
              status: "rejected" as const,
              decidedBy: input.decidedBy,
              decidedAt: now,
              decisionNote: (input.decisionNote || "").trim(),
              ...(awaitingL1
                ? { level1By: input.decidedBy, level1At: now }
                : {}),
            }
          : r,
      ),
    };
    saveStaffHr(state);
    return { ok: true, state };
  }

  const type = state.leaveTypes.find((t) => t.code === req.typeCode);
  state = ensureBalancesForAy(
    state,
    [{ id: req.staffId, status: "active" } as StaffRecord],
    req.academicYearCode,
  );
  const bal = state.leaveBalances.find(
    (b) =>
      b.staffId === req.staffId &&
      b.typeCode === req.typeCode &&
      b.academicYearCode === req.academicYearCode,
  );
  if (bal && type && type.defaultDaysPerYear > 0) {
    const rem = remainingBalance(bal);
    if (req.days > rem + 0.001) {
      return {
        ok: false,
        error: `Cannot approve — insufficient balance (remaining ${rem})`,
      };
    }
  }
  const ruleErr = validateLeaveAdjustmentRules(state, {
    staffId: req.staffId,
    typeCode: req.typeCode,
    fromDate: req.fromDate,
    toDate: req.toDate,
    days: req.days,
    halfDay: req.halfDay,
    excludeRequestId: req.id,
  });
  if (ruleErr) return { ok: false, error: `Cannot approve — ${ruleErr}` };

  if (settings.twoLevelApproval && awaitingL1) {
    state = {
      ...state,
      leaveRequests: state.leaveRequests.map((r) =>
        r.id === req.id
          ? {
              ...r,
              status: "pending_l2" as const,
              level1By: input.decidedBy,
              level1At: now,
              decisionNote: (input.decisionNote || "").trim(),
            }
          : r,
      ),
    };
    saveStaffHr(state);
    return { ok: true, state };
  }

  state = {
    ...state,
    leaveRequests: state.leaveRequests.map((r) =>
      r.id === req.id
        ? {
            ...r,
            status: "approved" as const,
            decidedBy: input.decidedBy,
            decidedAt: now,
            decisionNote: (input.decisionNote || "").trim(),
            ...(awaitingL1
              ? { level1By: input.decidedBy, level1At: now }
              : {}),
          }
        : r,
    ),
  };

  const balFinal = state.leaveBalances.find(
    (b) =>
      b.staffId === req.staffId &&
      b.typeCode === req.typeCode &&
      b.academicYearCode === req.academicYearCode,
  );
  if (balFinal) state = syncBalanceUsed(state, balFinal.id);

  saveStaffHr(state);
  return { ok: true, state };
}

function syncBalancesForStaffTypes(
  state: StaffHrState,
  staffId: string,
  academicYearCode: string,
  typeCodes: LeaveTypeCode[],
): StaffHrState {
  let next = state;
  for (const code of [...new Set(typeCodes)]) {
    const bal = next.leaveBalances.find(
      (b) =>
        b.staffId === staffId &&
        b.typeCode === code &&
        b.academicYearCode === academicYearCode,
    );
    if (bal) next = syncBalanceUsed(next, bal.id);
  }
  return next;
}

/** Principal/admin: change dates, type, or half-day on an existing leave. */
export function adjustLeave(input: {
  requestId: string;
  fromDate: string;
  toDate: string;
  halfDay: boolean;
  typeCode: LeaveTypeCode;
  reason?: string;
  adjustedBy: string;
}): { ok: true; state: StaffHrState; request: LeaveRequest } | { ok: false; error: string } {
  let state = loadStaffHr();
  const req = state.leaveRequests.find((r) => r.id === input.requestId);
  if (!req) return { ok: false, error: "Leave request not found" };
  if (req.status === "rejected") {
    return { ok: false, error: "Cannot adjust a rejected leave" };
  }

  const halfDay = !!input.halfDay;
  const toDate = halfDay ? input.fromDate : input.toDate || input.fromDate;
  if (!input.fromDate) return { ok: false, error: "From date is required" };
  if (!halfDay && toDate < input.fromDate) {
    return { ok: false, error: "To date must be on or after from date" };
  }
  const days = computeLeaveDays(input.fromDate, toDate, halfDay);
  if (days <= 0) return { ok: false, error: "Invalid leave duration" };

  const type = state.leaveTypes.find((t) => t.code === input.typeCode);
  if (!type) return { ok: false, error: "Unknown leave type" };

  state = ensureBalancesForAy(
    state,
    [{ id: req.staffId, status: "active" } as StaffRecord],
    req.academicYearCode,
  );

  const wasApproved = req.status === "approved";
  // Temporarily treat as non-approved for balance check against other leaves
  const probeState: StaffHrState = {
    ...state,
    leaveRequests: state.leaveRequests.map((r) =>
      r.id === req.id ? { ...r, status: "pending" as const } : r,
    ),
  };

  const bal = probeState.leaveBalances.find(
    (b) =>
      b.staffId === req.staffId &&
      b.typeCode === input.typeCode &&
      b.academicYearCode === req.academicYearCode,
  );
  if (bal && type.defaultDaysPerYear > 0) {
    const usedOther = recomputeUsed(
      probeState,
      req.staffId,
      input.typeCode,
      req.academicYearCode,
    );
    const rem =
      bal.allotted + bal.carriedForward - bal.encashed - usedOther;
    if (days > rem + 0.001) {
      return {
        ok: false,
        error: `Insufficient ${type.code} balance (remaining ${Math.max(0, Math.round(rem * 2) / 2)})`,
      };
    }
  }

  const ruleErr = validateLeaveAdjustmentRules(probeState, {
    staffId: req.staffId,
    typeCode: input.typeCode,
    fromDate: input.fromDate,
    toDate,
    days,
    halfDay,
    excludeRequestId: req.id,
  });
  if (ruleErr) return { ok: false, error: ruleErr };

  const now = new Date().toISOString();
  const prevType = req.typeCode;
  const updated: LeaveRequest = {
    ...req,
    typeCode: input.typeCode,
    fromDate: input.fromDate,
    toDate,
    days,
    halfDay,
    reason:
      input.reason !== undefined ? input.reason.trim() : req.reason,
    origin: "adjusted",
    decisionNote: wasApproved
      ? `Adjusted by ${input.adjustedBy}`
      : req.decisionNote,
    decidedBy: wasApproved ? input.adjustedBy : req.decidedBy,
    decidedAt: wasApproved ? now : req.decidedAt,
  };

  state = {
    ...state,
    leaveRequests: state.leaveRequests.map((r) =>
      r.id === req.id ? updated : r,
    ),
  };
  state = syncBalancesForStaffTypes(state, req.staffId, req.academicYearCode, [
    prevType,
    input.typeCode,
  ]);

  saveStaffHr(state);
  return { ok: true, state, request: updated };
}

/** Principal/admin: convert leave to/from half-day on the from-date. */
export function adjustHalfDayLeave(input: {
  requestId: string;
  halfDay: boolean;
  adjustedBy: string;
}): ReturnType<typeof adjustLeave> {
  const state = loadStaffHr();
  const req = state.leaveRequests.find((r) => r.id === input.requestId);
  if (!req) return { ok: false, error: "Leave request not found" };
  return adjustLeave({
    requestId: input.requestId,
    fromDate: req.fromDate,
    toDate: input.halfDay ? req.fromDate : req.toDate || req.fromDate,
    halfDay: input.halfDay,
    typeCode: req.typeCode,
    reason: req.reason,
    adjustedBy: input.adjustedBy,
  });
}

export function saveLeaveSettings(
  patch: Partial<LeaveSettings>,
): StaffHrState {
  const state = loadStaffHr();
  const next = {
    ...state,
    leaveSettings: normalizeLeaveSettings({
      ...state.leaveSettings,
      ...patch,
    }),
  };
  saveStaffHr(next);
  return next;
}

export function ensureAppraisalCycle(
  state: StaffHrState,
  academicYearCode: string,
): { state: StaffHrState; cycle: AppraisalCycle } {
  const existing = state.appraisalCycles.find(
    (c) => c.academicYearCode === academicYearCode && c.status === "open",
  );
  if (existing) return { state, cycle: existing };

  const any = state.appraisalCycles.find(
    (c) => c.academicYearCode === academicYearCode,
  );
  if (any) return { state, cycle: any };

  const cycle: AppraisalCycle = {
    id: nid("apc"),
    academicYearCode,
    label: `AY ${academicYearCode} Review`,
    status: "open",
    createdAt: new Date().toISOString(),
  };
  const next = {
    ...state,
    appraisalCycles: [cycle, ...state.appraisalCycles],
  };
  saveStaffHr(next);
  return { state: next, cycle };
}

export function upsertAppraisal(input: {
  cycleId: string;
  staffId: string;
  scores: AppraisalScores;
  comment: string;
  ratedBy: string;
}): { ok: true; state: StaffHrState; appraisal: AppraisalRecord } | { ok: false; error: string } {
  if (!input.staffId) return { ok: false, error: "Select a staff member" };
  if (!input.cycleId) return { ok: false, error: "No appraisal cycle" };

  const state = loadStaffHr();
  const cycle = state.appraisalCycles.find((c) => c.id === input.cycleId);
  if (!cycle) return { ok: false, error: "Appraisal cycle not found" };
  if (cycle.status === "closed") {
    return { ok: false, error: "Cycle is closed" };
  }

  const scores = normalizeScores(input.scores);
  const existing = state.appraisals.find(
    (a) => a.cycleId === input.cycleId && a.staffId === input.staffId,
  );
  const appraisal: AppraisalRecord = {
    id: existing?.id ?? nid("apr"),
    cycleId: input.cycleId,
    staffId: input.staffId,
    scores,
    comment: input.comment.trim(),
    ratedBy: input.ratedBy,
    ratedAt: new Date().toISOString(),
  };

  const next: StaffHrState = {
    ...state,
    appraisals: existing
      ? state.appraisals.map((a) => (a.id === existing.id ? appraisal : a))
      : [appraisal, ...state.appraisals],
  };
  saveStaffHr(next);
  return { ok: true, state: next, appraisal };
}

export function closeAppraisalCycle(
  cycleId: string,
): { ok: true; state: StaffHrState } | { ok: false; error: string } {
  const state = loadStaffHr();
  const cycle = state.appraisalCycles.find((c) => c.id === cycleId);
  if (!cycle) return { ok: false, error: "Cycle not found" };
  if (cycle.status === "closed") return { ok: true, state };
  const next = {
    ...state,
    appraisalCycles: state.appraisalCycles.map((c) =>
      c.id === cycleId ? { ...c, status: "closed" as const } : c,
    ),
  };
  saveStaffHr(next);
  return { ok: true, state: next };
}

export function reopenAppraisalCycle(
  cycleId: string,
): { ok: true; state: StaffHrState } | { ok: false; error: string } {
  const state = loadStaffHr();
  const cycle = state.appraisalCycles.find((c) => c.id === cycleId);
  if (!cycle) return { ok: false, error: "Cycle not found" };
  const openOther = state.appraisalCycles.find(
    (c) =>
      c.academicYearCode === cycle.academicYearCode &&
      c.status === "open" &&
      c.id !== cycleId,
  );
  if (openOther) {
    return {
      ok: false,
      error: `Another open cycle exists for ${cycle.academicYearCode}`,
    };
  }
  const next = {
    ...state,
    appraisalCycles: state.appraisalCycles.map((c) =>
      c.id === cycleId ? { ...c, status: "open" as const } : c,
    ),
  };
  saveStaffHr(next);
  return { ok: true, state: next };
}

/**
 * Roll unused paid leave into the next AY (capped by type.maxCarryForward).
 * Idempotent per staff/type when to-AY already has carriedForward > 0.
 */
export function carryForwardLeaveBalances(input: {
  fromAy: string;
  toAy: string;
  staff: StaffRecord[];
  force?: boolean;
}):
  | { ok: true; state: StaffHrState; staffUpdated: number; daysCarried: number }
  | { ok: false; error: string } {
  if (!input.fromAy || !input.toAy) {
    return { ok: false, error: "From and to academic years required" };
  }
  if (input.fromAy === input.toAy) {
    return { ok: false, error: "From and to years must differ" };
  }

  let state = ensureBalancesForAy(
    loadStaffHr(),
    input.staff,
    input.fromAy,
  );
  state = ensureBalancesForAy(state, input.staff, input.toAy);

  let staffUpdated = 0;
  let daysCarried = 0;
  const carryTypes = state.leaveTypes.filter(
    (t) => t.paid && t.maxCarryForward > 0,
  );
  if (carryTypes.length === 0) {
    return { ok: false, error: "No leave types allow carry-forward (set max on EL)" };
  }

  const balances = [...state.leaveBalances];
  const touchedStaff = new Set<string>();

  for (const s of input.staff.filter((x) => x.status === "active")) {
    for (const t of carryTypes) {
      const fromBal = balances.find(
        (b) =>
          b.staffId === s.id &&
          b.typeCode === t.code &&
          b.academicYearCode === input.fromAy,
      );
      if (!fromBal) continue;
      const remain = remainingBalance(fromBal);
      const carry = Math.min(remain, t.maxCarryForward);
      if (carry <= 0) continue;

      const toIdx = balances.findIndex(
        (b) =>
          b.staffId === s.id &&
          b.typeCode === t.code &&
          b.academicYearCode === input.toAy,
      );
      if (toIdx < 0) continue;
      const toBal = balances[toIdx]!;
      if (toBal.carriedForward > 0 && !input.force) continue;

      balances[toIdx] = {
        ...toBal,
        carriedForward: carry,
      };
      daysCarried += carry;
      touchedStaff.add(s.id);
    }
  }

  staffUpdated = touchedStaff.size;
  const next = { ...state, leaveBalances: balances };
  saveStaffHr(next);
  return { ok: true, state: next, staffUpdated, daysCarried };
}

/** Encash unused paid leave (stub — records days; payroll amount is manual). */
export function encashLeave(input: {
  staffId: string;
  typeCode: LeaveTypeCode;
  academicYearCode: string;
  days: number;
  recordedBy: string;
  note?: string;
}):
  | { ok: true; state: StaffHrState; encashment: LeaveEncashment }
  | { ok: false; error: string } {
  const days = Math.round((Number(input.days) || 0) * 2) / 2;
  if (days <= 0) return { ok: false, error: "Days must be greater than zero" };
  if (!input.staffId) return { ok: false, error: "Staff required" };

  const state = loadStaffHr();
  const type = state.leaveTypes.find(
    (t) => t.code === input.typeCode.toUpperCase(),
  );
  if (!type) return { ok: false, error: "Leave type not found" };
  if (!type.paid) return { ok: false, error: "Cannot encash unpaid leave (LWP)" };

  const bal = state.leaveBalances.find(
    (b) =>
      b.staffId === input.staffId &&
      b.typeCode === type.code &&
      b.academicYearCode === input.academicYearCode,
  );
  if (!bal) return { ok: false, error: "No leave balance for this staff / year" };
  const remain = remainingBalance(bal);
  if (days > remain) {
    return { ok: false, error: `Only ${remain} day(s) available to encash` };
  }

  const encashment: LeaveEncashment = {
    id: nid("enc"),
    academicYearCode: input.academicYearCode,
    staffId: input.staffId,
    typeCode: type.code,
    days,
    note: (input.note || "").trim() || `Encash ${type.code}`,
    recordedBy: input.recordedBy,
    recordedAt: new Date().toISOString(),
  };

  const next: StaffHrState = {
    ...state,
    leaveBalances: state.leaveBalances.map((b) =>
      b.id === bal.id
        ? { ...b, encashed: Math.round((b.encashed + days) * 2) / 2 }
        : b,
    ),
    leaveEncashments: [encashment, ...state.leaveEncashments],
  };
  saveStaffHr(next);
  return { ok: true, state: next, encashment };
}

/**
 * Approved unpaid leave days overlapping a calendar month (YYYY-MM).
 * Half-day credits 0.5 once; multi-day uses calendar overlap.
 */
export function unpaidLeaveDaysInMonth(
  staffId: string,
  ym: string,
  academicYearCode: string,
  state?: StaffHrState,
): number {
  const hr = state ?? loadStaffHr();
  const types = new Map(hr.leaveTypes.map((t) => [t.code, t]));
  let days = 0;
  for (const r of hr.leaveRequests) {
    if (r.staffId !== staffId) continue;
    if (r.academicYearCode !== academicYearCode) continue;
    if (r.status !== "approved") continue;
    const t = types.get(r.typeCode);
    if (t?.paid !== false) continue;
    const byMonth = leaveDaysByMonth(r.fromDate, r.toDate, r.halfDay);
    days += byMonth[ym] ?? 0;
  }
  return Math.round(days * 2) / 2;
}

export function appraisalAverage(scores: AppraisalScores): number {
  const vals = APPRAISAL_CRITERIA.map((c) => scores[c.key]);
  const sum = vals.reduce((a, b) => a + b, 0);
  return Math.round((sum / vals.length) * 10) / 10;
}

export function defaultAppraisalScores(): AppraisalScores {
  return emptyScores();
}

export type LeaveTypeRemovalCheck = {
  canRemove: boolean;
  blockers: string[];
  suggestion: string;
  confirmMessage: string;
};

export function checkLeaveTypeRemoval(
  state: StaffHrState,
  code: string,
): LeaveTypeRemovalCheck {
  const typeCode = code.trim().toUpperCase();
  const type = state.leaveTypes.find((t) => t.code === typeCode);
  const confirmMessage = `Remove leave type “${typeCode}”?`;
  if (!type) {
    return {
      canRemove: false,
      blockers: ["not found"],
      suggestion: "Refresh and try again",
      confirmMessage,
    };
  }
  const usedInRequests = state.leaveRequests.filter(
    (r) => r.typeCode === typeCode,
  ).length;
  if (usedInRequests > 0) {
    return {
      canRemove: false,
      blockers: [`${usedInRequests} leave request(s)`],
      suggestion: `Used by ${usedInRequests} leave request(s) — cannot remove`,
      confirmMessage,
    };
  }
  return {
    canRemove: true,
    blockers: [],
    suggestion: "Balances for this type will be cleared. Cannot be undone.",
    confirmMessage,
  };
}

export function upsertLeaveType(input: {
  code: string;
  name: string;
  paid: boolean;
  defaultDaysPerYear: number;
  maxDaysPerMonth?: number;
  maxDaysPerRequest?: number;
  maxCarryForward?: number;
  /** When editing, original code (allows rename if unused). */
  previousCode?: string;
}): { ok: true; state: StaffHrState } | { ok: false; error: string } {
  const row = normalizeLeaveType({
    code: input.code,
    name: input.name,
    paid: input.paid,
    defaultDaysPerYear: input.defaultDaysPerYear,
    maxDaysPerMonth: input.maxDaysPerMonth,
    maxDaysPerRequest: input.maxDaysPerRequest,
    maxCarryForward: input.maxCarryForward,
  });
  if (!row) return { ok: false, error: "Code and name are required (A–Z, 0–9)" };

  const state = loadStaffHr();
  const prev = (input.previousCode || "").trim().toUpperCase();
  const isRename = prev && prev !== row.code;

  if (isRename) {
    const check = checkLeaveTypeRemoval(state, prev);
    if (!check.canRemove) {
      return {
        ok: false,
        error: "Cannot rename — type is used by existing leave requests",
      };
    }
  }

  const conflict = state.leaveTypes.find(
    (t) => t.code === row.code && (!prev || t.code !== prev),
  );
  if (conflict && !prev) {
    return { ok: false, error: `Leave type ${row.code} already exists` };
  }
  if (conflict && isRename) {
    return { ok: false, error: `Leave type ${row.code} already exists` };
  }

  let leaveTypes: LeaveType[];
  if (prev) {
    leaveTypes = state.leaveTypes.map((t) => (t.code === prev ? row : t));
  } else if (state.leaveTypes.some((t) => t.code === row.code)) {
    leaveTypes = state.leaveTypes.map((t) => (t.code === row.code ? row : t));
  } else {
    leaveTypes = [...state.leaveTypes, row];
  }

  // Keep balances in sync on rename / allotment change for unused future AY rows
  let leaveBalances = state.leaveBalances;
  if (isRename) {
    leaveBalances = leaveBalances.map((b) =>
      b.typeCode === prev ? { ...b, typeCode: row.code } : b,
    );
  }
  // Update allotted on unused balances when default days change (same code)
  leaveBalances = leaveBalances.map((b) => {
    if (b.typeCode !== row.code) return b;
    if (b.used > 0) return b;
    return { ...b, allotted: row.defaultDaysPerYear };
  });

  const next = { ...state, leaveTypes, leaveBalances };
  saveStaffHr(next);
  return { ok: true, state: next };
}

export function removeLeaveType(
  code: string,
): { ok: true; state: StaffHrState } | { ok: false; error: string } {
  const state = loadStaffHr();
  const typeCode = code.trim().toUpperCase();
  const check = checkLeaveTypeRemoval(state, typeCode);
  if (!check.canRemove) return { ok: false, error: check.suggestion };

  const next: StaffHrState = {
    ...state,
    leaveTypes: state.leaveTypes.filter((t) => t.code !== typeCode),
    leaveBalances: state.leaveBalances.filter((b) => b.typeCode !== typeCode),
  };
  saveStaffHr(next);
  return { ok: true, state: next };
}
