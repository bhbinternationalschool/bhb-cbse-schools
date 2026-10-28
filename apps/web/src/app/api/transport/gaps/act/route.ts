/**
 * POST /api/transport/gaps/act  { id }
 *
 * Carries out the action on one audit suggestion — the one-tap buttons in
 * Transport → Gaps to settle:
 *
 *  - move_rider: the child boards at the suggested stop (on their own bus or
 *    another). The assignment is edited in place so its billing history and
 *    due keys stay as they are, and its monthly fee is fixed at what the
 *    child paid before the move — the fee does not change. Refused if the
 *    child's record moved since the suggestion, the target stop is gone, or
 *    today's fee no longer matches.
 *  - use_run_order: the driver's list for that run follows the suggested order.
 *
 * Every action is written to the audit log with before and after, and the
 * suggestion row records who pressed it and what happened.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { writeAudit } from "@/lib/audit.server";
import { requestMeta } from "@/lib/api/v1/auth";
import { casWriteSlice } from "@/lib/sliceCas.server";
import { rowRev } from "@/lib/sliceRevMerge";
import { deskBundleToTransportState, fetchTransportDeskFromDb } from "@/lib/transportNormalized.server";
import { expectedMonthlyFeePaise } from "@/lib/transport";

export const runtime = "nodejs";

type MoveAction = {
  type: "move_rider";
  assignmentId: string;
  fromRouteId: string;
  fromStopId: string;
  toRouteId: string;
  toStopId: string;
  keepFeePaise: number;
};
type OrderAction = { type: "use_run_order"; runOrderId: string; order: string[] };

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "edit");
  if (!auth.ok) return auth.response;
  let body: { id?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const ctx = await getServerTenantContext();
  if (!ctx) return NextResponse.json({ error: "Server tenant context unavailable" }, { status: 503 });
  const { sb, tenantId } = ctx;
  const { data: row, error } = await sb
    .from("transport_desk_gaps")
    .select("id, title, status, action, action_done_at")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  if (!row) return NextResponse.json({ error: "No such suggestion" }, { status: 404 });
  const r = row as { id: string; title: string; status: string; action: Record<string, unknown> | null; action_done_at: string | null };
  if (r.action_done_at) return NextResponse.json({ error: "Already done" }, { status: 409 });
  if (r.status !== "open") return NextResponse.json({ error: "This suggestion is closed" }, { status: 409 });
  const action = r.action;
  if (!action || typeof action.type !== "string") return NextResponse.json({ error: "This item has no action" }, { status: 400 });

  const by = auth.ctx.session.fullName || auth.ctx.session.email || "";
  const now = new Date().toISOString();
  let result = "";
  let before: unknown = null;
  let after: unknown = null;

  if (action.type === "move_rider") {
    const a = action as unknown as MoveAction;
    const desk = await fetchTransportDeskFromDb();
    if (!desk.ok) return NextResponse.json({ error: "Could not read the transport desk — nothing changed" }, { status: 502 });
    const state = deskBundleToTransportState(desk.bundle);
    const asg = state.assignments.find((x) => x.id === a.assignmentId);
    const toRoute = state.routes.find((x) => x.id === a.toRouteId && x.isActive !== false);
    const toStop = toRoute?.stops.find((s) => s.id === a.toStopId);
    if (!asg || asg.effectiveTo != null) return NextResponse.json({ error: "The child's transport has ended — nothing changed" }, { status: 409 });
    if (asg.routeId !== a.fromRouteId || asg.stopId !== a.fromStopId) {
      return NextResponse.json({ error: "The child's bus or stop was changed since this was suggested — nothing changed" }, { status: 409 });
    }
    if (!toRoute || !toStop) return NextResponse.json({ error: "The suggested stop no longer exists — nothing changed" }, { status: 409 });
    const fromRoute = state.routes.find((x) => x.id === asg.routeId);
    const fromStop = fromRoute?.stops.find((s) => s.id === asg.stopId);
    const feeNow =
      asg.monthlyFeePaise > 0 ? asg.monthlyFeePaise : fromRoute && fromStop ? expectedMonthlyFeePaise(fromRoute, fromStop, state.feePolicy) : 0;
    if (!(feeNow > 0) || feeNow !== a.keepFeePaise) {
      return NextResponse.json({ error: "The child's fee changed since this was suggested — nothing changed. Run the audit again." }, { status: 409 });
    }

    let landed = false;
    const written = await casWriteSlice(sb, "transport_desk_slices", tenantId, "assignments", (stored) => {
      landed = false;
      const rows = Array.isArray(stored) ? (stored as Record<string, unknown>[]) : [];
      return rows.map((x) => {
        if (x.id !== a.assignmentId || x.routeId !== a.fromRouteId || x.stopId !== a.fromStopId || x.effectiveTo != null) return x;
        landed = true;
        before = { routeId: x.routeId, stopId: x.stopId, monthlyFeePaise: x.monthlyFeePaise, pickupShiftId: x.pickupShiftId, dropShiftId: x.dropShiftId };
        const next = {
          ...x,
          routeId: a.toRouteId,
          stopId: a.toStopId,
          // Runs follow the child's class on the new route; an override
          // pointing at the old route's runs would mean nothing there.
          pickupShiftId: a.toRouteId === a.fromRouteId ? x.pickupShiftId : "",
          dropShiftId: a.toRouteId === a.fromRouteId ? x.dropShiftId : "",
          monthlyFeePaise: feeNow,
          feeOverrideReason: Number(x.monthlyFeePaise) > 0 ? x.feeOverrideReason : "kept on move (transport audit)",
          _rev: rowRev(x) + 1,
        };
        after = { routeId: next.routeId, stopId: next.stopId, monthlyFeePaise: next.monthlyFeePaise };
        return next;
      });
    });
    if (!written.ok) return NextResponse.json({ error: `Could not save: ${written.error}` }, { status: 502 });
    if (!landed) return NextResponse.json({ error: "The child's record changed while saving — nothing changed" }, { status: 409 });
    await sb.from("transport_desk_sync_meta").update({ last_updated_at: now, updated_at: now }).eq("tenant_id", tenantId);
    result = `Moved to ${toRoute.name} · ${toStop.name}; fee kept at ₹${Math.round(feeNow / 100)}.`;
  } else if (action.type === "use_run_order") {
    const a = action as unknown as OrderAction;
    if (!Array.isArray(a.order) || a.order.length === 0) return NextResponse.json({ error: "Empty order" }, { status: 400 });
    const { data: run, error: runErr } = await sb
      .from("transport_run_orders")
      .update({ custom_order: a.order, chosen: "custom", chosen_by: by, chosen_at: now, updated_at: now })
      .eq("tenant_id", tenantId)
      .eq("id", a.runOrderId)
      .select("id")
      .maybeSingle();
    if (runErr) return NextResponse.json({ error: runErr.message }, { status: 502 });
    if (!run) return NextResponse.json({ error: "That run is no longer recorded — nothing changed" }, { status: 409 });
    after = { chosen: "custom", order: a.order };
    result = "The driver's list for this run now follows the suggested order. Tell the driver.";
  } else {
    return NextResponse.json({ error: `Unknown action ${String(action.type)}` }, { status: 400 });
  }

  await sb
    .from("transport_desk_gaps")
    .update({
      status: "settled",
      settled_at: now,
      settled_by: by,
      settle_note: result,
      action_done_at: now,
      action_by: by,
      action_result: result,
      updated_at: now,
    })
    .eq("tenant_id", tenantId)
    .eq("id", id);

  const meta = requestMeta(req);
  await writeAudit({
    session: auth.ctx.session,
    module: "transport",
    action: `audit_${String(action.type)}`,
    entityType: "transport_gap",
    entityId: id,
    summary: `${r.title} — ${result}`,
    before,
    after,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return NextResponse.json({ ok: true, result });
}
