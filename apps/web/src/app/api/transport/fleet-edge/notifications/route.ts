/**
 * Fleet Edge outbound-notification log (fleet_edge_notifications) — what
 * the ERP told whom about SOS / tracker events, and whether it got through.
 * GET ?limit&vehicleRef&status. transport:view.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { fleetEdgeNotifyMobiles } from "@/lib/fleetEdge.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "view");
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 200));
  const vehicleRef = url.searchParams.get("vehicleRef")?.trim() || null;
  const status = url.searchParams.get("status")?.trim() || null;

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Server tenant context unavailable" }, { status: 503 });
  }
  let q = ctx.sb
    .from("fleet_edge_notifications")
    .select("id, created_at, event_id, alert_name, vehicle_ref, registration_number, channel, recipient, status, detail, body")
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (vehicleRef) q = q.or(`vehicle_ref.eq.${vehicleRef},registration_number.eq.${vehicleRef}`);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    ok: true,
    notifications: data || [],
    // Masked — the desk sees which numbers are on the escalation list
    // without the full number leaving the server.
    notifyMobiles: fleetEdgeNotifyMobiles().map((m) => m.replace(/^(\d{2})\d{4}(\d{4})$/, "$1XXXX$2")),
  });
}
