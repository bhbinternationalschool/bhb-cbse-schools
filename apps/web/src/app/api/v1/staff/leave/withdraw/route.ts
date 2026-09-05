import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { loadStaffHrServer, saveStaffHrServer } from "@/lib/api/v1/staffLeave";

export const runtime = "nodejs";

/** POST /api/v1/staff/leave/withdraw {id} — withdraw one's own pending request. */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    const staffId = ctx.session.staffId || "";
    const body = (await request.json().catch(() => ({}))) as { id?: string };
    const id = (body.id || "").trim();
    if (!id) throw new ApiError("bad_request", "id required", 400);

    const state = await loadStaffHrServer();
    const req = state.leaveRequests.find((r) => r.id === id);
    if (!req) throw new ApiError("not_found", "Request not found", 404);
    if (req.staffId !== staffId) {
      throw new ApiError("forbidden", "Not your request", 403);
    }
    if (req.status !== "pending" && req.status !== "pending_l2") {
      throw new ApiError("bad_request", "Only a pending request can be withdrawn", 400);
    }
    const next = {
      ...state,
      leaveRequests: state.leaveRequests.filter((r) => r.id !== id),
    };
    await saveStaffHrServer(next);

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "staff",
      action: "edit",
      entityType: "staff_leave",
      entityId: id,
      summary: `Leave request withdrawn: ${req.typeCode} ${req.fromDate}`,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return apiOk({ id, withdrawn: true });
  } catch (e) {
    return apiErr(e);
  }
}
