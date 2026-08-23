/**
 * GET /api/transport/fleet-edge/vehicle-status
 *
 * One row per vehicle Fleet Edge is reporting on: when it was last heard
 * from, how many summaries/alerts/telemetry rows have arrived, and its VIN
 * and registration so the desk can match on either.
 *
 * Exists because the Fleet and Live tabs read the transport desk and nothing
 * else, so 4,198 Fleet Edge events sat in the database against vehicles that
 * appeared, to anyone using the ERP, to be reporting nothing at all.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { telemetryFreshness, type FleetEdgeVehicleStatus } from "@/lib/fleetEdgeLink";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "view");
  if (!auth.ok) return auth.response;

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return NextResponse.json(
      { error: "Server tenant context unavailable" },
      { status: 503 },
    );
  }

  const { data, error } = await ctx.sb
    .from("fleet_edge_events")
    .select("vehicle_ref, registration_number, event_type, received_at")
    .eq("tenant_id", ctx.tenantId)
    .order("received_at", { ascending: false })
    .limit(20000);

  if (error) {
    // Refused rather than returned empty: "no vehicles reporting" and "the
    // query failed" mean opposite things to someone checking whether the
    // fleet is online.
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  const byVin = new Map<string, FleetEdgeVehicleStatus>();
  for (const ev of data ?? []) {
    const vin = String(ev.vehicle_ref ?? "").trim();
    if (!vin) continue;
    let row = byVin.get(vin);
    if (!row) {
      row = {
        vin,
        registrationNumber: null,
        lastSeenAt: null,
        lastEventType: null,
        detailCount: 0,
        alertCount: 0,
        telemetryCount: 0,
        lastTelemetryAt: null,
      };
      byVin.set(vin, row);
    }
    // Rows arrive newest first, so the first registration seen is the most
    // recent one Fleet Edge reported for this vehicle.
    if (!row.registrationNumber && ev.registration_number) {
      row.registrationNumber = String(ev.registration_number);
    }
    const at = ev.received_at ? String(ev.received_at) : null;
    if (at && (!row.lastSeenAt || at > row.lastSeenAt)) {
      row.lastSeenAt = at;
      row.lastEventType = String(ev.event_type ?? "");
    }
    if (ev.event_type === "details") row.detailCount += 1;
    else if (ev.event_type === "alert") row.alertCount += 1;
    else if (ev.event_type === "telemetry") {
      row.telemetryCount += 1;
      if (at && (!row.lastTelemetryAt || at > row.lastTelemetryAt)) {
        row.lastTelemetryAt = at;
      }
    }
  }

  const vehicles = [...byVin.values()].sort((a, b) =>
    (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? ""),
  );

  return NextResponse.json({
    vehicles,
    telemetry: telemetryFreshness(vehicles, Date.now()),
    sampled: (data ?? []).length,
  });
}
