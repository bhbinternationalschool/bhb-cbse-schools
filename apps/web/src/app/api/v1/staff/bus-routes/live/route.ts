import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import { buildBusRoutesLive } from "@/lib/busRoutesLive.server";

export const runtime = "nodejs";

/**
 * GET /api/v1/staff/bus-routes/live[?routeId=…]
 *
 * Per active route: the vehicle, its last Fleet Edge fix (with age and a
 * stale flag), the run on the road now (or none — off-shift), the stops in
 * the order this run visits them, which were passed and when, and estimated
 * arrival times for the rest. Same position source as the web Live map.
 *
 * Office and leadership see every bus; a driver sees only their own (the bus
 * register's crew scope). A failed position read is a 503, never "no bus".
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertMobileFeature(ctx, "route_manifest");
    assertPermission(ctx, "transport", "view");
    const routeId = new URL(request.url).searchParams.get("routeId")?.trim() || undefined;
    const live = await buildBusRoutesLive(ctx, { routeId });
    return apiOk(live);
  } catch (e) {
    return apiErr(e);
  }
}
