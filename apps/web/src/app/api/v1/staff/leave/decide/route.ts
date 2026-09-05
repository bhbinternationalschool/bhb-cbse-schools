import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import {
  assertLeaveApprover,
  leaveRequestJson,
  loadStaffHrServer,
  saveStaffHrServer,
} from "@/lib/api/v1/staffLeave";
import { decideLeave } from "@/lib/staffHr";
import { sendPushToSubject } from "@/lib/webPush.server";

export const runtime = "nodejs";

type Body = { id?: string; approve?: boolean; note?: string };

/** POST /api/v1/staff/leave/decide {id, approve, note} — principal decides. */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    await assertLeaveApprover(ctx);
    const body = (await request.json().catch(() => ({}))) as Body;
    const id = (body.id || "").trim();
    if (!id) throw new ApiError("bad_request", "id required", 400);
    const approve = !!body.approve;
    const note = (body.note || "").trim().slice(0, 300);

    const before = await loadStaffHrServer();
    const req = before.leaveRequests.find((r) => r.id === id);
    if (!req) throw new ApiError("not_found", "Request not found", 404);
    if (req.staffId === ctx.session.staffId) {
      throw new ApiError("forbidden", "You cannot decide your own leave", 403);
    }

    const result = decideLeave({
      requestId: id,
      decision: approve ? "approved" : "rejected",
      decidedBy: ctx.session.fullName || "Principal",
      decisionNote: note,
    });
    if (!result.ok) throw new ApiError("bad_request", result.error, 400);
    await saveStaffHrServer(result.state);
    const after = result.state.leaveRequests.find((r) => r.id === id) || req;

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "staff",
      action: "approve",
      entityType: "staff_leave",
      entityId: id,
      summary: `Staff leave ${after.status}: ${req.typeCode} ${req.fromDate} for ${leaveRequestJson(ctx, req, before).staffName}`,
      after: { status: after.status, note },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    const label = req.fromDate === req.toDate ? req.fromDate : `${req.fromDate} to ${req.toDate}`;
    await sendPushToSubject("staff", req.staffId, {
      title:
        after.status === "approved"
          ? "Leave approved"
          : after.status === "pending_l2"
            ? "Leave cleared at level 1"
            : "Leave not approved",
      body: `${req.typeCode} ${label}${note ? ` · ${note}` : ""}`,
      url: "/leave",
      data: { kind: "staff_leave_decision", requestId: id, status: after.status },
    }).catch(() => undefined);

    return apiOk(leaveRequestJson(ctx, after, result.state));
  } catch (e) {
    return apiErr(e);
  }
}
