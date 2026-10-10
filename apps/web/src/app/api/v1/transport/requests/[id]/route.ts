import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import {
  TRANSPORT_REQUEST_STATUSES,
  updateTransportRequest,
  type TransportRequestStatus,
} from "@/lib/transportRequests.server";

export const runtime = "nodejs";

/** POST /api/v1/transport/requests/:id {status, note} — the office moves a request along. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") throw new ApiError("forbidden", "Staff session required", 403);
    assertPermission(ctx, "transport", "edit");
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { status?: string; note?: string };
    const status = String(body.status || "");
    if (!TRANSPORT_REQUEST_STATUSES.includes(status as TransportRequestStatus)) {
      throw new ApiError("bad_request", "Unknown status", 400);
    }
    const updated = await updateTransportRequest({
      id,
      status: status as TransportRequestStatus,
      handlingNote: String(body.note || "").slice(0, 500),
      handledBy: ctx.session.fullName || ctx.session.email || "Office",
    });
    if (!updated.ok) {
      throw new ApiError(updated.error === "Request not found" ? "not_found" : "server_error", updated.error, updated.error === "Request not found" ? 404 : 503);
    }
    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "transport",
      action: "edit",
      entityType: "transport_request",
      entityId: id,
      summary: `Transport request for ${updated.request.studentName} marked ${status}`,
      after: { status, note: updated.request.handlingNote },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return apiOk({ request: updated.request });
  } catch (e) {
    return apiErr(e);
  }
}
