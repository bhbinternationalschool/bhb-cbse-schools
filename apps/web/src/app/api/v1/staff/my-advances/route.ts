import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { fetchDeskSliceFromDb } from "@/lib/deskSliceNormalized.server";
import type { StaffAdvance } from "@/lib/staffAdvance";

export const runtime = "nodejs";

/**
 * GET /api/v1/staff/my-advances — my own salary advances: what was given,
 * each recovery (from salary or returned), and what is still outstanding.
 * Read straight from the desk rows; only the signed-in member's advances.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const staffId = ctx.session.persona === "staff" ? ctx.session.staffId || "" : "";
    if (!staffId) throw new ApiError("forbidden", "Sign in with your staff login", 403);
    const read = await fetchDeskSliceFromDb("staff_advances");
    if (!read.ok) {
      // Unknown is not "no advances".
      throw new ApiError("server_error", "Could not read advances just now — try again", 503);
    }
    const all = (Array.isArray(read.bundle.advances) ? read.bundle.advances : []) as StaffAdvance[];
    const mine = all
      .filter((a) => a.staffId === staffId)
      .map((a) => {
        const recoveries = (a.recoveries ?? []).map((r) => ({
          month: r.month,
          method: r.method,
          amount: r.amount,
          recoveredAt: r.recoveredAt,
          note: r.note,
        }));
        const recovered = recoveries.reduce((n, r) => n + (r.amount || 0), 0);
        return {
          id: a.id,
          amount: a.amount,
          givenDate: a.givenDate,
          note: a.note,
          status: a.status,
          recovered,
          outstanding: Math.max(0, (a.amount || 0) - recovered),
          recoveries,
        };
      })
      .sort((x, y) => y.givenDate.localeCompare(x.givenDate));
    return apiOk({
      staffId,
      outstanding: mine.reduce((n, a) => n + a.outstanding, 0),
      advances: mine,
    });
  } catch (e) {
    return apiErr(e);
  }
}
