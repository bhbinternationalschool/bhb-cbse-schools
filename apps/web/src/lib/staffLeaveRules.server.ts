/**
 * Staff leave rules — server side: the policy tables, the approver chain,
 * the year-end carry, and approving under the policy. The arithmetic is in
 * lib/staffLeaveRules.ts (pure, selftested); requests and desk balances stay
 * in the staff HR desk (lib/staffHr, lib/api/v1/staffLeave).
 *
 * Every read says when it failed — { ok: false } — and callers refuse rather
 * than treat a failed read as "no policy" or "no approvers".
 */

import "server-only";
import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchAllPages } from "@/lib/supabase/pageAll";
import { classifyStaffHolidayDay } from "@/lib/holidayPolicy";
import type { MastersState } from "@/lib/masters";
import {
  decideLeave,
  normalizeLeaveSettings,
  validateLeaveAdjustmentRules,
  writeStaffHrLocalRaw,
  type LeaveRequest,
  type StaffHrState,
} from "@/lib/staffHr";
import {
  approveOnDesk,
  canDecide,
  checkApproval,
  computeLeaveBook,
  planCarryForward,
  resolveApprovers,
  roundHalf,
  STAFF_CATEGORY_KEYS,
  type ApprovalCheck,
  type ApproverRule,
  type ApproverScopeKind,
  type CarryForwardRow,
  type CarryPlan,
  type DeskTypeLite,
  type InsufficientMode,
  type IsOffFn,
  type LeaveAllocationRow,
  type LeaveBookRow,
  type LeavePolicy,
  type LeavePolicyType,
  type StaffLite,
} from "@/lib/staffLeaveRules";

type Read<T> = { ok: true; value: T } | { ok: false; error: string };

const ISO_AY = /^\d{4}-\d{2}$/;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function tenant() {
  const ctx = await getServerTenantContext();
  if (!ctx) throw new Error("No tenant context");
  return ctx;
}

// ── Reads ────────────────────────────────────────────────────────────────

/** The year's policy, or null when the year has none (no type rows). */
export async function readLeavePolicy(ay: string): Promise<Read<LeavePolicy | null>> {
  if (!ISO_AY.test(ay)) return { ok: false, error: "Unknown academic year" };
  try {
    const { sb, tenantId } = await tenant();
    const types = await fetchAllPages<Record<string, unknown>>((from, to) =>
      sb
        .from("staff_leave_policy_types")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("academic_year_code", ay)
        .order("id")
        .range(from, to),
    );
    if (types.error) return { ok: false, error: types.error };
    if (!types.rows.length) return { ok: true, value: null };
    const allocs = await fetchAllPages<Record<string, unknown>>((from, to) =>
      sb
        .from("staff_leave_policy_allocations")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("academic_year_code", ay)
        .order("id")
        .range(from, to),
    );
    if (allocs.error) return { ok: false, error: allocs.error };
    return {
      ok: true,
      value: {
        academicYearCode: ay,
        types: types.rows
          .map(
            (r): LeavePolicyType => ({
              typeCode: String(r.type_code),
              defaultDays: num(r.default_days),
              halfDayAllowed: r.half_day_allowed !== false,
              sandwich: r.sandwich === true,
              carryForwardCap: num(r.carry_forward_cap),
              insufficientMode: r.insufficient_mode === "lwp" ? "lwp" : "block",
            }),
          )
          .sort((a, b) => a.typeCode.localeCompare(b.typeCode)),
        allocations: allocs.rows.map(
          (r): LeaveAllocationRow => ({
            id: String(r.id),
            typeCode: String(r.type_code),
            staffCategory: r.staff_category == null ? null : String(r.staff_category),
            staffId: r.staff_id == null ? null : String(r.staff_id),
            days: num(r.days),
            note: String(r.note ?? ""),
          }),
        ),
      },
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function readApproverRules(): Promise<Read<ApproverRule[]>> {
  try {
    const { sb, tenantId } = await tenant();
    const res = await fetchAllPages<Record<string, unknown>>((from, to) =>
      sb.from("staff_leave_approvers").select("*").eq("tenant_id", tenantId).order("id").range(from, to),
    );
    if (res.error) return { ok: false, error: res.error };
    return {
      ok: true,
      value: res.rows.map((r) => ({
        id: String(r.id),
        scopeKind: (["school", "department", "staff"].includes(String(r.scope_kind)) ? r.scope_kind : "school") as ApproverScopeKind,
        scopeId: String(r.scope_id ?? ""),
        level: Number(r.level) === 2 ? 2 : 1,
        approverStaffId: String(r.approver_staff_id),
      })),
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Carry rows INTO this year (its opening balances). */
export async function readCarryInto(ay: string): Promise<Read<CarryForwardRow[]>> {
  try {
    const { sb, tenantId } = await tenant();
    const res = await fetchAllPages<Record<string, unknown>>((from, to) =>
      sb
        .from("staff_leave_carry_forwards")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("to_academic_year_code", ay)
        .order("id")
        .range(from, to),
    );
    if (res.error) return { ok: false, error: res.error };
    return {
      ok: true,
      value: res.rows.map((r) => ({
        fromAy: String(r.from_academic_year_code),
        toAy: String(r.to_academic_year_code),
        staffId: String(r.staff_id),
        typeCode: String(r.type_code),
        closingBalance: num(r.closing_balance),
        cap: num(r.cap),
        daysCarried: num(r.days_carried),
      })),
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ── Inputs from Masters and the desk ─────────────────────────────────────

export function staffLite(masters: MastersState): StaffLite[] {
  return (masters.staff ?? []).map((s) => ({
    id: s.id,
    fullName: s.fullName,
    empCode: s.empCode,
    category: s.category,
    departmentId: s.departmentId,
    status: s.status,
  }));
}

export function deskTypesOf(state: StaffHrState): DeskTypeLite[] {
  return state.leaveTypes.map((t) => ({ code: t.code, name: t.name, paid: t.paid }));
}

/**
 * Masters → Holidays (published, the person's staff stream) plus every
 * Sunday unless a working-day override covers it. A half holiday is a
 * working day here — leave on it is still leave.
 */
export function nonWorkingFor(masters: MastersState, ay: string): IsOffFn {
  const streams = new Map((masters.staff ?? []).map((s) => [s.id, s.stream]));
  const memo = new Map<string, boolean>();
  return (date, staffId) => {
    const stream = streams.get(staffId) || "any";
    const k = `${date}|${stream}`;
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    const day = classifyStaffHolidayDay(masters, date, ay, stream);
    const sunday = new Date(`${date}T12:00:00Z`).getUTCDay() === 0;
    const off = day.status === "holiday" || (sunday && !(day.status === "working" && day.holiday?.workingOverride));
    memo.set(k, off);
    return off;
  };
}

export type LeaveBookResult = {
  policy: LeavePolicy;
  book: LeaveBookRow[];
  carry: CarryForwardRow[];
  deskTypes: DeskTypeLite[];
};

/** The year's book, or null when the year has no policy. */
export async function buildLeaveBook(input: {
  ay: string;
  masters: MastersState;
  state: StaffHrState;
}): Promise<Read<LeaveBookResult | null>> {
  const pol = await readLeavePolicy(input.ay);
  if (!pol.ok) return pol;
  if (!pol.value) return { ok: true, value: null };
  const carry = await readCarryInto(input.ay);
  if (!carry.ok) return carry;
  const deskTypes = deskTypesOf(input.state);
  const book = computeLeaveBook({
    ay: input.ay,
    policy: pol.value,
    deskTypes,
    staff: staffLite(input.masters),
    requests: input.state.leaveRequests,
    carry: carry.value,
    isOff: nonWorkingFor(input.masters, input.ay),
  });
  return { ok: true, value: { policy: pol.value, book, carry: carry.value, deskTypes } };
}

// ── Policy writes ────────────────────────────────────────────────────────

type WriteResult = { ok: true } | { ok: false; error: string };

function clampDays(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 365) return null;
  if (Math.round(n * 2) !== n * 2) return null;
  return n;
}

export async function savePolicyType(ay: string, t: LeavePolicyType, by: string): Promise<WriteResult> {
  const days = clampDays(t.defaultDays);
  const cap = clampDays(t.carryForwardCap);
  if (!ISO_AY.test(ay)) return { ok: false, error: "Unknown academic year" };
  if (!t.typeCode) return { ok: false, error: "Choose a leave type" };
  if (days === null || cap === null) return { ok: false, error: "Days go in whole or half days, 0–365" };
  const mode: InsufficientMode = t.insufficientMode === "lwp" ? "lwp" : "block";
  const { sb, tenantId } = await tenant();
  const { error } = await sb.from("staff_leave_policy_types").upsert(
    {
      tenant_id: tenantId,
      academic_year_code: ay,
      type_code: t.typeCode,
      default_days: days,
      half_day_allowed: !!t.halfDayAllowed,
      sandwich: !!t.sandwich,
      carry_forward_cap: cap,
      insufficient_mode: mode,
      updated_by: by,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,academic_year_code,type_code" },
  );
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Upsert one category or staff allocation (found by its natural key). */
export async function saveAllocation(
  ay: string,
  a: { typeCode: string; staffCategory: string | null; staffId: string | null; days: number; note: string },
  by: string,
): Promise<WriteResult> {
  const days = clampDays(a.days);
  if (days === null) return { ok: false, error: "Days go in whole or half days, 0–365" };
  if (!a.typeCode) return { ok: false, error: "Choose a leave type" };
  if (!!a.staffCategory === !!a.staffId) return { ok: false, error: "Choose a staff category or one member of staff" };
  if (a.staffCategory && !(STAFF_CATEGORY_KEYS as readonly string[]).includes(a.staffCategory)) {
    return { ok: false, error: "Unknown staff category" };
  }
  const { sb, tenantId } = await tenant();
  let q = sb
    .from("staff_leave_policy_allocations")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("academic_year_code", ay)
    .eq("type_code", a.typeCode);
  q = a.staffId ? q.eq("staff_id", a.staffId) : q.eq("staff_category", a.staffCategory!);
  const found = await q.maybeSingle();
  if (found.error) return { ok: false, error: found.error.message };
  const row = { days, note: a.note.slice(0, 200), updated_by: by, updated_at: new Date().toISOString() };
  const res = found.data?.id
    ? await sb.from("staff_leave_policy_allocations").update(row).eq("tenant_id", tenantId).eq("id", found.data.id)
    : await sb.from("staff_leave_policy_allocations").insert({
        ...row,
        tenant_id: tenantId,
        academic_year_code: ay,
        type_code: a.typeCode,
        staff_category: a.staffCategory,
        staff_id: a.staffId,
      });
  return res.error ? { ok: false, error: res.error.message } : { ok: true };
}

/** Explicit delete of one allocation row, by id. */
export async function deleteAllocation(id: string): Promise<WriteResult> {
  if (!id) return { ok: false, error: "id required" };
  const { sb, tenantId } = await tenant();
  const { error } = await sb.from("staff_leave_policy_allocations").delete().eq("tenant_id", tenantId).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function addApprover(
  r: { scopeKind: ApproverScopeKind; scopeId: string; level: 1 | 2; approverStaffId: string },
  by: string,
): Promise<WriteResult> {
  if (!["school", "department", "staff"].includes(r.scopeKind)) return { ok: false, error: "Unknown scope" };
  const scopeId = r.scopeKind === "school" ? "" : r.scopeId;
  if (r.scopeKind !== "school" && !scopeId) return { ok: false, error: "Choose the department or member of staff" };
  if (!r.approverStaffId) return { ok: false, error: "Choose the approver" };
  if (r.scopeKind === "staff" && scopeId === r.approverStaffId) return { ok: false, error: "Nobody approves their own leave" };
  const { sb, tenantId } = await tenant();
  const { error } = await sb.from("staff_leave_approvers").upsert(
    {
      tenant_id: tenantId,
      scope_kind: r.scopeKind,
      scope_id: scopeId,
      level: r.level === 2 ? 2 : 1,
      approver_staff_id: r.approverStaffId,
      created_by: by,
    },
    { onConflict: "tenant_id,scope_kind,scope_id,level,approver_staff_id", ignoreDuplicates: true },
  );
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function removeApprover(id: string): Promise<WriteResult> {
  if (!id) return { ok: false, error: "id required" };
  const { sb, tenantId } = await tenant();
  const { error } = await sb.from("staff_leave_approvers").delete().eq("tenant_id", tenantId).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Start a year's policy from what the desk already holds: one row per desk
 * type (default days, carry cap from the type) and a staff row for each
 * active person whose desk allotment differs from the type's default (the
 * director's 8 Oct "someone 10, someone 8" changes). Refused when the year
 * already has a policy.
 */
export async function seedPolicyFromDesk(input: {
  ay: string;
  state: StaffHrState;
  masters: MastersState;
  by: string;
}): Promise<{ ok: true; types: number; overrides: number } | { ok: false; error: string }> {
  const existing = await readLeavePolicy(input.ay);
  if (!existing.ok) return { ok: false, error: existing.error };
  if (existing.value) return { ok: false, error: `${input.ay} already has a leave policy` };
  const { sb, tenantId } = await tenant();
  const now = new Date().toISOString();
  const typeRows = input.state.leaveTypes.map((t) => ({
    tenant_id: tenantId,
    academic_year_code: input.ay,
    type_code: t.code,
    default_days: t.paid ? t.defaultDaysPerYear : 0,
    half_day_allowed: true,
    sandwich: false,
    carry_forward_cap: t.paid ? t.maxCarryForward : 0,
    insufficient_mode: "block",
    updated_by: input.by,
    updated_at: now,
  }));
  if (!typeRows.length) return { ok: false, error: "The leave desk has no leave types" };
  const active = new Set((input.masters.staff ?? []).filter((s) => s.status === "active").map((s) => s.id));
  const overrides = input.state.leaveBalances
    .filter((b) => b.academicYearCode === input.ay && active.has(b.staffId))
    .flatMap((b) => {
      const t = input.state.leaveTypes.find((x) => x.code === b.typeCode);
      if (!t || !t.paid || b.allotted === t.defaultDaysPerYear) return [];
      return [
        {
          tenant_id: tenantId,
          academic_year_code: input.ay,
          type_code: b.typeCode,
          staff_id: b.staffId,
          staff_category: null,
          days: Math.max(0, roundHalf(b.allotted)),
          note: "From the desk allotment",
          updated_by: input.by,
          updated_at: now,
        },
      ];
    });
  const t1 = await sb.from("staff_leave_policy_types").insert(typeRows);
  if (t1.error) return { ok: false, error: t1.error.message };
  for (let i = 0; i < overrides.length; i += 500) {
    const r = await sb.from("staff_leave_policy_allocations").insert(overrides.slice(i, i + 500));
    if (r.error) return { ok: false, error: `Types saved; staff allotments failed: ${r.error.message}` };
  }
  return { ok: true, types: typeRows.length, overrides: overrides.length };
}

// ── Year-end carry-forward ───────────────────────────────────────────────

export async function previewCarryForward(input: {
  fromAy: string;
  toAy: string;
  masters: MastersState;
  state: StaffHrState;
}): Promise<Read<CarryPlan>> {
  if (!ISO_AY.test(input.fromAy) || !ISO_AY.test(input.toAy) || input.fromAy >= input.toAy) {
    return { ok: false, error: "Carry runs from a year into a LATER year" };
  }
  const from = await buildLeaveBook({ ay: input.fromAy, masters: input.masters, state: input.state });
  if (!from.ok) return from;
  if (!from.value) return { ok: false, error: `${input.fromAy} has no leave policy — set its carry caps first` };
  const existing = await readCarryInto(input.toAy);
  if (!existing.ok) return existing;
  const names = new Map((input.masters.staff ?? []).map((s) => [s.id, s.fullName]));
  return {
    ok: true,
    value: planCarryForward({
      fromAy: input.fromAy,
      toAy: input.toAy,
      fromPolicy: from.value.policy,
      fromBook: from.value.book,
      existingTo: existing.value,
      staffNames: names,
    }),
  };
}

/**
 * Commit the carry. Recomputed here (never trusted from the browser);
 * insert-only and `on conflict do nothing` on (year, staff, type), so a
 * second press — or two people pressing at once — carries nothing twice.
 */
export async function commitCarryForward(input: {
  fromAy: string;
  toAy: string;
  masters: MastersState;
  state: StaffHrState;
  by: string;
}): Promise<{ ok: true; inserted: number; days: number; already: number } | { ok: false; error: string }> {
  const plan = await previewCarryForward(input);
  if (!plan.ok) return plan;
  if (!plan.value.rows.length) return { ok: true, inserted: 0, days: 0, already: plan.value.alreadyCarried.length };
  const { sb, tenantId } = await tenant();
  const now = new Date().toISOString();
  const rows = plan.value.rows.map((r) => ({
    tenant_id: tenantId,
    from_academic_year_code: r.fromAy,
    to_academic_year_code: r.toAy,
    staff_id: r.staffId,
    type_code: r.typeCode,
    closing_balance: r.closingBalance,
    cap: r.cap,
    days_carried: r.daysCarried,
    committed_by: input.by,
    committed_at: now,
  }));
  let inserted = 0;
  let days = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await sb
      .from("staff_leave_carry_forwards")
      .upsert(rows.slice(i, i + 500), {
        onConflict: "tenant_id,to_academic_year_code,staff_id,type_code",
        ignoreDuplicates: true,
      })
      .select("days_carried");
    if (error) return { ok: false, error: inserted ? `${inserted} carried, then: ${error.message}` : error.message };
    inserted += data?.length ?? 0;
    days += (data ?? []).reduce((s, r) => s + num((r as Record<string, unknown>).days_carried), 0);
  }
  return { ok: true, inserted, days: roundHalf(days), already: plan.value.alreadyCarried.length };
}

// ── Approving under the policy ───────────────────────────────────────────

export type RulesDecision =
  | {
      ok: true;
      state: StaffHrState;
      after: LeaveRequest;
      /** Requests now approved (one, or the paid part + the LWP part). */
      approved: LeaveRequest[];
      /** Said to the approver: "2 days as LWP" etc. */
      notice: string | null;
    }
  | { ok: false; status: number; error: string; needsConfirm?: boolean; check?: ApprovalCheck };

/** The desk's unpaid type to file a shortfall under ("LWP" first). */
function lwpTypeCode(state: StaffHrState): string | null {
  const unpaid = state.leaveTypes.filter((t) => !t.paid);
  return (unpaid.find((t) => t.code === "LWP") ?? unpaid[0])?.code ?? null;
}

/**
 * Decide one request: the approver chain, then (approving) the year's
 * policy — half-day rule, balance with sandwich days, monthly caps — then
 * the desk change. No policy for the year = the desk's own decideLeave,
 * exactly as before. The caller saves `state` (saveStaffHrServer) and marks
 * the register for `approved`.
 *
 * `state` must be the server copy read from the desk (loadStaffHrServer).
 */
export async function decideLeaveWithRules(input: {
  state: StaffHrState;
  masters: MastersState;
  requestId: string;
  approve: boolean;
  note: string;
  decidedBy: string;
  approverStaffId: string;
  isLeadership: boolean;
  /** Approve the over-balance part as LWP without asking again. */
  confirmLwp: boolean;
}): Promise<RulesDecision> {
  const { state } = input;
  const req = state.leaveRequests.find((r) => r.id === input.requestId);
  if (!req) return { ok: false, status: 404, error: "Request not found" };
  if (req.status !== "pending" && req.status !== "pending_l2") {
    return { ok: false, status: 409, error: "Request already decided" };
  }
  if (input.approverStaffId && req.staffId === input.approverStaffId) {
    return { ok: false, status: 403, error: "You cannot decide your own leave" };
  }
  const settings = normalizeLeaveSettings(state.leaveSettings);

  if (!input.isLeadership) {
    const rules = await readApproverRules();
    if (!rules.ok) return { ok: false, status: 503, error: "Could not read the leave approvers — nothing was decided. Try again." };
    const staff = staffLite(input.masters).find((s) => s.id === req.staffId) ?? { id: req.staffId };
    const chain = resolveApprovers(rules.value, staff);
    if (
      !canDecide({ chain, approverStaffId: input.approverStaffId, isLeadership: false, status: req.status, twoLevel: settings.twoLevelApproval })
    ) {
      return {
        ok: false,
        status: 403,
        error: req.status === "pending_l2" ? "This leave now needs the final approver" : "You are not an approver for this member of staff",
      };
    }
  }

  const now = new Date().toISOString();
  const legacy = (): RulesDecision => {
    writeStaffHrLocalRaw(state);
    const res = decideLeave({
      requestId: req.id,
      decision: input.approve ? "approved" : "rejected",
      decidedBy: input.decidedBy,
      decisionNote: input.note,
    });
    if (!res.ok) return { ok: false, status: 400, error: res.error };
    const after = res.state.leaveRequests.find((r) => r.id === req.id) ?? req;
    return { ok: true, state: res.state, after, approved: after.status === "approved" ? [after] : [], notice: null };
  };

  if (!input.approve) return legacy();

  const pol = await readLeavePolicy(req.academicYearCode);
  if (!pol.ok) return { ok: false, status: 503, error: "Could not read the leave policy — nothing was decided. Try again." };
  if (!pol.value) return legacy();

  const ruleErr = validateLeaveAdjustmentRules(state, {
    staffId: req.staffId,
    typeCode: req.typeCode,
    fromDate: req.fromDate,
    toDate: req.toDate,
    days: req.days,
    halfDay: req.halfDay,
    excludeRequestId: req.id,
  });
  if (ruleErr) return { ok: false, status: 400, error: `Cannot approve — ${ruleErr}` };

  const carry = await readCarryInto(req.academicYearCode);
  if (!carry.ok) return { ok: false, status: 503, error: "Could not read the carried-forward leave — nothing was decided. Try again." };
  const staff = staffLite(input.masters).find((s) => s.id === req.staffId) ?? { id: req.staffId, status: "active" };
  const check = checkApproval({
    ay: req.academicYearCode,
    policy: pol.value,
    deskTypes: deskTypesOf(state),
    staff,
    requests: state.leaveRequests,
    carry: carry.value,
    requestId: req.id,
    isOff: nonWorkingFor(input.masters, req.academicYearCode),
  });

  let split: { paidToDate: string | null; lwpFromDate: string; lwpTypeCode: string } | null = null;
  let notice: string | null = null;
  // Level 1 of two never moves a balance; the check runs again at the final step.
  const finalStep = !(settings.twoLevelApproval && req.status === "pending");
  if (!check.ok && finalStep) {
    if (check.reason === "half_day_not_allowed") return { ok: false, status: 400, error: `Cannot approve — ${check.message}`, check };
    if (check.mode === "block" || !check.split) return { ok: false, status: 400, error: `Cannot approve — ${check.message}`, check };
    const lwp = lwpTypeCode(state);
    if (!lwp) return { ok: false, status: 400, error: `Cannot approve — ${check.message}, and there is no unpaid leave type to file the rest under`, check };
    const s = check.split;
    notice = s.paidToDate
      ? `${req.typeCode} ${req.fromDate} to ${s.paidToDate}; ${s.lwpFromDate} to ${req.toDate} as ${lwp} (unpaid)`
      : `All of it as ${lwp} (unpaid) — no ${req.typeCode} left`;
    if (!input.confirmLwp) {
      return { ok: false, status: 409, needsConfirm: true, error: `${check.message}. Approving files ${notice}.`, check };
    }
    split = { ...s, lwpTypeCode: lwp };
  } else if (!check.ok && check.reason === "half_day_not_allowed") {
    return { ok: false, status: 400, error: `Cannot approve — ${check.message}`, check };
  }

  const done = approveOnDesk(state, {
    requestId: req.id,
    decidedBy: input.decidedBy,
    note: input.note,
    now,
    twoLevel: settings.twoLevelApproval,
    split,
  });
  if ("error" in done) return { ok: false, status: 400, error: done.error };
  writeStaffHrLocalRaw(done.state);
  const after = done.state.leaveRequests.find((r) => r.id === req.id) ?? req;
  return { ok: true, state: done.state, after, approved: done.approved, notice };
}

/**
 * Whose leave this approver may see and decide: leadership (as before) —
 * everyone; a named approver — the staff whose chain lists them; anyone
 * else — null (the caller refuses as it did before).
 */
export async function approverReach(input: {
  masters: MastersState;
  approverStaffId: string;
}): Promise<Read<Set<string> | null>> {
  if (!input.approverStaffId) return { ok: true, value: null };
  const rules = await readApproverRules();
  if (!rules.ok) return rules;
  if (!rules.value.some((r) => r.approverStaffId === input.approverStaffId)) return { ok: true, value: null };
  const reach = new Set<string>();
  for (const s of staffLite(input.masters)) {
    const c = resolveApprovers(rules.value, s);
    if (c.level1.includes(input.approverStaffId) || c.level2.includes(input.approverStaffId)) reach.add(s.id);
  }
  return { ok: true, value: reach };
}

/** Approver staff ids to notify for one applicant (empty = the leadership default). */
export async function approversToNotify(masters: MastersState, staffId: string): Promise<string[]> {
  const rules = await readApproverRules();
  if (!rules.ok) return [];
  const s = staffLite(masters).find((x) => x.id === staffId) ?? { id: staffId };
  return resolveApprovers(rules.value, s).level1;
}

/** Book rows of one person (or several), keyed by type — null when the year has no policy or a read failed. */
export async function bookRowsFor(input: {
  ay: string;
  masters: MastersState;
  state: StaffHrState;
}): Promise<Map<string, Map<string, LeaveBookRow>> | null> {
  const res = await buildLeaveBook(input);
  if (!res.ok || !res.value) return null;
  const out = new Map<string, Map<string, LeaveBookRow>>();
  for (const r of res.value.book) {
    const m = out.get(r.staffId) ?? new Map<string, LeaveBookRow>();
    m.set(r.typeCode, r);
    out.set(r.staffId, m);
  }
  return out;
}
