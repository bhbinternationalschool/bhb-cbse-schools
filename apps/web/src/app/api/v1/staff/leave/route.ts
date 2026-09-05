import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import {
  balancesFor,
  leaveRequestJson,
  loadStaffHrServer,
} from "@/lib/api/v1/staffLeave";
import { normalizeLeaveSettings } from "@/lib/staffHr";

export const runtime = "nodejs";

/**
 * GET /api/v1/staff/leave — the signed-in staff member's leave: this year's
 * balances per type, and their requests newest first.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    const staffId = ctx.session.staffId || "";
    if (!staffId) {
      throw new ApiError("bad_request", "No staff record on this session", 400);
    }
    const ay = ctx.session.academicYearCode;
    const state = await loadStaffHrServer();
    const { state: withBalances, balances } = balancesFor(state, staffId, ay);
    const settings = normalizeLeaveSettings(state.leaveSettings);

    const requests = withBalances.leaveRequests
      .filter((r) => r.staffId === staffId)
      .sort((a, b) => b.appliedAt.localeCompare(a.appliedAt))
      .map((r) => leaveRequestJson(ctx, r, withBalances));

    return apiOk({
      staffId,
      academicYearCode: ay,
      autoApprove: settings.autoApproveLeaves,
      balances,
      requests,
    });
  } catch (e) {
    return apiErr(e);
  }
}
