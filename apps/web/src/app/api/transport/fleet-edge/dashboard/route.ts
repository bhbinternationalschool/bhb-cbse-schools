/**
 * Fleet dashboard aggregation — reads fleet_edge_events for the tenant,
 * bounds the safety/efficiency/health counters to the requested [from,to]
 * window, but computes lastSeenAt (for offline detection) from ALL
 * history regardless of that window — see lib/fleetEdgeAnalytics.ts's file
 * header for why those two are deliberately different.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import {
  buildFleetDashboard,
  emptyVehicleMetrics,
  FLEET_LOOKBACK_MS,
  type VehicleFleetMetrics,
} from "@/lib/fleetEdgeAnalytics";

export const runtime = "nodejs";

type RawEvent = {
  event_type: "alert" | "details" | "telemetry";
  alert_name: string | null;
  vehicle_ref: string | null;
  registration_number: string | null;
  received_at: string;
  payload: Record<string, unknown>;
};

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function sumDurations(list: unknown): number {
  if (!Array.isArray(list)) return 0;
  return list.reduce((acc: number, item) => {
    if (isObj(item) && typeof item.duration === "number") return acc + item.duration;
    return acc;
  }, 0);
}

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "view");
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const from = fromParam || defaultFrom;
  const to = toParam || now.toISOString();

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Server tenant context unavailable" }, { status: 503 });
  }
  const { sb, tenantId } = ctx;

  const lookbackFrom = new Date(Date.now() - FLEET_LOOKBACK_MS).toISOString();

  const { data, error } = await sb
    .from("fleet_edge_events")
    .select("event_type, alert_name, vehicle_ref, registration_number, received_at, payload")
    .eq("tenant_id", tenantId)
    .gte("received_at", lookbackFrom)
    .order("received_at", { ascending: true })
    .limit(20000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const events = (data || []) as RawEvent[];
  const byVehicle = new Map<string, VehicleFleetMetrics>();
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);

  for (const ev of events) {
    const key = ev.vehicle_ref || ev.registration_number;
    if (!key) continue;
    if (!byVehicle.has(key)) {
      byVehicle.set(key, emptyVehicleMetrics(ev.vehicle_ref || key, ev.registration_number));
    }
    const m = byVehicle.get(key)!;

    // lastSeenAt — unbounded by [from,to], this is the live/current status.
    if (!m.lastSeenAt || ev.received_at > m.lastSeenAt) m.lastSeenAt = ev.received_at;
    if (ev.registration_number && !m.registrationNumber) m.registrationNumber = ev.registration_number;

    if (ev.event_type === "telemetry") {
      const p = ev.payload;
      const at = Date.parse(ev.received_at);
      if (!m.lastTelemetry || (m.lastTelemetry.at && Date.parse(m.lastTelemetry.at) < at) || !m.lastTelemetry.at) {
        m.lastTelemetry = {
          lat: typeof p.gpsLatitude === "number" ? p.gpsLatitude : null,
          lng: typeof p.gpsLongitude === "number" ? p.gpsLongitude : null,
          speed: typeof p.speed === "number" ? p.speed : null,
          ignitionOn: typeof p.ignitionOn === "boolean" ? p.ignitionOn : null,
          fuelLevelPercent: typeof p.fuelLevelPercent === "number" ? p.fuelLevelPercent : null,
          odometer: typeof p.odometer === "number" ? p.odometer : null,
          at: ev.received_at,
        };
      }
    }

    // Everything below this line is bounded to the requested [from,to].
    const evMs = Date.parse(ev.received_at);
    if (!Number.isFinite(evMs) || evMs < fromMs || evMs > toMs) continue;

    if (ev.event_type === "alert") {
      if (ev.alert_name === "OverSpeedEvent") m.overSpeedCount += 1;
      else if (ev.alert_name === "DriverSOSAlert") m.sosCount += 1;
      else if (ev.alert_name === "FuelDrainAlert") m.fuelDrainCount += 1;
      else if (ev.alert_name === "GeoFenceEntered" || ev.alert_name === "GeoFenceExited") m.geofenceEventCount += 1;
    } else if (ev.event_type === "details") {
      const p = ev.payload;
      const safety = isObj(p.vehicleSafety) ? p.vehicleSafety : {};
      m.haCount += num(safety.haCount);
      m.hbCount += num(safety.hbCount);
      m.rtCount += num(safety.rtCount);
      m.nightDrivingSeconds += num(safety.nightTimeDrivingDuration);

      const perf = isObj(p.vehiclePerformance) ? p.vehiclePerformance : {};
      m.distanceTravelledKm += num(perf.distanceTravelled);
      if (typeof perf.serviceDue === "string" && perf.serviceDue.trim()) m.serviceDue = perf.serviceDue;

      const eff = isObj(p.vehicleEfficiency) ? p.vehicleEfficiency : {};
      m.fuelConsumed += num(eff.fuelConsumed);
      if (typeof eff.averageSpeed === "number") m.averageSpeedSamples.push(eff.averageSpeed);
      m.idlingSeconds += sumDurations(eff.idlings);
      m.stoppageSeconds += sumDurations(eff.stoppages);

      const health = isObj(p.vehicleHealth) ? p.vehicleHealth : {};
      const fault = isObj(health.faultCode) ? health.faultCode : {};
      m.faultCritical += num(fault.critical);
      m.faultWarning += num(fault.warning);
      m.incidents += num(health.incidents);
    }
  }

  const { rows, kpis } = buildFleetDashboard(Array.from(byVehicle.values()));

  return NextResponse.json({
    ok: true,
    from,
    to,
    kpis,
    total: rows.length,
    vehicles: rows,
  });
}
