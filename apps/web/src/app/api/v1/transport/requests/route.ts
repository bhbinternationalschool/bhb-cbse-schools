import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { listTransportRequests, type TransportRequestStatus } from "@/lib/transportRequests.server";

export const runtime = "nodejs";

/**
 * GET /api/v1/transport/requests?status=active|open|contacted|assigned|declined
 * The office's queue — staff with transport.view (owner, admin, principal,
 * transport role). Default: the active ones (open + contacted).
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") throw new ApiError("forbidden", "Staff session required", 403);
    assertPermission(ctx, "transport", "view");
    const raw = new URL(request.url).searchParams.get("status") || "active";
    const status = (["active", "open", "contacted", "assigned", "declined"].includes(raw)
      ? raw
      : "active") as TransportRequestStatus | "active";
    const requests = await listTransportRequests({ status });
    if (!requests) throw new ApiError("server_error", "Requests are unavailable right now", 503);
    return apiOk({ requests, status });
  } catch (e) {
    return apiErr(e);
  }
}
