import type { ApiAuthContext } from "@/lib/api/v1/auth";
import { ApiError } from "@/lib/api/v1/errors";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import {
  ensureStaffHrHydratedServer,
  pushStaffHrRemoteServer,
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

export async function saveStaffHrServer(state: StaffHrState): Promise<void> {
  const pushed = await pushStaffHrRemoteServer(state);
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
