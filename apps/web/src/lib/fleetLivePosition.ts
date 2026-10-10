/**
 * Where a vehicle actually is, from Fleet Edge telemetry.
 *
 * The transport Live tab reads positions from `state.gpsPings` — a desk-local
 * array fed by hand — while the only real position source, the Fleet Edge
 * `/live` push, lands in fleet_edge_events and is read by nobody. The map has
 * therefore never shown a moving vehicle. This is the missing half: turn a
 * telemetry payload into a position, and say plainly how old it is.
 *
 * Age is not decoration. A position ten minutes stale is a different claim
 * from one ten seconds old, and a parent told "your bus is here" about a
 * quarter-hour-old fix has been told something false. Every reader gets the
 * age with the coordinates and is expected to show it.
 */

export type LivePosition = {
  lat: number;
  lng: number;
  /** km/h as reported. Null when the payload omitted it. */
  speed: number | null;
  ignitionOn: boolean | null;
  /** ISO timestamp of the ping this came from. */
  at: string;
};

/**
 * Fleet Edge sends "NA" as a registration until the vehicle is registered in
 * their portal, and the desk stores a chassis number where a plate belongs on
 * two of the six vehicles. Neither is a position problem, but both decide
 * which desk vehicle a ping belongs to — see linkFleetEdgeToDesk().
 */
export type TelemetryPayload = {
  gpsLatitude?: unknown;
  gpsLongitude?: unknown;
  speed?: unknown;
  ignitionOn?: unknown;
};

function finiteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  // Defensive, not observed: production payloads on 2026-09-10 were all
  // proper JSON numbers and booleans. The vendor documents "Example
  // Payload"s rather than a schema, so a string here would be their
  // prerogative and is cheaper to accept than to debug.
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * A coordinate pair that is missing, unparseable, or the null island is not a
 * position. 0,0 is in the Gulf of Guinea; a tracker reporting it has lost its
 * fix, and drawing a school bus there is worse than drawing nothing.
 */
export function parseTelemetryPosition(
  payload: TelemetryPayload | null | undefined,
  at: string,
): LivePosition | null {
  if (!payload || !at) return null;
  const lat = finiteNumber(payload.gpsLatitude);
  const lng = finiteNumber(payload.gpsLongitude);
  if (lat === null || lng === null) return null;
  if (lat === 0 && lng === 0) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const ignition = payload.ignitionOn;
  return {
    lat,
    lng,
    speed: finiteNumber(payload.speed),
    ignitionOn:
      typeof ignition === "boolean"
        ? ignition
        : ignition === "true"
          ? true
          : ignition === "false"
            ? false
            : null,
    at,
  };
}

export type PositionFreshness = "live" | "recent" | "stale" | "cold";

export const FRESHNESS_LIVE_MS = 3 * 60 * 1000;
export const FRESHNESS_RECENT_MS = 15 * 60 * 1000;
export const FRESHNESS_STALE_MS = 60 * 60 * 1000;

/**
 * How much a position is worth right now. The bands are deliberately
 * conservative: Fleet Edge pushes roughly every 30 seconds while a vehicle is
 * awake, so anything past three minutes has already missed several pushes.
 */
export function positionFreshness(atIso: string, nowMs: number): PositionFreshness {
  const age = nowMs - Date.parse(atIso);
  if (!Number.isFinite(age)) return "cold";
  if (age < FRESHNESS_LIVE_MS) return "live";
  if (age < FRESHNESS_RECENT_MS) return "recent";
  if (age < FRESHNESS_STALE_MS) return "stale";
  return "cold";
}

/** "just now", "4 min ago", "2 h ago" — for a human reading a screen. */
export function positionAgeLabel(atIso: string, nowMs: number): string {
  const age = nowMs - Date.parse(atIso);
  if (!Number.isFinite(age) || age < 0) return "unknown";
  const mins = Math.floor(age / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return "1 h ago";
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

export type VehicleMotion = "moving" | "idling" | "parked" | "unknown";

/**
 * What the vehicle is doing, as far as the last ping can say.
 *
 * Ignition is the primary signal because a bus waiting at a stop with the
 * engine running is still on its run, and calling that "parked" would read as
 * "the bus has finished" to anyone watching.
 */
export function vehicleMotion(pos: LivePosition | null): VehicleMotion {
  if (!pos) return "unknown";
  const moving = (pos.speed ?? 0) > 3;
  if (moving) return "moving";
  if (pos.ignitionOn === true) return "idling";
  if (pos.ignitionOn === false) return "parked";
  return "unknown";
}

/**
 * A Google Maps link, which is what a person actually wants from a
 * coordinate pair. Six decimals is about 10 cm — more is noise.
 */
export function mapsLink(pos: { lat: number; lng: number }): string {
  return `https://www.google.com/maps?q=${pos.lat.toFixed(6)},${pos.lng.toFixed(6)}`;
}

/**
 * When a parent may ask where the bus is.
 *
 * The decision on 2026-09-10 was: only while the vehicle is on a trip. A bus
 * sits overnight at the driver's home, and 168 families do not need that
 * address. Ignition is the truth; the windows are the fallback for when the
 * feed has gone quiet, so a parent asking mid-run still gets an answer rather
 * than a flat refusal.
 *
 * IST minutes-of-day, because the school runs on one clock.
 */
export const TRIP_WINDOWS_IST = [
  { from: 6 * 60, to: 9 * 60 + 30, label: "morning" },
  { from: 11 * 60 + 30, to: 16 * 60, label: "afternoon" },
] as const;

export function istMinutesOfDay(nowMs: number): number {
  // +05:30, no DST in India.
  const ist = new Date(nowMs + 5.5 * 60 * 60 * 1000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

export function inTripWindow(nowMs: number): boolean {
  const m = istMinutesOfDay(nowMs);
  return TRIP_WINDOWS_IST.some((w) => m >= w.from && m < w.to);
}

export type ParentPositionVerdict =
  | { share: true; position: LivePosition; freshness: PositionFreshness }
  | { share: false; reason: "no-vehicle" | "no-feed" | "off-trip" | "too-old" };

/**
 * Whether this position may be given to a parent, and if not, why.
 *
 * Deliberately strict in one direction: every "no" is a specific reason the
 * caller can turn into an honest sentence. Nothing here invents a position,
 * and a stale fix is refused rather than dressed up — the failure this guards
 * against is a parent driving to where the bus was twenty minutes ago.
 */
export function parentPositionVerdict(input: {
  position: LivePosition | null;
  hasVehicle: boolean;
  nowMs: number;
}): ParentPositionVerdict {
  if (!input.hasVehicle) return { share: false, reason: "no-vehicle" };
  if (!input.position) return { share: false, reason: "no-feed" };

  const freshness = positionFreshness(input.position.at, input.nowMs);
  if (freshness === "cold" || freshness === "stale") {
    return { share: false, reason: "too-old" };
  }

  // Ignition on means the run is happening whatever the clock says; the
  // window covers a feed that has briefly gone quiet mid-run.
  const onTrip = input.position.ignitionOn === true || inTripWindow(input.nowMs);
  if (!onTrip) return { share: false, reason: "off-trip" };

  return { share: true, position: input.position, freshness };
}
