import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import {
  leaveApproverAccess,
  leaveRequestJson,
  loadStaffHrServer,
  saveStaffHrServer,
} from "@/lib/api/v1/staffLeave";
import { decideLeaveWithRules } from "@/lib/staffLeaveRules.server";
import { staffLeaveDecided } from "@/lib/notify/events";
import { notify } from "@/lib/notify/notify.server";

export const runtime = "nodejs";

type Body = { id?: string; approve?: boolean; note?: string };

/**
 * POST /api/v1/staff/leave/decide {id, approve, note} — the principal (or a
 * named leave approver for that member of staff) decides. The year's leave
 * rules apply; a short balance under an "LWP" rule is refused here with a
 * message to decide it on the web (where the approver confirms the split).
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    const access = await leaveApproverAccess(ctx);
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
    if (!access.leadership && !access.reach.has(req.staffId)) {
      throw new ApiError("forbidden", "You are not an approver for this member of staff", 403);
    }

    const result = await decideLeaveWithRules({
      state: before,
      masters: ctx.masters,
      requestId: id,
      approve,
      note,
      decidedBy: ctx.session.fullName || "Principal",
      approverStaffId: ctx.session.staffId || "",
      isLeadership: access.leadership,
      // The app never files unpaid leave on its own: a short balance under
      // an "LWP" rule is refused with "decide it on the web".
      channel: "app",
      confirmLwp: false,
    });
    if (!result.ok) {
      throw new ApiError(
        result.status === 403 ? "forbidden" : result.status === 503 ? "server_error" : result.status === 404 ? "not_found" : "bad_request",
        result.error,
        result.status === 409 ? 400 : result.status,
      );
    }
    await saveStaffHrServer(result.state);
    const after = result.after;
    // Same as approving on WhatsApp: a register that already exists for the
    // leave's days shows it now, not at the next punch. A half day stays
    // "A" until the other half is punched (halfDayLeaveMark).
    const { markApprovedLeaveOnRegisters } = await import("@/lib/staffAttendance.server");
    for (const part of result.approved) {
      await markApprovedLeaveOnRegisters({
        staffId: part.staffId,
        fromDate: part.fromDate,
        toDate: part.toDate,
        halfDay: part.halfDay,
        halfDaySession: part.halfDaySession,
        typeCode: part.typeCode,
        by: `Leave approved by ${ctx.session.fullName || "Principal"}`,
      }).catch((e: unknown) => console.warn("[leave decide] register mark failed", (e as Error)?.message));
    }

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

    await notify(
      staffLeaveDecided({
        requestId: id,
        staffId: req.staffId,
        status: after.status,
        typeCode: req.typeCode,
        fromDate: req.fromDate,
        toDate: req.toDate,
        note,
        decidedBy: ctx.session.fullName || "Principal",
      }),
    );

    return apiOk(leaveRequestJson(ctx, after, result.state));
  } catch (e) {
    return apiErr(e);
  }
}
