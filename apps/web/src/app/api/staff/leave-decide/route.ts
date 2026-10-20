/**
 * POST /api/staff/leave-decide {id, approve, note?, confirmLwp?} — Staff →
 * Leave → Manage decides on the SERVER, under the year's leave rules
 * (balance with sandwich days, half-day rule, monthly caps, approver level).
 *
 * 409 {needsConfirm} when the balance is short and the type's rule is
 * "approve the rest as LWP" — the screen asks, then sends confirmLwp.
 * A year with no policy decides exactly as the desk always has.
 */

import { NextResponse } from "next/server";
import { requireAnyStaffPermission, requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { writeAudit } from "@/lib/audit.server";
import { readStaffHrServer, saveStaffHrServer } from "@/lib/api/v1/staffLeave";
import { ApiError } from "@/lib/api/v1/errors";
import { decideLeaveWithRules } from "@/lib/staffLeaveRules.server";
import { staffLeaveDecided } from "@/lib/notify/events";
import { notify } from "@/lib/notify/notify.server";

export const runtime = "nodejs";

function bad(error: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

export async function POST(req: Request) {
  // The same people the Manage tab is for (canManageStaffLeave): Staff
  // (change) or the "Leave approvals" function, or Policies (change).
  let auth = await requireStaffPermission(req, "staff", "edit");
  if (!auth.ok) {
    const alt = await requireAnyStaffPermission(req, [{ module: "policies", action: "edit" }]);
    if (!alt.ok) return auth.response;
    auth = alt;
  }
  if (auth.viaMirrorSecret) return bad("Leave is decided by a person", 403);
  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return bad("Invalid JSON");
  }
  const id = String(b.id || "").trim();
  if (!id) return bad("id required");
  const approve = b.approve === true;
  const note = String(b.note || "").trim().slice(0, 300);
  const { ctx } = auth;

  const hr = await readStaffHrServer();
  if (!hr.ok) return bad("Could not read the leave desk — nothing was decided", 503);
  const req0 = hr.state.leaveRequests.find((r) => r.id === id);
  const result = await decideLeaveWithRules({
    state: hr.state,
    masters: ctx.masters,
    requestId: id,
    approve,
    note,
    decidedBy: ctx.session.fullName || "Principal",
    approverStaffId: ctx.session.staffId || "",
    isLeadership: true,
    channel: "web",
    confirmLwp: b.confirmLwp === true,
  });
  if (!result.ok) return bad(result.error, result.status, result.needsConfirm ? { needsConfirm: true } : {});
  try {
    await saveStaffHrServer(result.state);
  } catch (e) {
    return bad(e instanceof ApiError ? e.message : "Could not save — try again", 503);
  }
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
    }).catch((e: unknown) => console.warn("[leave-decide] register mark failed", (e as Error)?.message));
  }
  await writeAudit({
    session: ctx.session,
    module: "staff",
    action: "approve",
    entityType: "staff_leave",
    entityId: id,
    summary: `Staff leave ${result.after.status}: ${req0?.typeCode ?? ""} ${req0?.fromDate ?? ""}${result.notice ? ` (${result.notice})` : ""}`,
    after: { status: result.after.status, note, notice: result.notice },
  });
  if (req0) {
    await notify(
      staffLeaveDecided({
        requestId: id,
        staffId: req0.staffId,
        status: result.after.status,
        typeCode: req0.typeCode,
        fromDate: req0.fromDate,
        toDate: req0.toDate,
        note,
        decidedBy: ctx.session.fullName || "Principal",
      }),
    );
  }
  return NextResponse.json({ ok: true, status: result.after.status, notice: result.notice });
}
