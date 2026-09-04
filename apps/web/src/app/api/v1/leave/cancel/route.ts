import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { requireParentHousehold } from "@/lib/api/v1/household";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import {
  ensureStudentLeaveHydratedServer,
  pushStudentLeaveRemoteServer,
} from "@/lib/studentLeavePersistence";
import {
  emptyStudentLeaveState,
  loadStudentLeave,
  writeStudentLeaveLocalRaw,
} from "@/lib/studentLeave";

export const runtime = "nodejs";

/**
 * POST /api/v1/leave/cancel {id} — a parent withdraws a request that is
 * still pending. Decided requests are not touched; the office owns those.
 *
 * Done by hand rather than through cancelStudentLeaveRequest, whose save
 * is a no-op on the server and which does not hand back the changed state.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);
    const body = (await request.json().catch(() => ({}))) as { id?: string };
    const id = (body.id ?? "").trim();
    if (!id) throw new ApiError("bad_request", "id required", 400);

    await ensureSchoolMirrorHydrated();
    writeStudentLeaveLocalRaw(emptyStudentLeaveState());
    await ensureStudentLeaveHydratedServer();

    const state = loadStudentLeave();
    const i = state.requests.findIndex((r) => r.id === id);
    if (i < 0) throw new ApiError("not_found", "Request not found", 404);
    const req = state.requests[i]!;
    if (req.householdId !== householdId) {
      throw new ApiError("forbidden", "Not your request", 403);
    }
    if (req.status !== "pending") {
      throw new ApiError(
        "bad_request",
        "Only a pending request can be cancelled",
        400,
      );
    }

    const requests = [...state.requests];
    requests[i] = { ...req, status: "cancelled" };
    const next = { ...state, requests };
    writeStudentLeaveLocalRaw(next);
    const pushed = await pushStudentLeaveRemoteServer(next);
    if (!pushed.ok) {
      console.warn("[leave-v1] db push failed", pushed.error);
      throw new ApiError("server_error", "Could not save — try again", 503);
    }

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "student_leave",
      action: "edit",
      entityType: "leave_request",
      entityId: id,
      summary: `Leave request cancelled by parent (${req.fromDate})`,
      before: { status: "pending" },
      after: { status: "cancelled" },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return apiOk({ id, status: "cancelled" });
  } catch (e) {
    return apiErr(e);
  }
}
