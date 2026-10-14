import "server-only";

/**
 * Nightly: add the places each bus has started stopping at as stops.
 * The rules are in lib/gpsStopDiscovery.ts; this reads, names, writes, logs.
 *
 * Writes go through casWriteSlice and bump the route's `_rev`, exactly like
 * an office save, so a tab holding the old route gets "changed elsewhere"
 * instead of writing it back. Every added stop is also logged as a
 * `new_gps_stop` row in transport_desk_gaps — that row is both the office's
 * to-do ("price it, put children on it, or delete it") and this job's memory
 * of every point it ever added, so a stop the office deletes stays deleted.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import { readDeskVehicleTrail } from "@/lib/fleetTrail.server";
import { casWriteSlice } from "@/lib/sliceCas.server";
import { normalizeVehicleKey } from "@/lib/fleetEdgeLink";
import { fetchTransportDeskFromDb, deskBundleToTransportState } from "@/lib/transportNormalized.server";
import { rowRev } from "@/lib/sliceRevMerge";
import { TENANT } from "@/lib/types";
import {
  DISCOVERY_DEFAULTS,
  clusterRunHalts,
  findRunHalts,
  gpsStopNote,
  insertAfterNearest,
  isVehicleErrandPlace,
  metres,
  proposeGpsStops,
  runDaysByVehicle,
  type GpsPosition,
  type StopPoint,
} from "@/lib/gpsStopDiscovery";

/** Days of trail looked at. Long enough for a new stop to repeat, short enough to notice a change. */
const WINDOW_DAYS = 28;
/** A vehicle with fewer run days than this in the window is not judged at all. */
const MIN_RUN_DAYS = 10;
/** Safety valve: more than this in one night means something changed that a person should look at. */
const MAX_ADDS_PER_RUN = 15;

export type GpsStopAdded = {
  vehicle: string;
  routeId: string;
  stopId: string;
  name: string;
  lat: number;
  lng: number;
  daysSeen: number;
  runDays: number;
  distanceKm: number | null;
};

export type GpsStopDiscoveryResult = {
  ok: boolean;
  dryRun: boolean;
  error?: string;
  positions: number;
  vehicles: { vehicle: string; runDays: number; judged: boolean; candidates: number }[];
  skippedErrands: { vehicle: string; place: string; lat: number; lng: number }[];
  added: GpsStopAdded[];
  capped: boolean;
};

const randomId = () =>
  "st_" +
  Array.from({ length: 8 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");

type PlaceHit = { name: string; metres: number; vicinity: string; types: string[] } | null;

async function nearestPlace(lat: number, lng: number, key: string): Promise<PlaceHit> {
  const u = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
  u.searchParams.set("location", `${lat},${lng}`);
  u.searchParams.set("rankby", "distance");
  u.searchParams.set("key", key);
  try {
    const res = await fetch(u, { signal: AbortSignal.timeout(15_000) });
    const body = (await res.json()) as {
      results?: { name: string; vicinity?: string; types?: string[]; geometry: { location: { lat: number; lng: number } } }[];
    };
    for (const r of body.results ?? []) {
      const types = r.types ?? [];
      if (types.some((t) => ["locality", "political", "sublocality", "sublocality_level_1", "route"].includes(t))) continue;
      return {
        name: r.name,
        metres: metres(lat, lng, r.geometry.location.lat, r.geometry.location.lng),
        vicinity: r.vicinity ?? "",
        types,
      };
    }
  } catch {
    /* unnamed is fine — the stop gets its coordinates as a name */
  }
  return null;
}

async function roadKmFromSchool(lat: number, lng: number, key: string): Promise<number | null> {
  const u = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  u.searchParams.set("origins", `${TENANT.schoolLat},${TENANT.schoolLng}`);
  u.searchParams.set("destinations", `${lat},${lng}`);
  u.searchParams.set("mode", "driving");
  u.searchParams.set("key", key);
  try {
    const res = await fetch(u, { signal: AbortSignal.timeout(15_000) });
    const body = (await res.json()) as { rows?: { elements?: { status: string; distance?: { value: number } }[] }[] };
    const el = body.rows?.[0]?.elements?.[0];
    return el?.status === "OK" && el.distance ? Math.round(el.distance.value / 100) / 10 : null;
  } catch {
    return null;
  }
}

export async function runGpsStopDiscovery(opts: { dryRun?: boolean; nowMs?: number } = {}): Promise<GpsStopDiscoveryResult> {
  const dryRun = Boolean(opts.dryRun);
  const nowMs = opts.nowMs ?? Date.now();
  const result: GpsStopDiscoveryResult = {
    ok: false,
    dryRun,
    positions: 0,
    vehicles: [],
    skippedErrands: [],
    added: [],
    capped: false,
  };
  const fail = (error: string) => ({ ...result, ok: false, error });

  const ctx = await getServerTenantContext();
  if (!ctx) return fail("Server tenant context unavailable");
  const { sb, tenantId } = ctx;
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY?.trim() || "";

  // A desk we cannot read is unknown, not empty: adding stops against an
  // empty read would duplicate every stop on every route.
  const desk = await fetchTransportDeskFromDb();
  if (!desk.ok) return fail("Could not read the transport desk — nothing was added");
  const state = deskBundleToTransportState(desk.bundle);

  const since = new Date(nowMs - WINDOW_DAYS * 86_400_000).toISOString();
  const trail = await readDeskVehicleTrail(sb, tenantId, state.vehicles, since);
  // A cut-off or failed read would make every stop look rarer than it is — refuse it.
  if (!trail.ok) return fail(`${trail.error} — nothing was added`);
  const points: GpsPosition[] = trail.points;
  const vehicleByKey = new Map<string, (typeof state.vehicles)[number]>();
  for (const v of state.vehicles) {
    if (v.isActive === false) continue;
    const k = normalizeVehicleKey(v.registrationNo);
    if (k) vehicleByKey.set(k, v);
  }
  result.positions = points.length;

  const school: StopPoint = { lat: TENANT.schoolLat, lng: TENANT.schoolLng };
  const runDays = runDaysByVehicle(points);
  const clusters = clusterRunHalts(findRunHalts(points, school));

  // Every point this job ever added — kept or since deleted by the office.
  const { data: prior, error: priorErr } = await sb
    .from("transport_desk_gaps")
    .select("lat, lng")
    .eq("tenant_id", tenantId)
    .eq("kind", "new_gps_stop");
  if (priorErr) return fail(`Could not read earlier GPS stops: ${priorErr.message}`);
  const everAdded: StopPoint[] = (prior ?? [])
    .map((r) => ({ lat: Number((r as { lat: unknown }).lat), lng: Number((r as { lng: unknown }).lng) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

  type Plan = GpsStopAdded & { note: string };
  const publicView = (p: Plan): GpsStopAdded => ({
    vehicle: p.vehicle,
    routeId: p.routeId,
    stopId: p.stopId,
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    daysSeen: p.daysSeen,
    runDays: p.runDays,
    distanceKm: p.distanceKm,
  });
  const plans: Plan[] = [];
  const today = new Date(nowMs + 5.5 * 3600_000).toISOString().slice(0, 10);

  for (const v of state.vehicles) {
    const days = runDays.get(v.id)?.size ?? 0;
    const routes = state.routes.filter((r) => r.isActive !== false && r.vehicleId === v.id);
    const judged = days >= MIN_RUN_DAYS && routes.length > 0;
    if (!vehicleByKey.has(normalizeVehicleKey(v.registrationNo))) continue;
    const existing: StopPoint[] = routes.flatMap((r) =>
      r.stops
        .filter((s) => Number.isFinite(s.geoLat) && Number.isFinite(s.geoLng))
        .map((s) => ({ lat: Number(s.geoLat), lng: Number(s.geoLng) })),
    );
    const proposals = judged
      ? proposeGpsStops({ clusters, vehicleKey: v.id, runDays: days, existing, everAdded: [...everAdded, ...plans] })
      : [];
    result.vehicles.push({ vehicle: v.name, runDays: days, judged, candidates: proposals.length });
    // A vehicle on two routes gets the stop on its first (primary) route.
    const route = routes.find((r) => r.id === v.primaryRouteId) ?? routes[0];
    if (!route) continue;

    for (const c of proposals) {
      if (plans.length >= MAX_ADDS_PER_RUN) {
        result.capped = true;
        break;
      }
      const place = mapsKey ? await nearestPlace(c.lat, c.lng, mapsKey) : null;
      if (place && place.metres <= 120 && isVehicleErrandPlace(place.name, place.types)) {
        result.skippedErrands.push({ vehicle: v.name, place: place.name, lat: c.lat, lng: c.lng });
        continue;
      }
      const name = place
        ? (place.metres <= 40 ? place.name : `Near ${place.name}`).slice(0, 80)
        : `Bus halt ${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`;
      const km = mapsKey ? await roadKmFromSchool(c.lat, c.lng, mapsKey) : null;
      plans.push({
        vehicle: v.name,
        routeId: route.id,
        stopId: randomId(),
        name,
        lat: Math.round(c.lat * 1e6) / 1e6,
        lng: Math.round(c.lng * 1e6) / 1e6,
        daysSeen: c.daysSeen,
        runDays: days,
        distanceKm: km,
        note: gpsStopNote(c, v.name, days, today, place?.vicinity),
      });
    }
  }

  if (dryRun || plans.length === 0) {
    return { ...result, ok: true, added: plans.map(publicView) };
  }

  // Write: append to the stored routes, re-checking against what is stored
  // now (the office may have added the same place since the read).
  const landed = new Set<string>();
  const written = await casWriteSlice(sb, "transport_desk_slices", tenantId, "routes", (stored) => {
    landed.clear();
    const routes = Array.isArray(stored) ? (stored as Record<string, unknown>[]) : [];
    return routes.map((r) => {
      const mine = plans.filter((p) => p.routeId === r.id);
      if (!mine.length) return r;
      let stops = (Array.isArray(r.stops) ? r.stops : []) as { id: string; sequence: number; geoLat?: number; geoLng?: number }[];
      let changed = false;
      for (const p of mine) {
        const clash = stops.some(
          (s) =>
            s.id === p.stopId ||
            (Number.isFinite(s.geoLat) &&
              Number.isFinite(s.geoLng) &&
              metres(p.lat, p.lng, Number(s.geoLat), Number(s.geoLng)) <= DISCOVERY_DEFAULTS.existingStopRadiusM),
        );
        if (clash) continue;
        stops = insertAfterNearest(stops, {
          id: p.stopId,
          name: p.name,
          sequence: stops.length + 1,
          distanceKm: p.distanceKm ?? 0,
          distanceSource: p.distanceKm != null ? "google" : "",
          geoLat: p.lat,
          geoLng: p.lng,
          geoAddress: p.note,
        } as never);
        landed.add(p.stopId);
        changed = true;
      }
      return changed ? { ...r, stops, _rev: rowRev(r) + 1 } : r;
    });
  });
  if (!written.ok) return fail(`Could not save the routes: ${written.error}`);
  const added = plans.filter((p) => landed.has(p.stopId));

  if (added.length) {
    const now = new Date(nowMs).toISOString();
    const { error: gapErr } = await sb.from("transport_desk_gaps").upsert(
      added.map((p) => ({
        id: `gpsstop:${p.stopId}`,
        tenant_id: tenantId,
        kind: "new_gps_stop",
        vehicle: p.vehicle,
        route_id: p.routeId,
        stop_id: p.stopId,
        title: `${p.vehicle} — new stop from GPS: ${p.name}`,
        detail:
          `${p.note} ${p.distanceKm != null ? `${p.distanceKm} km from school by road.` : "Road distance could not be measured — measure it in the route editor."} ` +
          `If children board here, price the stop and move them onto it on the Riders tab. If it is not a boarding point (a shop, a traffic stop), delete it from the route — it will not be added again.`,
        billed_km: p.distanceKm,
        lat: p.lat,
        lng: p.lng,
        source: "gps-stop-discovery",
        status: "open",
        found_at: now,
        updated_at: now,
      })),
      { onConflict: "id", ignoreDuplicates: true },
    );
    // The stops are already on the routes; a missing log row would let a
    // deleted stop come back, so say so loudly rather than report success.
    if (gapErr) return { ...fail(`Stops added but not logged: ${gapErr.message}`), added: added.map(publicView) };
    await sb
      .from("transport_desk_sync_meta")
      .update({ last_updated_at: now, updated_at: now })
      .eq("tenant_id", tenantId);
  }

  return { ...result, ok: true, added: added.map(publicView) };
}
