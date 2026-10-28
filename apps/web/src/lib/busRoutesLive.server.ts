/**
 * Bus routes, live — the data half for the staff app's "All bus routes".
 *
 * Reuses the web Live map's source (fleet_vehicle_positions via
 * lib/fleetLive.server, the desk via fetchTransportDeskFromDb) and its rules
 * (positionForVehicle, the bus register's runs and crew scope). Rules for
 * progress and arrival times are in lib/busRouteEta.ts.
 */
import "server-only";

import type { ApiAuthContext } from "@/lib/api/v1/auth";
import { ApiError } from "@/lib/api/v1/errors";
import { istMinutesOfDay } from "@/lib/fleetLivePosition";
import { positionForVehicle, type LivePosition } from "@/lib/fleetLive";
import { readLatestPositionsResult, readVehicleTrackSince } from "@/lib/fleetLive.server";
import {
  STALE_FIX_MINUTES,
  activeRun,
  computeRouteEtas,
  fixIsStale,
  runStartMinutes,
  stopsInRunOrder,
  type RunCandidate,
  type StopEta,
} from "@/lib/busRouteEta";
import { loadTransportDesk, mayUseRoute, registerAccess } from "@/lib/transportBoardingLog.server";
import { istDate, runsForRoute } from "@/lib/transportBoardingLog";
import { TENANT } from "@/lib/types";

export type LiveRouteStatus =
  /** The route has no vehicle linked on the desk. */
  | "no_vehicle"
  /** The vehicle has never sent a position (no tracker, e.g. Rajesh Van). */
  | "untracked"
  /** No run is on the road right now. */
  | "off_shift"
  /** On a run, but the last fix is older than the stale limit: "last seen hh:mm". */
  | "stale"
  /** On a run, fresh fix, arrival times given. */
  | "live";

export type LiveRouteView = {
  routeId: string;
  code: string;
  name: string;
  busNo: string;
  vehicle: { id: string; name: string; registrationNo: string } | null;
  status: LiveRouteStatus;
  run: { shiftId: string; name: string; trip: "AM" | "PM"; departTime: string } | null;
  fix: {
    lat: number;
    lng: number;
    speedKmh: number | null;
    headingDeg: number | null;
    fixAt: string;
    ageSec: number;
    stale: boolean;
  } | null;
  /** The bus's track since the run began could not be read: stops are listed without progress or times. */
  trailUnread: boolean;
  /** In the order this run visits them (drop runs reversed); off-shift, in route order. */
  stops: StopEta[];
  schoolEta: { etaAt: string; etaMinutes: number } | null;
};

export type BusRoutesLive = {
  at: string;
  school: { lat: number; lng: number };
  staleAfterMinutes: number;
  /** A driver sees only their own bus; true when the list was narrowed so. */
  scoped: boolean;
  routes: LiveRouteView[];
};

/** IST date + minutes-of-day → ISO instant. */
function istInstant(date: string, minutes: number): string {
  const ms = Date.parse(`${date}T00:00:00.000Z`) + minutes * 60_000 - 5.5 * 3600_000;
  return new Date(ms).toISOString();
}

function idleStops(route: { stops: { id: string; name: string; sequence: number; geoLat?: number; geoLng?: number }[] }): StopEta[] {
  return [...route.stops]
    .sort((a, b) => a.sequence - b.sequence)
    .map((s) => ({
      id: s.id,
      name: s.name,
      sequence: s.sequence,
      lat: s.geoLat ?? null,
      lng: s.geoLng ?? null,
      state: s.geoLat == null || s.geoLng == null ? "unpinned" : "upcoming",
      passedAt: null,
      etaAt: null,
      etaMinutes: null,
    }));
}

export async function buildBusRoutesLive(ctx: ApiAuthContext, opts: { routeId?: string; nowMs?: number } = {}): Promise<BusRoutesLive> {
  const nowMs = opts.nowMs ?? Date.now();
  const date = istDate(nowMs);
  const transport = await loadTransportDesk();
  const access = registerAccess(ctx, transport, date);

  const positionsRes = await readLatestPositionsResult();
  if (!positionsRes.ok) {
    // Not "no bus is reporting": the read failed. Say so.
    throw new ApiError("server_error", "Bus positions could not be read. Try again.", 503);
  }
  const positions = positionsRes.positions;
  const istMin = istMinutesOfDay(nowMs);
  const vehicleById = new Map(transport.vehicles.map((v) => [v.id, v]));

  const routes = transport.routes.filter(
    (r) => r.isActive !== false && mayUseRoute(access, r.id) && (!opts.routeId || r.id === opts.routeId),
  );

  const out: LiveRouteView[] = [];
  for (const route of routes) {
    const vehicle = route.vehicleId ? vehicleById.get(route.vehicleId) : undefined;
    const pos: LivePosition | null = vehicle ? positionForVehicle(vehicle, positions) : null;
    const base = {
      routeId: route.id,
      code: route.code,
      name: route.name,
      busNo: route.busNo || "",
      vehicle: vehicle ? { id: vehicle.id, name: vehicle.name, registrationNo: vehicle.registrationNo } : null,
    };
    const fix = pos
      ? {
          lat: pos.lat,
          lng: pos.lng,
          speedKmh: pos.speedKmh,
          headingDeg: pos.courseDeg,
          fixAt: pos.recordedAt,
          ageSec: Math.max(0, Math.round((nowMs - Date.parse(pos.recordedAt)) / 1000)),
          stale: fixIsStale(pos.recordedAt, nowMs),
        }
      : null;

    if (!vehicle || !pos) {
      out.push({ ...base, status: vehicle ? "untracked" : "no_vehicle", run: null, fix: null, trailUnread: false, stops: idleStops(route), schoolEta: null });
      continue;
    }

    const candidates: RunCandidate[] = (["AM", "PM"] as const).flatMap((trip) =>
      runsForRoute(route, trip, date).map((r) => ({ shiftId: r.shiftId, name: r.name, trip, departTime: r.departTime })),
    );
    const run = activeRun(candidates, istMin, route.roundTripMinutes);
    if (!run) {
      out.push({ ...base, status: "off_shift", run: null, fix, trailUnread: false, stops: idleStops(route), schoolEta: null });
      continue;
    }

    const ordered = stopsInRunOrder(route.stops, run.trip).map((s) => ({
      id: s.id,
      name: s.name,
      sequence: s.sequence,
      lat: s.geoLat ?? null,
      lng: s.geoLng ?? null,
    }));
    const since = istInstant(date, runStartMinutes(run));
    const trail = await readVehicleTrackSince(pos.vehicleRef, since);
    const trailOk = trail.ok && !trail.truncated;
    const eta = trailOk
      ? computeRouteEtas({
          stops: ordered,
          fix: { lat: pos.lat, lng: pos.lng, speedKmh: pos.speedKmh, recordedAt: pos.recordedAt },
          trail: trail.points.map((p) => ({ at: p.recordedAt, lat: p.lat, lng: p.lng })),
          nowMs,
          school: run.trip === "AM" ? { lat: TENANT.schoolLat, lng: TENANT.schoolLng } : null,
        })
      : null;
    out.push({
      ...base,
      status: fix?.stale ? "stale" : "live",
      run: { shiftId: run.shiftId, name: run.name, trip: run.trip, departTime: run.departTime },
      fix,
      trailUnread: !trailOk,
      // Without the track there is no telling which stops are behind the bus,
      // so no times are given rather than times for stops it already left.
      stops: eta ? eta.stops : computeRouteEtas({ stops: ordered, fix: null, trail: [], nowMs }).stops,
      schoolEta: eta?.schoolEta ?? null,
    });
  }

  return {
    at: new Date(nowMs).toISOString(),
    school: { lat: TENANT.schoolLat, lng: TENANT.schoolLng },
    staleAfterMinutes: STALE_FIX_MINUTES,
    scoped: !access.fleetWide,
    routes: out,
  };
}
