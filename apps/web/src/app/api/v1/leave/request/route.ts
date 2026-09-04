import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { childOfHousehold, requireParentHousehold } from "@/lib/api/v1/household";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import {
  ensureStudentLeaveHydratedServer,
  pushStudentLeaveRemoteServer,
} from "@/lib/studentLeavePersistence";
import {
  emptyStudentLeaveState,
  createStudentLeaveRequest,
  leaveDayCount,
  leaveTypeLabel,
  loadStudentLeave,
  STUDENT_LEAVE_TYPES,
  writeStudentLeaveLocalRaw,
  type StudentLeaveType,
} from "@/lib/studentLeave";
import { loadSis } from "@/lib/sis";

export const runtime = "nodejs";

type Body = {
  studentId?: string;
  fromDate?: string;
  toDate?: string;
  leaveType?: string;
  reason?: string;
};

const TYPE_CODES = new Set<string>(STUDENT_LEAVE_TYPES.map((t) => t.code));
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/v1/leave/request — a parent asks for leave for their child.
 *
 * createStudentLeaveRequest validates and builds the request, but its
 * save is a no-op on the server (localStorage-first design), so the new
 * request is folded into the server cache here and pushed to the database
 * — the same shape as /api/v1/ptm/book. It lands as "pending" for the class
 * teacher or principal to decide on the desk, exactly as a web-portal
 * request does.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);

    const body = (await request.json().catch(() => ({}))) as Body;
    const studentId = (body.studentId ?? "").trim();
    const fromDate = (body.fromDate ?? "").trim();
    const toDate = (body.toDate ?? "").trim() || fromDate;
    const leaveType = (body.leaveType ?? "").trim();
    const reason = (body.reason ?? "").trim();
    if (!studentId) throw new ApiError("bad_request", "studentId required", 400);
    if (!ISO_DAY.test(fromDate) || !ISO_DAY.test(toDate)) {
      throw new ApiError("bad_request", "Dates must be YYYY-MM-DD", 400);
    }
    if (!TYPE_CODES.has(leaveType)) {
      throw new ApiError("bad_request", "Unknown leave type", 400);
    }
    if (reason.length > 500) {
      throw new ApiError("bad_request", "Reason is too long (500 characters)", 400);
    }

    await ensureSchoolMirrorHydrated();
    const sis = loadSis();
    const student = childOfHousehold(sis, studentId, householdId);

    writeStudentLeaveLocalRaw(emptyStudentLeaveState());
    await ensureStudentLeaveHydratedServer();

    const result = createStudentLeaveRequest({
      academicYearCode: ctx.session.academicYearCode || student.academicYearCode,
      studentId,
      fromDate,
      toDate,
      leaveType: leaveType as StudentLeaveType,
      reason,
      requestedBy: ctx.session.fullName || "Parent",
      householdId,
    });
    if (!result.ok) throw new ApiError("bad_request", result.error, 400);

    const prior = loadStudentLeave();
    const state = prior.requests.some((r) => r.id === result.request.id)
      ? prior
      : { ...prior, requests: [result.request, ...prior.requests] };
    writeStudentLeaveLocalRaw(state);
    const pushed = await pushStudentLeaveRemoteServer(state);
    if (!pushed.ok) {
      console.warn("[leave-v1] db push failed", pushed.error);
      throw new ApiError("server_error", "Could not save the request — try again", 503);
    }

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "student_leave",
      action: "edit",
      entityType: "leave_request",
      entityId: result.request.id,
      summary: `Leave requested for ${student.fullName}: ${leaveTypeLabel(
        result.request.leaveType,
      )} ${fromDate}${toDate !== fromDate ? ` to ${toDate}` : ""}`,
      after: { studentId, fromDate, toDate, leaveType },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    const r = result.request;
    return apiOk({
      id: r.id,
      status: r.status,
      days: leaveDayCount(r),
      leaveTypeLabel: leaveTypeLabel(r.leaveType),
      createdAt: r.createdAt,
    });
  } catch (e) {
    return apiErr(e);
  }
}
