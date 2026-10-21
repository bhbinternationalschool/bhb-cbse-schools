/**
 * Bus routes, live — the pure half: which run a route is on right now, which
 * of its stops the bus has already been to (and when), and roughly when it
 * reaches each stop still ahead.
 *
 * The data comes from the same place as the web Live map: Fleet Edge
 * telemetry in fleet_vehicle_positions (lib/fleetLive.server). No second
 * tracking pipeline; this file only reads positions it is handed.
 *
 * Honest by construction:
 *   - a stop is "passed" only when the bus's own track came within
 *     PASS_RADIUS_M of it, and the time shown is when it was closest;
 *   - a stop the bus has gone beyond without coming near is "not seen",
 *     never "passed" — the first week of telemetry showed buses skipping a
 *     third of the listed stops, and 1-minute pings miss short halts;
 *   - a fix older than the stale limit gives NO arrival times at all, only
 *     "last seen hh:mm";
 *   - an unpinned stop has no coordinates, so it gets no time.
 */

import { haversineKm } from "@/lib/fleetLive";

/** A fix older than this gives no arrival times: the bus is "last seen", not live. */
export const STALE_FIX_MINUTES = 10;
/** The track must come this close to a stop for it to count as visited. */
export const PASS_RADIUS_M = 200;
/** Straight line → road. Same factor as the parent ETA (fleetLive.estimateEtaMinutes). */
export const ROAD_FACTOR = 1.3;
/** The fleet's observed village average, used for every leg after the first. */
export const AVG_SPEED_KMH = 22;
/** A bus standing at a stop is still on its way: never estimate below this. */
export const SPEED_FLOOR_KMH = 15;
/** And never above this, whatever one ping says. */
export const SPEED_CAP_KMH = 45;
/** Children getting on or off at each stop on the way. */
export const DWELL_MINUTES = 1;

export type EtaStopInput = {
  id: string;
  name: string;
  sequence: number;
  lat: number | null;
  lng: number | null;
};

export type EtaFix = {
  lat: number;
  lng: number;
  speedKmh: number | null;
  recordedAt: string;
};

export type EtaTrailPoint = { at: string; lat: number; lng: number };

export type StopState = "passed" | "not_seen" | "upcoming" | "unpinned";

export type StopEta = {
  id: string;
  name: string;
  sequence: number;
  lat: number | null;
  lng: number | null;
  state: StopState;
  /** When the bus was nearest this stop. Only for "passed". */
  passedAt: string | null;
  /** Estimated arrival. Only for "upcoming", and only with a fresh fix. */
  etaAt: string | null;
  etaMinutes: number | null;
};

export type RouteEtaResult = {
  /** "live": fresh fix, arrival times given. "stale": fix too old, none given. "no_fix": nothing to go on. */
  fixState: "live" | "stale" | "no_fix";
  stops: StopEta[];
  /** For a pick-up run, when the bus reaches school. Null otherwise / when it cannot be said. */
  schoolEta: { etaAt: string; etaMinutes: number } | null;
};

export function fixIsStale(recordedAt: string, nowMs: number, staleMinutes = STALE_FIX_MINUTES): boolean {
  const t = Date.parse(recordedAt);
  if (!Number.isFinite(t)) return true;
  return nowMs - t > staleMinutes * 60_000;
}

function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return haversineKm(a, b) * 1000;
}

/** Minutes to drive a straight-line distance, by road, at a given speed. */
function legMinutes(km: number, speedKmh: number): number {
  return ((km * ROAD_FACTOR) / speedKmh) * 60;
}

/** The first leg uses what the bus is doing now, floored and capped; later legs use the fleet average. */
export function firstLegSpeed(speedKmh: number | null): number {
  if (speedKmh == null || !Number.isFinite(speedKmh)) return AVG_SPEED_KMH;
  return Math.min(SPEED_CAP_KMH, Math.max(SPEED_FLOOR_KMH, speedKmh));
}

/**
 * Where a route's bus is along its run.
 *
 * `stops` must already be in the order this run visits them (the caller
 * reverses the list for a drop run). `trail` is the bus's track since the run
 * began, any order; the current fix is treated as part of it.
 */
export function computeRouteEtas(input: {
  stops: EtaStopInput[];
  fix: EtaFix | null;
  trail: EtaTrailPoint[];
  nowMs: number;
  /** Pick-up runs end at school; its arrival is given too. */
  school?: { lat: number; lng: number } | null;
  staleMinutes?: number;
}): RouteEtaResult {
  const { stops, fix, nowMs } = input;
  const points: EtaTrailPoint[] = [...input.trail];
  if (fix) points.push({ at: fix.recordedAt, lat: fix.lat, lng: fix.lng });

  // 1. Which pinned stops did the track actually reach, and when was it closest.
  const visit = new Map<string, { at: string; d: number }>();
  for (const s of stops) {
    if (s.lat == null || s.lng == null) continue;
    for (const p of points) {
      const d = metres(p, { lat: s.lat, lng: s.lng });
      if (d > PASS_RADIUS_M) continue;
      const prev = visit.get(s.id);
      if (!prev || d < prev.d) visit.set(s.id, { at: p.at, d });
    }
  }

  // 2. How far along the run it has got: the furthest stop it has reached.
  let progress = -1;
  stops.forEach((s, i) => {
    if (visit.has(s.id)) progress = i;
  });

  const fixState: RouteEtaResult["fixState"] = !fix
    ? "no_fix"
    : fixIsStale(fix.recordedAt, nowMs, input.staleMinutes)
      ? "stale"
      : "live";

  // 3. Arrival times for what is still ahead — only from a fresh fix.
  let cursor: { lat: number; lng: number } | null = fixState === "live" && fix ? { lat: fix.lat, lng: fix.lng } : null;
  let minutes = 0;
  let firstLeg = true;
  const speed0 = fix ? firstLegSpeed(fix.speedKmh) : AVG_SPEED_KMH;

  const out: StopEta[] = stops.map((s, i) => {
    const base = { id: s.id, name: s.name, sequence: s.sequence, lat: s.lat, lng: s.lng };
    const seen = visit.get(s.id);
    if (seen) return { ...base, state: "passed", passedAt: seen.at, etaAt: null, etaMinutes: null };
    if (s.lat == null || s.lng == null) return { ...base, state: "unpinned", passedAt: null, etaAt: null, etaMinutes: null };
    if (i < progress) return { ...base, state: "not_seen", passedAt: null, etaAt: null, etaMinutes: null };
    if (!cursor) return { ...base, state: "upcoming", passedAt: null, etaAt: null, etaMinutes: null };
    const km = haversineKm(cursor, { lat: s.lat, lng: s.lng });
    minutes += legMinutes(km, firstLeg ? speed0 : AVG_SPEED_KMH) + (firstLeg ? 0 : DWELL_MINUTES);
    firstLeg = false;
    cursor = { lat: s.lat, lng: s.lng };
    const m = Math.max(1, Math.round(minutes));
    return { ...base, state: "upcoming", passedAt: null, etaAt: new Date(nowMs + m * 60_000).toISOString(), etaMinutes: m };
  });

  let schoolEta: RouteEtaResult["schoolEta"] = null;
  if (cursor && input.school) {
    const km = haversineKm(cursor, input.school);
    minutes += legMinutes(km, firstLeg ? speed0 : AVG_SPEED_KMH) + (firstLeg ? 0 : DWELL_MINUTES);
    const m = Math.max(1, Math.round(minutes));
    schoolEta = { etaAt: new Date(nowMs + m * 60_000).toISOString(), etaMinutes: m };
  }

  return { fixState, stops: out, schoolEta };
}

/* ── which run is on now ─────────────────────────────────────── */

export type RunCandidate = {
  shiftId: string;
  name: string;
  trip: "AM" | "PM";
  /** "HH:mm", or "" when the route has no timed runs. */
  departTime: string;
};

/** Untimed routes fall back to the school-run windows (lib/fleetLivePosition TRIP_WINDOWS_IST). */
const UNTIMED_WINDOWS: Record<"AM" | "PM", { from: number; to: number }> = {
  AM: { from: 6 * 60, to: 9 * 60 + 30 },
  PM: { from: 11 * 60 + 30, to: 16 * 60 },
};

function hhmmMinutes(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((v || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * How long a run is taken to last: the route's measured round trip with half
 * again for stops and traffic, never under 90 minutes, never over 3 hours. An
 * unmeasured route gets 90.
 */
export function runWindowMinutes(roundTripMinutes: number | null | undefined): number {
  const rt = Number(roundTripMinutes) || 0;
  if (rt <= 0) return 90;
  return Math.min(180, Math.max(90, Math.round(rt * 1.5)));
}

/**
 * The run on the road at `istMinutes` (minutes since IST midnight), or null
 * when the route is off-shift. Starts ten minutes before the stated time (the
 * buses are seen rolling early); when two windows overlap, the later run wins
 * — the bus has moved on to it.
 */
export function activeRun(
  runs: RunCandidate[],
  istMinutes: number,
  roundTripMinutes?: number | null,
): RunCandidate | null {
  const len = runWindowMinutes(roundTripMinutes);
  let best: { run: RunCandidate; start: number } | null = null;
  for (const r of runs) {
    const t = hhmmMinutes(r.departTime);
    let from: number;
    let to: number;
    if (t == null) {
      if (r.departTime.trim() !== "") continue; // a set but unreadable time is not a run we can place
      ({ from, to } = UNTIMED_WINDOWS[r.trip]);
    } else {
      from = t - 10;
      to = t + len;
    }
    if (istMinutes < from || istMinutes > to) continue;
    if (!best || from > best.start) best = { run: r, start: from };
  }
  return best?.run ?? null;
}

/** "HH:mm" of the earliest a run's track can start, for reading the trail; null for untimed. */
export function runStartMinutes(run: RunCandidate): number {
  const t = hhmmMinutes(run.departTime);
  if (t == null) return UNTIMED_WINDOWS[run.trip].from;
  return t - 10;
}

/**
 * The order a run visits the stops. The route's sequence is the pick-up
 * order (the editor's "Suggested pickup order"), ending at school; a drop
 * leaves school and goes back the other way.
 */
export function stopsInRunOrder<T extends { sequence: number }>(stops: T[], trip: "AM" | "PM"): T[] {
  const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);
  return trip === "AM" ? sorted : sorted.reverse();
}
