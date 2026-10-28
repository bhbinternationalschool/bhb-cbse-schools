import type { ApiAuthContext } from "@/lib/api/v1/auth";
import { ApiError } from "@/lib/api/v1/errors";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import {
  ensureStaffHrHydratedServer,
  pushStaffHrRemoteServer,
  staffHrServerCopyIsFromDesk,
} from "@/lib/staffHrPersistence";
import {
  ensureBalancesForAy,
  loadStaffHr,
  remainingBalance,
  type LeaveRequest,
  type StaffHrState,
} from "@/lib/staffHr";
import type { StaffRecord } from "@/lib/foundationMasters";
import { staffSectionScope } from "@/lib/api/v1/staffScope";

/** Hydrate the HR desk into the server cache and hand back the state. */
export async function loadStaffHrServer(): Promise<StaffHrState> {
  await ensureSchoolMirrorHydrated();
  await ensureStaffHrHydratedServer();
  return loadStaffHr();
}

/**
 * loadStaffHrServer for readers that must say "unknown" rather than "none"
 * when the desk could not be read — the LEAVE list and the 6 PM brief. It is
 * also the guard on deciding: a state that did not come from the desk must
 * never be saved back over it.
 */
export async function readStaffHrServer(): Promise<
  { ok: true; state: StaffHrState } | { ok: false }
> {
  await ensureSchoolMirrorHydrated();
  const deskRead = await ensureStaffHrHydratedServer().catch(() => false);
  return deskRead ? { ok: true, state: loadStaffHr() } : { ok: false };
}

export async function saveStaffHrServer(
  state: StaffHrState,
  /** Rows this save removes — say them: the desk merges leave requests. */
  opts?: { deletes?: { leaveRequests?: string[] } },
): Promise<void> {
  // Unknown is not empty: a state built on a failed desk read (the legacy
  // blob, or nothing) would be pushed over the school's leave desk.
  if (!staffHrServerCopyIsFromDesk()) {
    console.error("[staff-leave-v1] refusing to save: the leave desk could not be read");
    throw new ApiError("server_error", "Could not read the leave desk — nothing was saved. Try again.", 503);
  }
  const pushed = await pushStaffHrRemoteServer(state, opts);
  if (!pushed.ok) {
    console.warn("[staff-leave-v1] desk push failed", pushed.error);
    throw new ApiError("server_error", "Could not save — try again", 503);
  }
}

export function leaveRequestJson(
  ctx: ApiAuthContext,
  r: LeaveRequest,
  state: StaffHrState,
) {
  const type = state.leaveTypes.find((t) => t.code === r.typeCode);
  const staff = ctx.masters.staff.find((s) => s.id === r.staffId);
  return {
    id: r.id,
    staffId: r.staffId,
    staffName: staff?.fullName || r.staffId,
    typeCode: r.typeCode,
    typeName: type?.name || r.typeCode,
    paid: type?.paid ?? true,
    fromDate: r.fromDate,
    toDate: r.toDate,
    days: r.days,
    halfDay: r.halfDay,
    halfDaySession: r.halfDay ? r.halfDaySession || "" : "",
    reason: r.reason,
    status: r.status,
    statusLabel:
      r.status === "pending_l2"
        ? "Awaiting final approval"
        : r.status.charAt(0).toUpperCase() + r.status.slice(1),
    appliedAt: r.appliedAt,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt,
    decisionNote: r.decisionNote,
  };
}

/** Balances for one staff member this year, creating rows as the desk would. */
export function balancesFor(
  state: StaffHrState,
  staffId: string,
  ay: string,
): { state: StaffHrState; balances: Record<string, unknown>[] } {
  const next = ensureBalancesForAy(
    state,
    [{ id: staffId, status: "active" } as StaffRecord],
    ay,
  );
  const balances = next.leaveTypes.map((t) => {
    const b = next.leaveBalances.find(
      (x) => x.staffId === staffId && x.typeCode === t.code && x.academicYearCode === ay,
    );
    return {
      typeCode: t.code,
      typeName: t.name,
      paid: t.paid,
      allotted: b?.allotted ?? t.defaultDaysPerYear,
      used: b?.used ?? 0,
      remaining: b ? remainingBalance(b) : t.defaultDaysPerYear,
      unlimited: t.defaultDaysPerYear === 0,
      maxDaysPerRequest: t.maxDaysPerRequest,
      maxDaysPerMonth: t.maxDaysPerMonth,
    };
  });
  return { state: next, balances };
}

/** Leadership (and office) may decide leave; anyone else is refused. */
export async function assertLeaveApprover(ctx: ApiAuthContext): Promise<void> {
  const scope = await staffSectionScope(ctx);
  if (scope.kind === "leadership") return;
  if (scope.unrestricted && scope.kind !== "office") return;
  throw new ApiError(
    "forbidden",
    "Only the principal, director or admin can decide staff leave",
    403,
  );
}

/**
 * Who may use the staff app's leave approvals: leadership (and the office
 * holders assertLeaveApprover lets through) for everyone, as before; a
 * named leave approver (Staff → Leave rules → Approvers) for the staff whose
 * chain lists them. Anyone else gets the same 403 as before.
 */
export async function leaveApproverAccess(
  ctx: ApiAuthContext,
): Promise<{ leadership: true } | { leadership: false; reach: Set<string> }> {
  try {
    await assertLeaveApprover(ctx);
    return { leadership: true };
  } catch (refused) {
    const { approverReach } = await import("@/lib/staffLeaveRules.server");
    const reach = await approverReach({ masters: ctx.masters, approverStaffId: ctx.session.staffId || "" });
    if (!reach.ok) {
      throw new ApiError("server_error", "Could not read the leave approvers — try again", 503);
    }
    if (!reach.value || reach.value.size === 0) throw refused;
    return { leadership: false, reach: reach.value };
  }
}

/**
 * The year's leave-rule balances over the desk numbers, for the staff app:
 * same fields (allotted / used / remaining), worked out by the policy —
 * sandwich days, half days, carried-in leave — plus `opening`, `pending`
 * and `halfDayAllowed`. A year with no policy, or a failed read, leaves the
 * desk numbers as they were.
 */
export async function withPolicyBalances(
  ctx: ApiAuthContext,
  state: StaffHrState,
  ay: string,
  balances: Record<string, unknown>[],
  staffId: string,
): Promise<Record<string, unknown>[]> {
  const { bookRowsFor, readLeavePolicy } = await import("@/lib/staffLeaveRules.server");
  const rows = await bookRowsFor({ ay, masters: ctx.masters, state });
  const mine = rows?.get(staffId);
  if (!mine) return balances;
  const pol = await readLeavePolicy(ay);
  return balances.map((b) => {
    const r = mine.get(String(b.typeCode));
    const pt = pol.ok ? pol.value?.types.find((t) => t.typeCode === b.typeCode) : undefined;
    if (!r || !r.governed) return { ...b, halfDayAllowed: pt?.halfDayAllowed ?? true };
    return {
      ...b,
      allotted: r.allocated,
      opening: r.opening,
      used: r.taken,
      pending: r.pending,
      remaining: Math.max(0, r.balance),
      unlimited: false,
      halfDayAllowed: pt?.halfDayAllowed ?? true,
    };
  });
}
