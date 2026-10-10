/**
 * Staff-facing read of fleet_edge_events — the only way to see incoming
 * Tata Fleet Edge data in the ERP today (no normalized viewer yet). Gated
 * on the existing "transport" RBAC module, matching every other
 * transport-desk read route.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { writeAudit } from "@/lib/audit.server";
import { requestMeta } from "@/lib/api/v1/auth";
import { getServerTenantContext } from "@/lib/serverTenant";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "view");
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const id = url.searchParams.get("id")?.trim() || null;
  const vehicleRef = url.searchParams.get("vehicleRef")?.trim() || null;
  const eventType = url.searchParams.get("eventType")?.trim() || null;
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Server tenant context unavailable" }, { status: 503 });
  }
  const { sb, tenantId } = ctx;

  let query = sb
    .from("fleet_edge_events")
    .select(
      "id, event_type, alert_name, vehicle_ref, registration_number, event_at, window_from, window_to, source_ip, payload, received_at",
    )
    .eq("tenant_id", tenantId)
    .order("received_at", { ascending: false })
    .limit(limit);

  if (id) query = query.eq("id", id);
  if (vehicleRef) {
    query = query.or(`vehicle_ref.eq.${vehicleRef},registration_number.eq.${vehicleRef}`);
  }
  if (eventType) {
    query = query.eq("event_type", eventType);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, events: data || [] });
}

type DeleteBody = {
  /** Explicit event ids (View → Delete, or bulk-selected rows). */
  ids?: string[];
  /** Or a filter: everything matching vehicleRef + alertName inside [from,to]. */
  filter?: { vehicleRef?: string; eventType?: string; alertName?: string; from?: string; to?: string };
  reason?: string;
};

/**
 * DELETE — remove raw Fleet Edge events. Needs transport:edit. Used to clear
 * test pushes and a stuck panic button's duplicate SOS bursts from the
 * report; the delete is audited with what was removed. A filter without any
 * narrowing (no ids, no vehicle, no alert name) is refused — this is a
 * clean-up tool, not a wipe.
 */
export async function DELETE(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "edit");
  if (!auth.ok) return auth.response;

  let body: DeleteBody;
  try {
    body = (await req.json()) as DeleteBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === "string" && x) : [];
  const f = body.filter || {};
  const hasNarrowing = ids.length > 0 || !!f.vehicleRef || !!f.alertName;
  if (!hasNarrowing) {
    return NextResponse.json(
      { error: "Refusing: give event ids, or a vehicle / alert name to narrow the delete" },
      { status: 400 },
    );
  }
  if (ids.length > 500) {
    return NextResponse.json({ error: "At most 500 ids per delete" }, { status: 400 });
  }

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Server tenant context unavailable" }, { status: 503 });
  }
  const { sb, tenantId } = ctx;

  let q = sb.from("fleet_edge_events").delete().eq("tenant_id", tenantId);
  if (ids.length > 0) {
    q = q.in("id", ids);
  } else {
    if (f.vehicleRef) q = q.or(`vehicle_ref.eq.${f.vehicleRef},registration_number.eq.${f.vehicleRef}`);
    if (f.eventType) q = q.eq("event_type", f.eventType);
    if (f.alertName) q = q.eq("alert_name", f.alertName);
    if (f.from && Number.isFinite(Date.parse(f.from))) q = q.gte("received_at", f.from);
    if (f.to && Number.isFinite(Date.parse(f.to))) q = q.lte("received_at", f.to);
  }
  const { data, error } = await q.select("id, event_type, alert_name, vehicle_ref, registration_number, received_at");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const removed = data || [];
  const meta = requestMeta(req);
  await writeAudit({
    session: auth.ctx.session,
    module: "transport",
    action: "fleet_edge_events_delete",
    entityType: "fleet_edge_event",
    entityId: ids.length === 1 ? ids[0] : undefined,
    summary: `Deleted ${removed.length} Fleet Edge event(s)${body.reason ? ` — ${body.reason}` : ""}`,
    before: { ids: ids.length > 0 ? ids : undefined, filter: ids.length > 0 ? undefined : f, removed },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return NextResponse.json({ ok: true, deleted: removed.length });
}
