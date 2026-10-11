/**
 * Staff leave rules — the balance engine (director, 11 Oct 2026: "the old
 * SStudy ERP had this; ours is partial").
 *
 * Requests, types and the desk balance rows stay in the staff HR desk
 * (lib/staffHr). A year's POLICY lives in server tables
 * (staff_leave_policy_* — lib/staffLeaveRules.server.ts) and this file is
 * the arithmetic on top of both. Pure: no storage, no clock, no holidays of
 * its own — the caller hands in `isOff(date, staffId)` built from Masters →
 * Holidays (and Sundays).
 *
 *   balance = opening (carried in) + allocated − taken
 *
 * - allocated: staff row > staff-category row > the type's default days.
 * - taken: approved leave of that year. A half day is 0.5. A full day that
 *   falls on a holiday / Sunday is not leave — unless the type's sandwich
 *   rule is on and the day sits BETWEEN two leave days (inside one request,
 *   or in the gap between two approved requests, charged to the later one).
 * - opening: what the year-end carry-forward put into this year (capped).
 *
 * Nothing here turns "unknown" into zero: the server reads that feed it
 * return errors, and a year with no policy returns null, never an empty
 * policy.
 */

import type { LeaveRequest, LeaveStatus, StaffHrState } from "@/lib/staffHr";

export type InsufficientMode = "block" | "lwp";

export type LeavePolicyType = {
  typeCode: string;
  /** Days everyone gets unless a category or staff row says otherwise. */
  defaultDays: number;
  halfDayAllowed: boolean;
  /** Holidays / Sundays between two leave days count as leave. */
  sandwich: boolean;
  /** Most unused days that roll into the next year (0 = none). */
  carryForwardCap: number;
  /** What approving does when the balance is short. */
  insufficientMode: InsufficientMode;
};

export type LeaveAllocationRow = {
  id: string;
  typeCode: string;
  /** Exactly one of staffCategory / staffId is set. */
  staffCategory: string | null;
  staffId: string | null;
  days: number;
  note: string;
};

export type LeavePolicy = {
  academicYearCode: string;
  types: LeavePolicyType[];
  allocations: LeaveAllocationRow[];
};

export type CarryForwardRow = {
  fromAy: string;
  toAy: string;
  staffId: string;
  typeCode: string;
  closingBalance: number;
  cap: number;
  daysCarried: number;
};

export type ApproverScopeKind = "school" | "department" | "staff";
export type ApproverRule = {
  id: string;
  scopeKind: ApproverScopeKind;
  /** "" for the whole school; a department id; a staff id. */
  scopeId: string;
  level: 1 | 2;
  approverStaffId: string;
};

export type StaffLite = {
  id: string;
  fullName?: string;
  empCode?: string;
  category?: string;
  departmentId?: string | null;
  status?: string;
};

/** A desk leave type, as the rules need it. */
export type DeskTypeLite = { code: string; name: string; paid: boolean };

export type RequestLite = Pick<
  LeaveRequest,
  "id" | "staffId" | "typeCode" | "fromDate" | "toDate" | "halfDay" | "status" | "academicYearCode"
>;

/** true = not a working day for this person (holiday, Sunday). */
export type IsOffFn = (isoDate: string, staffId: string) => boolean;

export const STAFF_CATEGORY_KEYS = ["permanent", "contract", "part_time"] as const;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

/** Round DOWN to a half day — a carry never rounds up into leave not earned. */
export function floorHalf(n: number): number {
  return Math.floor(n * 2 + 1e-9) / 2;
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Every date from..to inclusive (empty when either is not a date or to < from). */
export function eachDate(from: string, to: string): string[] {
  if (!ISO.test(from) || !ISO.test(to) || to < from) return [];
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 800; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The academic year's months, April → March ("2026-27" → 2026-04 … 2027-03). */
export function ayMonths(ay: string): string[] {
  const y = Number(ay.slice(0, 4));
  if (!Number.isFinite(y) || y < 2000) return [];
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const m = ((3 + i) % 12) + 1;
    const yy = i < 9 ? y : y + 1;
    out.push(`${yy}-${String(m).padStart(2, "0")}`);
  }
  return out;
}

export function policyType(policy: LeavePolicy | null, typeCode: string): LeavePolicyType | null {
  return policy?.types.find((t) => t.typeCode === typeCode) ?? null;
}

/** Days of this type for this person: staff row > category row > default. */
export function resolveAllocation(
  policy: LeavePolicy,
  staff: StaffLite,
  typeCode: string,
): { days: number; source: "staff" | "category" | "default" | "none" } {
  const t = policyType(policy, typeCode);
  const own = policy.allocations.find((a) => a.typeCode === typeCode && a.staffId === staff.id);
  if (own) return { days: own.days, source: "staff" };
  const cat = staff.category
    ? policy.allocations.find((a) => a.typeCode === typeCode && a.staffCategory === staff.category && !a.staffId)
    : undefined;
  if (cat) return { days: cat.days, source: "category" };
  if (t) return { days: t.defaultDays, source: "default" };
  return { days: 0, source: "none" };
}

export type DateCharge = { date: string; charge: number };

/**
 * What one request costs, date by date, on its own. Edge holidays never
 * count; interior ones count only with the sandwich rule.
 */
export function requestCharge(
  req: Pick<RequestLite, "staffId" | "fromDate" | "toDate" | "halfDay">,
  sandwich: boolean,
  isOff: IsOffFn,
): { total: number; perDate: DateCharge[] } {
  if (req.halfDay) {
    if (!ISO.test(req.fromDate)) return { total: 0, perDate: [] };
    const c = isOff(req.fromDate, req.staffId) ? 0 : 0.5;
    return { total: c, perDate: [{ date: req.fromDate, charge: c }] };
  }
  const dates = eachDate(req.fromDate, req.toDate);
  const off = dates.map((d) => isOff(d, req.staffId));
  const first = off.indexOf(false);
  const last = off.lastIndexOf(false);
  const perDate = dates.map((date, i) => ({
    date,
    charge: !off[i] ? 1 : sandwich && first >= 0 && i > first && i < last ? 1 : 0,
  }));
  return { total: perDate.reduce((s, x) => s + x.charge, 0), perDate };
}

function firstWorking(req: RequestLite, isOff: IsOffFn): string | null {
  return eachDate(req.fromDate, req.toDate).find((d) => !isOff(d, req.staffId)) ?? null;
}
function lastWorking(req: RequestLite, isOff: IsOffFn): string | null {
  const ds = eachDate(req.fromDate, req.toDate);
  for (let i = ds.length - 1; i >= 0; i--) if (!isOff(ds[i]!, req.staffId)) return ds[i]!;
  return null;
}

/**
 * The sandwich across two requests: Friday's leave and Monday's leave make
 * the weekend leave too. For one person's approved full-day requests in
 * date order, the days between A's last working leave day and B's first
 * are charged to B when every one of them is off and both types have the
 * rule on. Half days never sandwich.
 */
export function crossSandwichCharges(
  requests: RequestLite[],
  sandwichOn: (typeCode: string) => boolean,
  isOff: IsOffFn,
): Map<string, DateCharge[]> {
  const out = new Map<string, DateCharge[]>();
  const byStaff = new Map<string, RequestLite[]>();
  for (const r of requests) {
    if (r.halfDay) continue;
    const list = byStaff.get(r.staffId) ?? [];
    list.push(r);
    byStaff.set(r.staffId, list);
  }
  for (const list of byStaff.values()) {
    list.sort((a, b) => a.fromDate.localeCompare(b.fromDate) || a.toDate.localeCompare(b.toDate));
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1]!;
      const b = list[i]!;
      if (b.fromDate <= a.toDate) continue;
      if (!sandwichOn(a.typeCode) || !sandwichOn(b.typeCode)) continue;
      const lw = lastWorking(a, isOff);
      const fw = firstWorking(b, isOff);
      if (!lw || !fw) continue;
      const between = eachDate(addDays(lw, 1), addDays(fw, -1));
      // Only the GAP between the two requests is new; edge off-days inside
      // A or B are part of that request and charged here too, since the
      // single-request rule never charges an edge.
      if (!between.length) continue;
      if (!between.every((d) => isOff(d, b.staffId))) continue;
      if (!between.some((d) => d > a.toDate && d < b.fromDate)) continue;
      out.set(b.id, [...(out.get(b.id) ?? []), ...between.map((date) => ({ date, charge: 1 }))]);
    }
  }
  return out;
}

export type LeaveBookRow = {
  staffId: string;
  typeCode: string;
  paid: boolean;
  /** Governed by the policy (a paid type with a policy row). */
  governed: boolean;
  opening: number;
  allocated: number;
  allocationSource: "staff" | "category" | "default" | "none";
  taken: number;
  /** Of `taken`, days counted by the sandwich rule. */
  sandwichDays: number;
  pending: number;
  balance: number;
  /** Taken per month (YYYY-MM). */
  takenByMonth: Record<string, number>;
};

const APPROVED: LeaveStatus = "approved";
const isPending = (s: LeaveStatus) => s === "pending" || s === "pending_l2";

/**
 * Every active member of staff × every desk type, for one academic year.
 * Requests of other years are ignored.
 */
export function computeLeaveBook(input: {
  ay: string;
  policy: LeavePolicy;
  deskTypes: DeskTypeLite[];
  staff: StaffLite[];
  requests: RequestLite[];
  carry: CarryForwardRow[];
  isOff: IsOffFn;
}): LeaveBookRow[] {
  const { ay, policy, isOff } = input;
  const yearReqs = input.requests.filter((r) => r.academicYearCode === ay);
  const sandwichOn = (code: string) => !!policyType(policy, code)?.sandwich;
  const approved = yearReqs.filter((r) => r.status === APPROVED);
  const cross = crossSandwichCharges(approved, sandwichOn, isOff);

  const key = (s: string, t: string) => `${s}|${t}`;
  const taken = new Map<string, { total: number; sandwich: number; byMonth: Record<string, number> }>();
  const pending = new Map<string, number>();
  for (const r of yearReqs) {
    const k = key(r.staffId, r.typeCode);
    if (r.status === APPROVED) {
      const own = requestCharge(r, sandwichOn(r.typeCode), isOff);
      const plain = requestCharge(r, false, isOff).total;
      const extra = cross.get(r.id) ?? [];
      const acc = taken.get(k) ?? { total: 0, sandwich: 0, byMonth: {} };
      for (const c of [...own.perDate, ...extra]) {
        if (!c.charge) continue;
        acc.total += c.charge;
        const ym = c.date.slice(0, 7);
        acc.byMonth[ym] = (acc.byMonth[ym] ?? 0) + c.charge;
      }
      acc.sandwich += own.total - plain + extra.reduce((s, c) => s + c.charge, 0);
      taken.set(k, acc);
    } else if (isPending(r.status)) {
      pending.set(k, (pending.get(k) ?? 0) + requestCharge(r, sandwichOn(r.typeCode), isOff).total);
    }
  }

  const rows: LeaveBookRow[] = [];
  const active = input.staff.filter((s) => (s.status ?? "active") === "active");
  for (const s of active) {
    for (const t of input.deskTypes) {
      const pt = policyType(policy, t.code);
      const governed = !!pt && t.paid;
      const alloc = governed ? resolveAllocation(policy, s, t.code) : { days: 0, source: "none" as const };
      const opening = governed
        ? input.carry
            .filter((c) => c.toAy === ay && c.staffId === s.id && c.typeCode === t.code)
            .reduce((sum, c) => sum + c.daysCarried, 0)
        : 0;
      const tk = taken.get(key(s.id, t.code)) ?? { total: 0, sandwich: 0, byMonth: {} };
      rows.push({
        staffId: s.id,
        typeCode: t.code,
        paid: t.paid,
        governed,
        opening: roundHalf(opening),
        allocated: roundHalf(alloc.days),
        allocationSource: alloc.source,
        taken: roundHalf(tk.total),
        sandwichDays: roundHalf(tk.sandwich),
        pending: roundHalf(pending.get(key(s.id, t.code)) ?? 0),
        balance: governed ? roundHalf(opening + alloc.days - tk.total) : 0,
        takenByMonth: tk.byMonth,
      });
    }
  }
  return rows;
}

/** Balance left at the end of each month of the year (opening + allocated − taken so far). */
export function monthEndBalances(row: LeaveBookRow, ay: string): { month: string; taken: number; balance: number }[] {
  let cum = 0;
  return ayMonths(ay).map((month) => {
    const t = row.takenByMonth[month] ?? 0;
    cum += t;
    return { month, taken: roundHalf(t), balance: roundHalf(row.opening + row.allocated - cum) };
  });
}

// ── Approving ────────────────────────────────────────────────────────────

export type ApprovalCheck =
  | { ok: true; charge: number; remainingAfter: number | null }
  | { ok: false; reason: "half_day_not_allowed"; message: string }
  | {
      ok: false;
      reason: "insufficient";
      mode: InsufficientMode;
      message: string;
      charge: number;
      remaining: number;
      /** For 'lwp': paid part ends paidToDate (null = all LWP); LWP from lwpFromDate. */
      split: { paidToDate: string | null; lwpFromDate: string; paidCharge: number } | null;
    };

/**
 * May this pending request be approved under the year's policy? The charge
 * is what approving it ADDS to taken — its own days plus any sandwich it
 * closes with leave already approved.
 */
export function checkApproval(input: {
  ay: string;
  policy: LeavePolicy;
  deskTypes: DeskTypeLite[];
  staff: StaffLite;
  requests: RequestLite[];
  carry: CarryForwardRow[];
  requestId: string;
  isOff: IsOffFn;
}): ApprovalCheck {
  const req = input.requests.find((r) => r.id === input.requestId);
  if (!req) return { ok: true, charge: 0, remainingAfter: null };
  const pt = policyType(input.policy, req.typeCode);
  const desk = input.deskTypes.find((t) => t.code === req.typeCode);
  if (pt && req.halfDay && !pt.halfDayAllowed) {
    return { ok: false, reason: "half_day_not_allowed", message: `${req.typeCode} cannot be taken as a half day this year` };
  }
  if (!pt || !desk?.paid) return { ok: true, charge: 0, remainingAfter: null };

  const book = (reqs: RequestLite[]) =>
    computeLeaveBook({ ...input, staff: [{ ...input.staff, status: "active" }], requests: reqs }).find(
      (r) => r.typeCode === req.typeCode,
    )!;
  const others = input.requests.filter((r) => r.id !== req.id);
  const before = book(others);
  const after = book([...others, { ...req, status: "approved" }]);
  const charge = roundHalf(after.taken - before.taken);
  const remaining = before.balance;
  if (charge <= remaining + 1e-9) {
    return { ok: true, charge, remainingAfter: roundHalf(remaining - charge) };
  }

  const shortBy = roundHalf(charge - remaining);
  const message = `Short by ${shortBy} day(s) of ${req.typeCode} — ${Math.max(0, remaining)} left, this leave needs ${charge}`;
  if (pt.insufficientMode === "block") {
    return { ok: false, reason: "insufficient", mode: "block", message, charge, remaining, split: null };
  }
  // 'lwp': walk the dates; the sandwich this request closes with earlier
  // leave comes first (that gap sits before its first day).
  const own = requestCharge(req, pt.sandwich, input.isOff);
  const crossPart = roundHalf(charge - own.total);
  let avail = remaining - crossPart;
  let paidTo: string | null = null;
  let paidCharge = 0;
  if (!req.halfDay && avail > 0) {
    for (const d of own.perDate) {
      if (d.charge > avail + 1e-9) break;
      avail -= d.charge;
      paidCharge += d.charge;
      paidTo = d.date;
    }
  }
  // A paid part that charges nothing (only edge holidays) is no paid part.
  if (paidCharge <= 0) paidTo = null;
  const lwpFromDate = paidTo ? addDays(paidTo, 1) : req.fromDate;
  return {
    ok: false,
    reason: "insufficient",
    mode: "lwp",
    message,
    charge,
    remaining,
    split: { paidToDate: paidTo, lwpFromDate, paidCharge: roundHalf(paidCharge + Math.max(0, crossPart)) },
  };
}

/** Inclusive calendar days, as the desk counts a request's `days`. */
function calendarDays(from: string, to: string): number {
  return eachDate(from, to).length || 1;
}

function nid(prefix: string, seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `${prefix}_${h.toString(36).padStart(7, "0").slice(0, 8)}`;
}

/** Desk `used` for one person, recomputed from approved requests (as staffHr does). */
export function recomputeDeskUsed(state: StaffHrState, staffId: string, ay: string): StaffHrState {
  return {
    ...state,
    leaveBalances: state.leaveBalances.map((b) =>
      b.staffId === staffId && b.academicYearCode === ay
        ? {
            ...b,
            used: state.leaveRequests
              .filter((r) => r.staffId === staffId && r.typeCode === b.typeCode && r.academicYearCode === ay && r.status === "approved")
              .reduce((s, r) => s + r.days, 0),
          }
        : b,
    ),
  };
}

/**
 * Approve (or pass level 1 of) a request on the desk state. Pure. With a
 * split, the request keeps its type up to paidToDate and a new approved LWP
 * request covers lwpFromDate → its end; with paidToDate null the whole
 * request becomes LWP. Returns the requests now approved (for the register).
 */
export function approveOnDesk(
  state: StaffHrState,
  input: {
    requestId: string;
    decidedBy: string;
    note: string;
    now: string;
    twoLevel: boolean;
    split?: { paidToDate: string | null; lwpFromDate: string; lwpTypeCode: string } | null;
  },
): { state: StaffHrState; approved: LeaveRequest[]; status: LeaveStatus } | { error: string } {
  const req = state.leaveRequests.find((r) => r.id === input.requestId);
  if (!req) return { error: "Leave request not found" };
  if (req.status !== "pending" && req.status !== "pending_l2") return { error: "Request already decided" };
  const awaitingL1 = req.status === "pending";
  const note = input.note.trim();

  if (input.twoLevel && awaitingL1) {
    const next: LeaveRequest = { ...req, status: "pending_l2", level1By: input.decidedBy, level1At: input.now, decisionNote: note };
    return {
      state: { ...state, leaveRequests: state.leaveRequests.map((r) => (r.id === req.id ? next : r)) },
      approved: [],
      status: "pending_l2",
    };
  }

  const level = awaitingL1 ? { level1By: input.decidedBy, level1At: input.now } : {};
  const decided = { status: "approved" as const, decidedBy: input.decidedBy, decidedAt: input.now, ...level };
  const split = input.split ?? null;
  let requests = state.leaveRequests;
  const approved: LeaveRequest[] = [];

  if (!split) {
    const next: LeaveRequest = { ...req, ...decided, decisionNote: note };
    requests = requests.map((r) => (r.id === req.id ? next : r));
    approved.push(next);
  } else if (!split.paidToDate) {
    const next: LeaveRequest = {
      ...req,
      ...decided,
      typeCode: split.lwpTypeCode,
      origin: "adjusted",
      decisionNote: [note, `Not enough ${req.typeCode} balance — approved as ${split.lwpTypeCode}`].filter(Boolean).join(" · "),
    };
    requests = requests.map((r) => (r.id === req.id ? next : r));
    approved.push(next);
  } else {
    const paid: LeaveRequest = {
      ...req,
      ...decided,
      toDate: split.paidToDate,
      days: calendarDays(req.fromDate, split.paidToDate),
      origin: "adjusted",
      decisionNote: [note, `${split.lwpFromDate} to ${req.toDate} approved as ${split.lwpTypeCode} (balance short)`]
        .filter(Boolean)
        .join(" · "),
    };
    const lwp: LeaveRequest = {
      ...req,
      ...decided,
      id: nid("lv", `${req.id}|${split.lwpFromDate}|lwp`),
      typeCode: split.lwpTypeCode,
      fromDate: split.lwpFromDate,
      days: calendarDays(split.lwpFromDate, req.toDate),
      halfDay: false,
      halfDaySession: "",
      origin: "adjusted",
      decisionNote: `Rest of ${req.typeCode} leave ${req.fromDate}–${req.toDate}: balance short, unpaid`,
    };
    const idx = requests.findIndex((r) => r.id === req.id);
    requests = [...requests.slice(0, idx), paid, lwp, ...requests.slice(idx + 1)];
    approved.push(paid, lwp);
  }

  const next = recomputeDeskUsed({ ...state, leaveRequests: requests }, req.staffId, req.academicYearCode);
  return { state: next, approved, status: "approved" };
}

// ── Approvers ────────────────────────────────────────────────────────────

export type ApproverChain = {
  level1: string[];
  level2: string[];
  source: ApproverScopeKind | "none";
};

/** The most specific scope with any rows wins: staff > department > school. */
export function resolveApprovers(rules: ApproverRule[], staff: StaffLite): ApproverChain {
  const pick = (kind: ApproverScopeKind, id: string) =>
    rules.filter((r) => r.scopeKind === kind && r.scopeId === id && r.approverStaffId !== staff.id);
  const tiers: [ApproverScopeKind, ApproverRule[]][] = [
    ["staff", pick("staff", staff.id)],
    ["department", staff.departmentId ? pick("department", staff.departmentId) : []],
    ["school", pick("school", "")],
  ];
  for (const [source, rows] of tiers) {
    if (!rows.length) continue;
    return {
      level1: [...new Set(rows.filter((r) => r.level === 1).map((r) => r.approverStaffId))],
      level2: [...new Set(rows.filter((r) => r.level === 2).map((r) => r.approverStaffId))],
      source,
    };
  }
  return { level1: [], level2: [], source: "none" };
}

/**
 * May this approver decide this request now? Leadership always may (nobody
 * is ever stuck). A named approver may at their level: with two-level
 * approval on, level 1 decides "pending" and level 2 "pending_l2" (when a
 * level is empty the other level's approvers stand in); with it off,
 * either level decides outright.
 */
export function canDecide(input: {
  chain: ApproverChain;
  approverStaffId: string;
  isLeadership: boolean;
  status: LeaveStatus;
  twoLevel: boolean;
}): boolean {
  if (input.isLeadership) return true;
  const { level1, level2 } = input.chain;
  const id = input.approverStaffId;
  if (!id) return false;
  if (!input.twoLevel) return level1.includes(id) || level2.includes(id);
  if (input.status === "pending") return level1.length ? level1.includes(id) : level2.includes(id);
  if (input.status === "pending_l2") return level2.length ? level2.includes(id) : level1.includes(id);
  return false;
}

// ── Year-end carry-forward ───────────────────────────────────────────────

export type CarryPlanRow = CarryForwardRow & { staffName: string };
export type CarryPlan = {
  rows: CarryPlanRow[];
  alreadyCarried: { staffId: string; typeCode: string; daysCarried: number }[];
  totalDays: number;
};

/**
 * What the year-end carry would move: for each paid type whose cap is above
 * zero in the CLOSING year's policy, min(balance, cap), rounded down to a
 * half day. A person/type already carried into the receiving year is left
 * out — committing twice carries nothing twice.
 */
export function planCarryForward(input: {
  fromAy: string;
  toAy: string;
  fromPolicy: LeavePolicy;
  fromBook: LeaveBookRow[];
  existingTo: CarryForwardRow[];
  staffNames: Map<string, string>;
}): CarryPlan {
  const rows: CarryPlanRow[] = [];
  const alreadyCarried: CarryPlan["alreadyCarried"] = [];
  const done = new Map(input.existingTo.filter((c) => c.toAy === input.toAy).map((c) => [`${c.staffId}|${c.typeCode}`, c]));
  for (const b of input.fromBook) {
    if (!b.governed) continue;
    const pt = policyType(input.fromPolicy, b.typeCode);
    if (!pt || pt.carryForwardCap <= 0) continue;
    const prior = done.get(`${b.staffId}|${b.typeCode}`);
    if (prior) {
      alreadyCarried.push({ staffId: b.staffId, typeCode: b.typeCode, daysCarried: prior.daysCarried });
      continue;
    }
    const days = floorHalf(Math.min(Math.max(0, b.balance), pt.carryForwardCap));
    if (days <= 0) continue;
    rows.push({
      fromAy: input.fromAy,
      toAy: input.toAy,
      staffId: b.staffId,
      typeCode: b.typeCode,
      closingBalance: b.balance,
      cap: pt.carryForwardCap,
      daysCarried: days,
      staffName: input.staffNames.get(b.staffId) || b.staffId,
    });
  }
  rows.sort((a, b) => a.staffName.localeCompare(b.staffName) || a.typeCode.localeCompare(b.typeCode));
  return { rows, alreadyCarried, totalDays: roundHalf(rows.reduce((s, r) => s + r.daysCarried, 0)) };
}

// ── Policy → desk balances ───────────────────────────────────────────────

export type DeskBalanceChange = {
  staffId: string;
  typeCode: string;
  allottedBefore: number;
  allottedAfter: number;
  carriedBefore: number;
  carriedAfter: number;
};

/**
 * Bring the desk balance rows (what the staff app, WhatsApp and the old
 * screens show) in line with the policy: allotted = the allocation, carried
 * forward = the carry rows. Only rows that move are returned; nobody is
 * set below what they have already taken (those are reported, not changed).
 */
export function planDeskSync(input: {
  ay: string;
  state: StaffHrState;
  book: LeaveBookRow[];
}): { changes: DeskBalanceChange[]; refused: { staffId: string; typeCode: string; used: number; wouldBe: number }[] } {
  const changes: DeskBalanceChange[] = [];
  const refused: { staffId: string; typeCode: string; used: number; wouldBe: number }[] = [];
  for (const b of input.book) {
    if (!b.governed) continue;
    const desk = input.state.leaveBalances.find(
      (x) => x.staffId === b.staffId && x.typeCode === b.typeCode && x.academicYearCode === input.ay,
    );
    const allottedBefore = desk?.allotted ?? 0;
    const carriedBefore = desk?.carriedForward ?? 0;
    if (allottedBefore === b.allocated && carriedBefore === b.opening && desk) continue;
    const used = desk?.used ?? 0;
    const encashed = desk?.encashed ?? 0;
    if (b.allocated + b.opening < used + encashed) {
      refused.push({ staffId: b.staffId, typeCode: b.typeCode, used, wouldBe: b.allocated + b.opening });
      continue;
    }
    changes.push({
      staffId: b.staffId,
      typeCode: b.typeCode,
      allottedBefore,
      allottedAfter: b.allocated,
      carriedBefore,
      carriedAfter: b.opening,
    });
  }
  return { changes, refused };
}

/** Apply planDeskSync's changes to the desk state, logging each allotment move. */
export function applyDeskSync(
  state: StaffHrState,
  input: { ay: string; changes: DeskBalanceChange[]; changedBy: string; now: string },
): StaffHrState {
  let balances = [...state.leaveBalances];
  const log = [...state.leaveAllotmentLog];
  for (const c of input.changes) {
    const idx = balances.findIndex(
      (b) => b.staffId === c.staffId && b.typeCode === c.typeCode && b.academicYearCode === input.ay,
    );
    if (idx >= 0) {
      balances[idx] = { ...balances[idx]!, allotted: c.allottedAfter, carriedForward: c.carriedAfter };
    } else {
      balances = [
        ...balances,
        {
          id: nid("lb", `${input.ay}|${c.staffId}|${c.typeCode}`),
          academicYearCode: input.ay,
          staffId: c.staffId,
          typeCode: c.typeCode,
          allotted: c.allottedAfter,
          carriedForward: c.carriedAfter,
          encashed: 0,
          used: 0,
        },
      ];
    }
    if (c.allottedBefore !== c.allottedAfter) {
      log.unshift({
        id: nid("lal", `${input.now}|${c.staffId}|${c.typeCode}`),
        academicYearCode: input.ay,
        staffId: c.staffId,
        typeCode: c.typeCode,
        mode: "set",
        days: c.allottedAfter,
        before: c.allottedBefore,
        after: c.allottedAfter,
        reason: `Leave policy ${input.ay}`,
        changedBy: input.changedBy,
        changedAt: input.now,
      });
    }
  }
  return { ...state, leaveBalances: balances, leaveAllotmentLog: log };
}
