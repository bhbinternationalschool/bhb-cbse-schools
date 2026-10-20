/**
 * GET /api/payments/parent-dues — the signed-in parent's own fee page: their
 * children, every fee line owing and paid (bus months included) and their
 * receipts, computed on the server.
 *
 * The household is the session's, never the caller's: a `householdId` that is
 * not the session's own is refused (403), and anything but a parent session
 * is refused. Sits beside parent-checkout so the figure a parent is shown and
 * the figure the checkout charges come from one recomputation
 * (lib/parentFeeCheckout.server.ts).
 */
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { ApiError, apiErr, apiOk } from "@/lib/api/v1/errors";
import { requireParentHousehold } from "@/lib/api/v1/household";
import { readParentFees } from "@/lib/parentFeeCheckout.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);
    const asked = new URL(request.url).searchParams.get("householdId")?.trim();
    if (asked && asked !== householdId) {
      throw new ApiError("forbidden", "Not your household", 403);
    }
    const read = await readParentFees(householdId);
    if (!read.ok) {
      throw new ApiError(read.status === 404 ? "not_found" : "server_error", read.error, read.status);
    }
    return apiOk(read.view, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return apiErr(e);
  }
}
