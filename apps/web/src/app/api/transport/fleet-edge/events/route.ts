/**
 * Staff-facing read of fleet_edge_events — the only way to see incoming
 * Tata Fleet Edge data in the ERP today (no normalized viewer yet). Gated
 * on the existing "transport" RBAC module, matching every other
 * transport-desk read route.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "view");
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
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
