/**
 * GET /api/transport/halt-analysis
 *
 * Where the buses actually stopped, against where the stop list says they
 * should. See lib/haltClustering.ts for the rules; this supplies the trail,
 * the stops and the rider counts, and guards what may be concluded from a
 * short history.
 *
 * WHY COVERAGE IS REPORTED FIRST
 * Fleet Edge pushes roughly once every 60 seconds. A bus that pulls up for
 * twenty seconds to collect a child leaves at most a single stationary ping,
 * and a single ping is indistinguishable from a red light. Only repetition
 * across mornings separates the two, so this reports how many days it has
 * actually seen and refuses to name candidate boarding points — or to claim a
 * stop goes unvisited — until it has enough of them.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchAllPages } from "@/lib/supabase/pageAll";
import {
  candidateBoardingPoints,
  clusterHalts,
  findHalts,
  istDay,
  unvisitedStopsWithRiders,
  type KnownStop,
  type TrailPoint,
} from "@/lib/haltClustering";
import {
  deskBundleToTransportState,
  fetchTransportDeskFromDb,
} from "@/lib/transportNormalized.server";
import { TENANT } from "@/lib/types";

export const runtime = "nodejs";

/** Mornings needed before a repeated halt may be called a boarding point. */
const MIN_DAYS = 3;

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "view");
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const ay = url.searchParams.get("ay")?.trim();
  if (!ay) {
    return NextResponse.json({ error: "academicYearCode (ay) is required" }, { status: 400 });
  }
  const minDays = Number(url.searchParams.get("minDays")) || MIN_DAYS;

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Server tenant context unavailable" }, { status: 503 });
  }
  const { sb, tenantId } = ctx;

  const desk = await fetchTransportDeskFromDb();
  if (!desk.ok) {
    return NextResponse.json({ error: "Could not read the transport desk" }, { status: 502 });
  }
  const state = deskBundleToTransportState(desk.bundle);

  const riders = new Map<string, number>();
  for (const a of state.assignments) {
    if (a.effectiveTo != null) continue;
    if (a.academicYearCode !== ay) continue;
    if (a.boardingSuspended) continue;
    riders.set(a.stopId, (riders.get(a.stopId) ?? 0) + 1);
  }

  const stops: KnownStop[] = [];
  for (const route of state.routes) {
    if (!route.isActive) continue;
    for (const s of route.stops) {
      if (!Number.isFinite(s.geoLat) || !Number.isFinite(s.geoLng)) continue;
      stops.push({
        stopId: s.id,
        stopName: s.name,
        routeId: route.id,
        routeLabel: route.busNo || route.code,
        lat: Number(s.geoLat),
        lng: Number(s.geoLng),
        riders: riders.get(s.id) ?? 0,
      });
    }
  }

  const trail = await fetchAllPages<{
    vehicle_ref: string;
    recorded_at: string;
    lat: number;
    lng: number;
    speed_kmh: number | null;
    ignition_on: boolean | null;
  }>((from, to) =>
    sb
      .from("fleet_vehicle_positions")
      .select("vehicle_ref, recorded_at, lat, lng, speed_kmh, ignition_on")
      .eq("tenant_id", tenantId)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (trail.error) {
    return NextResponse.json({ error: trail.error }, { status: 502 });
  }

  const points: TrailPoint[] = trail.rows.map((r) => ({
    vehicleRef: r.vehicle_ref,
    at: r.recorded_at,
    lat: r.lat,
    lng: r.lng,
    speedKmh: r.speed_kmh,
    ignitionOn: r.ignition_on,
  }));

  const halts = findHalts(points, { lat: TENANT.schoolLat, lng: TENANT.schoolLng });
  const clusters = clusterHalts(halts, stops);
  const daysObserved = new Set(points.map((p) => istDay(p.at)).filter(Boolean)).size;
  const enough = daysObserved >= minDays;

  return NextResponse.json({
    academicYearCode: ay,
    coverage: {
      daysObserved,
      minDaysNeeded: minDays,
      enough,
      pings: points.length,
      // Said plainly, because it is the limit on everything below.
      note: enough
        ? null
        : `Fleet Edge pushes about once a minute, so a stop of twenty seconds may leave no trace at all. With ${daysObserved} day(s) of trail a halt seen once cannot be told apart from a traffic light — these are observations, not conclusions.`,
    },
    halts: halts.length,
    clusters,
    /** Named only when there is enough history to mean it. */
    candidateBoardingPoints: enough ? candidateBoardingPoints(clusters, minDays) : [],
    /**
     * Likewise: at one morning, "no bus halted here" mostly means the pickup
     * was too brief to sample, not that the stop goes unserved.
     */
    unvisitedStopsWithRiders: enough ? unvisitedStopsWithRiders(stops, clusters) : [],
  });
}
