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
 *
 * The counting is done in Postgres (fleet_edge_vehicle_status), not here. It
 * used to select the raw events and group them in TypeScript, which put this
 * route straight into the 1,000-row PostgREST cap: at 11,231 events the strip
 * counted the newest thousand and told the office a bus with 1,167 summaries
 * and 233 alerts had "41 summaries · 0 alerts", with no error anywhere. See
 * the migration's header for why paging the table was not the answer either.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import {
  isPlaceholderVehicle,
  telemetryFreshness,
  type FleetEdgeVehicleStatus,
} from "@/lib/fleetEdgeLink";

export const runtime = "nodejs";

type StatusRow = {
  vin: string | null;
  registration_number: string | null;
  last_seen_at: string | null;
  last_event_type: string | null;
  detail_count: number | string | null;
  alert_count: number | string | null;
  telemetry_count: number | string | null;
  last_telemetry_at: string | null;
};

// bigint comes back from PostgREST as a string.
const count = (v: number | string | null) => Number(v ?? 0) || 0;

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

  const { data, error } = await ctx.sb.rpc("fleet_edge_vehicle_status", {
    p_tenant_id: ctx.tenantId,
  });

  if (error) {
    // Refused rather than returned empty: "no vehicles reporting" and "the
    // query failed" mean opposite things to someone checking whether the
    // fleet is online.
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  const all: FleetEdgeVehicleStatus[] = ((data ?? []) as StatusRow[])
    .filter((r) => String(r.vin ?? "").trim())
    .map((r) => ({
      vin: String(r.vin).trim(),
      registrationNumber: r.registration_number
        ? String(r.registration_number)
        : null,
      lastSeenAt: r.last_seen_at ? String(r.last_seen_at) : null,
      lastEventType: r.last_event_type ? String(r.last_event_type) : null,
      detailCount: count(r.detail_count),
      alertCount: count(r.alert_count),
      telemetryCount: count(r.telemetry_count),
      lastTelemetryAt: r.last_telemetry_at ? String(r.last_telemetry_at) : null,
    }));

  // Tata's own test vehicle is real traffic but not a bus. Dropped here
  // rather than in the strip so nothing downstream has to know about it —
  // and reported, because a subscription test is worth being able to see.
  const vehicles = all.filter((v) => !isPlaceholderVehicle(v));
  const placeholders = all
    .filter((v) => isPlaceholderVehicle(v))
    .map((v) => ({ vin: v.vin, lastSeenAt: v.lastSeenAt }));

  return NextResponse.json({
    vehicles,
    telemetry: telemetryFreshness(vehicles, Date.now()),
    placeholders,
  });
}
