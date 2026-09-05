import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import {
  assertLeaveApprover,
  balancesFor,
  leaveRequestJson,
  loadStaffHrServer,
} from "@/lib/api/v1/staffLeave";

export const runtime = "nodejs";

/**
 * GET /api/v1/staff/leave/approvals?status=pending|decided — the school's
 * staff leave queue for the principal / director / admin, each request
 * with the applicant's remaining balance of that type.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    await assertLeaveApprover(ctx);
    const url = new URL(request.url);
    const which = url.searchParams.get("status") === "decided" ? "decided" : "pending";
    const ay = ctx.session.academicYearCode;

    let state = await loadStaffHrServer();
    const rows = state.leaveRequests
      .filter((r) =>
        which === "pending"
          ? r.status === "pending" || r.status === "pending_l2"
          : r.status === "approved" || r.status === "rejected",
      )
      .sort((a, b) => b.appliedAt.localeCompare(a.appliedAt))
      .slice(0, which === "pending" ? 200 : 60)
      .map((r) => {
        const { state: next, balances } = balancesFor(state, r.staffId, ay);
        state = next;
        const bal = balances.find((b) => b.typeCode === r.typeCode);
        const staff = ctx.masters.staff.find((s) => s.id === r.staffId);
        const des = ctx.masters.designations.find((d) => d.id === staff?.designationId);
        return {
          ...leaveRequestJson(ctx, r, state),
          designation: des?.name || "",
          remaining: bal?.remaining ?? null,
          unlimited: bal?.unlimited ?? false,
        };
      });

    return apiOk({ status: which, requests: rows });
  } catch (e) {
    return apiErr(e);
  }
}
