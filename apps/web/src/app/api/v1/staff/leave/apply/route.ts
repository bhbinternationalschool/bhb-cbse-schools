import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import {
  leaveRequestJson,
  loadStaffHrServer,
  saveStaffHrServer,
} from "@/lib/api/v1/staffLeave";
import { applyLeave, loadStaffHr } from "@/lib/staffHr";
import { leadershipStaffIds } from "@/lib/staffHomeKind.server";
import { sendPushToSubjects } from "@/lib/webPush.server";

export const runtime = "nodejs";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

type Body = {
  typeCode?: string;
  fromDate?: string;
  toDate?: string;
  halfDay?: boolean;
  reason?: string;
};

/**
 * POST /api/v1/staff/leave/apply — a staff member asks for leave. Same
 * validation the HR desk runs (balance, per-request and monthly caps);
 * lands as pending for the principal unless HR has auto-approve on.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    const staffId = ctx.session.staffId || "";
    if (!staffId) {
      throw new ApiError("bad_request", "No staff record on this session", 400);
    }
    const body = (await request.json().catch(() => ({}))) as Body;
    const typeCode = (body.typeCode || "").trim().toUpperCase();
    const fromDate = (body.fromDate || "").trim();
    const halfDay = !!body.halfDay;
    const toDate = halfDay ? fromDate : (body.toDate || "").trim() || fromDate;
    const reason = (body.reason || "").trim();
    if (!typeCode) throw new ApiError("bad_request", "Choose a leave type", 400);
    if (!ISO_DAY.test(fromDate) || !ISO_DAY.test(toDate)) {
      throw new ApiError("bad_request", "Dates must be YYYY-MM-DD", 400);
    }
    if (reason.length < 3) {
      throw new ApiError("bad_request", "Give a short reason", 400);
    }
    if (reason.length > 500) {
      throw new ApiError("bad_request", "Reason is too long (500 characters)", 400);
    }

    await loadStaffHrServer();
    const result = applyLeave({
      academicYearCode: ctx.session.academicYearCode,
      staffId,
      typeCode,
      fromDate,
      toDate,
      halfDay,
      reason,
      appliedBy: ctx.session.fullName || "Staff",
    });
    if (!result.ok) throw new ApiError("bad_request", result.error, 400);
    await saveStaffHrServer(result.state);

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "staff",
      action: "edit",
      entityType: "staff_leave",
      entityId: result.request.id,
      summary: `Leave applied: ${typeCode} ${fromDate}${toDate !== fromDate ? ` to ${toDate}` : ""}${halfDay ? " (half day)" : ""}`,
      after: { typeCode, fromDate, toDate, halfDay },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    if (result.request.status === "pending") {
      const approvers = leadershipStaffIds(ctx.masters).filter((id) => id !== staffId);
      await sendPushToSubjects("staff", approvers, {
        title: `Leave request · ${ctx.session.fullName}`,
        body: `${typeCode} ${fromDate}${toDate !== fromDate ? ` to ${toDate}` : ""} · ${reason.slice(0, 80)}`,
        url: "/leave-approvals",
        data: { kind: "staff_leave", requestId: result.request.id },
      }).catch(() => undefined);
    }

    return apiOk(leaveRequestJson(ctx, result.request, loadStaffHr()));
  } catch (e) {
    return apiErr(e);
  }
}
