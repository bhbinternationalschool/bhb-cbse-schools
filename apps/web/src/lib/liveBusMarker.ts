/**
 * How a bus is drawn on the live map, and when it is allowed to move.
 *
 * The map has shown every vehicle as a blue circle since it was built, and
 * rebuilt every marker from scratch on each 30-second poll — so a bus did not
 * travel across the screen, it vanished and reappeared somewhere else. This
 * decides the shape, the heading and the animation, away from the Google
 * Maps API so the rules can be tested.
 *
 * THREE THINGS IT REFUSES TO DO
 *
 * 1. Point a parked bus. `courseDeg` is the heading of the last ping, and a
 *    stationary tracker keeps reporting whatever it last saw. Rotating an
 *    icon by it makes a bus parked at the school appear to be driving north.
 *    A vehicle that is not moving gets a non-directional icon.
 *
 * 2. Animate a teleport. Two fixes 6 km apart 30 seconds apart is 720 km/h —
 *    a dropped fix or a tracker glitch, not a journey. Sliding the icon along
 *    that line draws a bus taking a route it never took, through fields.
 *    Implausible jumps snap instead, which reads as what it is: a correction.
 *
 * 3. Animate a stale bus. A fix an hour old is not a position, and a marker
 *    gliding across the map is the strongest "this is happening now" signal
 *    a screen has. Stale and cold vehicles are drawn faded and still.
 *
 * The animation itself is honest: it interpolates between two fixes the
 * server has ALREADY reported, after both are known. Nothing is ever drawn
 * ahead of the last ping — that would be predicting where a bus full of
 * children is, from a feed that reports once every thirty seconds.
 */

import type { PositionFreshness } from "@/lib/fleetLivePosition";

/** Above this, the implied speed between two fixes is not a journey. */
export const MAX_ANIMATE_KMH = 120;
/** At or below this, treat the vehicle as stationary for heading purposes. */
export const MOVING_KMH = 3;
/** How long a marker takes to slide between two fixes. */
export const ANIMATE_MS = 900;

export type LiveBusMotion = "moving" | "stopped" | "unknown";

export type LiveBusPositionInput = {
  lat: number;
  lng: number;
  speedKmh: number | null;
  courseDeg: number | null;
  freshness: PositionFreshness;
  ignitionOn?: boolean | null;
};

/**
 * A compass bearing, or null when the tracker did not give a usable one.
 *
 * Production carries one ping reading 361, which is not a bearing. 0 IS a
 * real bearing here — it appears on pings with the vehicle moving — so it
 * must not be treated as a missing-value sentinel.
 */
export function normalizeCourseDeg(v: number | null | undefined): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v < 0 || v > 360) return null;
  // 360 and 0 are the same heading; normalise so a rotation never jumps a
  // full turn between two consecutive pings.
  return v === 360 ? 0 : v;
}

/** Is this vehicle actually moving? Unknown stays unknown. */
export function busMotion(p: {
  speedKmh: number | null;
  ignitionOn?: boolean | null;
}): LiveBusMotion {
  if (typeof p.speedKmh === "number" && Number.isFinite(p.speedKmh)) {
    return p.speedKmh > MOVING_KMH ? "moving" : "stopped";
  }
  // No speed reported. The ignition alone cannot tell moving from idling, so
  // it is not promoted to "moving" — but ignition off is definitely stopped.
  if (p.ignitionOn === false) return "stopped";
  return "unknown";
}

export type LiveBusStyle = {
  /** Fill for the icon body. */
  fill: string;
  /** 0-1. Faded when the fix is old enough that it is not a position. */
  opacity: number;
  /** Degrees to rotate the icon, or null to draw it non-directional. */
  rotation: number | null;
  /** True when the icon should be the pointed, travelling shape. */
  directional: boolean;
  motion: LiveBusMotion;
};

/**
 * Colour by how old the fix is, not by how fast the bus is going.
 *
 * Freshness is the thing a viewer most needs and least expects to have to
 * ask about: a green bus is one we heard from moments ago, an amber one is
 * minutes old, a grey one is a last known position and not a live one.
 */
const FRESHNESS_FILL: Record<PositionFreshness, string> = {
  live: "var(--tone-green-solid, #15803d)",
  recent: "var(--tone-amber-solid, #b45309)",
  stale: "var(--muted, #5c6478)",
  cold: "var(--muted, #5c6478)",
};

const FRESHNESS_OPACITY: Record<PositionFreshness, number> = {
  live: 1,
  recent: 1,
  stale: 0.55,
  cold: 0.4,
};

export function liveBusStyle(p: LiveBusPositionInput): LiveBusStyle {
  const motion = busMotion(p);
  const course = normalizeCourseDeg(p.courseDeg);
  // Only a vehicle we believe is moving gets pointed. See the header: a
  // parked bus's last heading is not where it is facing now, and even if it
  // were, an arrow says "travelling" to anyone glancing at the screen.
  const directional = motion === "moving" && course != null;
  return {
    fill: FRESHNESS_FILL[p.freshness],
    opacity: FRESHNESS_OPACITY[p.freshness],
    rotation: directional ? course : null,
    directional,
    motion,
  };
}

/**
 * The rotation actually applied to the icon, given what it was showing before.
 *
 * `liveBusStyle().rotation` is null for a vehicle that is not moving, which
 * means "no heading to show" — NOT "keep the last one". Carrying the previous
 * value through drew the stopped icon, a tall rounded rectangle, tilted at
 * whatever bearing the tracker last reported: a parked bus leaning over at
 * 300 degrees. Non-directional means upright.
 *
 * When there IS a heading, it is resolved the short way round from where the
 * icon currently points, so a bus turning from 350 to 10 does not spin most
 * of a circle backwards.
 */
export function appliedRotation(
  style: Pick<LiveBusStyle, "rotation" | "directional">,
  previousRotation: number,
): number {
  if (!style.directional || style.rotation == null) return 0;
  return shortestRotation(previousRotation, style.rotation);
}

/** Metres between two coordinates. */
export function metresBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export type AnimateDecision =
  | { animate: true; durationMs: number }
  | { animate: false; reason: "first-fix" | "no-movement" | "implausible" | "not-fresh" };

/**
 * May the marker slide from the old fix to the new one?
 *
 * `elapsedMs` is the gap between the two pings' own timestamps, not between
 * the two polls — a poll can return the same ping twice, and a stale ping
 * re-delivered must not be re-animated.
 */
export function decideAnimation(input: {
  from: { lat: number; lng: number } | null;
  to: { lat: number; lng: number };
  elapsedMs: number;
  freshness: PositionFreshness;
}): AnimateDecision {
  if (!input.from) return { animate: false, reason: "first-fix" };

  // A bus we have not heard from in a long time is not travelling now, and a
  // marker in motion is the strongest claim a map makes that it is.
  if (input.freshness === "stale" || input.freshness === "cold") {
    return { animate: false, reason: "not-fresh" };
  }

  const metres = metresBetween(input.from, input.to);
  // Under a few metres is GPS jitter around a stationary vehicle. Animating
  // it makes a parked bus twitch continuously.
  if (metres < 5) return { animate: false, reason: "no-movement" };

  if (input.elapsedMs > 0) {
    const kmh = (metres / 1000) / (input.elapsedMs / 3_600_000);
    if (kmh > MAX_ANIMATE_KMH) return { animate: false, reason: "implausible" };
  }

  return { animate: true, durationMs: ANIMATE_MS };
}

/** Linear interpolation between two fixes. `t` is 0-1 and is clamped. */
export function interpolate(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  t: number,
): { lat: number; lng: number } {
  const k = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return {
    lat: from.lat + (to.lat - from.lat) * k,
    lng: from.lng + (to.lng - from.lng) * k,
  };
}

/**
 * Ease so the marker starts and stops gently rather than jerking between
 * fixes. Cosmetic, and kept here so the animation loop has no maths in it.
 */
export function easeInOut(t: number): number {
  const k = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
}

/**
 * Rotate the short way round.
 *
 * Without this a bus turning from 350° to 10° spins 340° backwards across the
 * screen — the long way round a turn it took in a few metres.
 */
export function shortestRotation(fromDeg: number, toDeg: number): number {
  const diff = ((toDeg - fromDeg + 540) % 360) - 180;
  return fromDeg + diff;
}

/**
 * A bus seen from above, nose up, drawn around its own centre.
 *
 * An SVG path rather than an image: Google rotates and recolours a Symbol
 * without a round trip, and the map must keep working when the network does
 * not. Coordinates are centred on 0,0 so `rotation` turns it about its middle
 * instead of swinging it around a corner.
 */
export const BUS_ICON_PATH =
  "M -6 -11 C -6 -12.5 -5 -13.5 -3.5 -13.5 L 3.5 -13.5 C 5 -13.5 6 -12.5 6 -11 " +
  "L 6 9 C 6 10.5 5 11.5 3.5 11.5 L 2.5 11.5 L 2.5 13 C 2.5 13.6 2 14 1.5 14 " +
  "L -1.5 14 C -2 14 -2.5 13.6 -2.5 13 L -2.5 11.5 L -3.5 11.5 " +
  "C -5 11.5 -6 10.5 -6 9 Z " +
  // windscreen, so the nose is readable at small sizes
  "M -4.2 -10.6 L 4.2 -10.6 L 4.2 -6.4 L -4.2 -6.4 Z";

/** A plain rounded marker for a vehicle that is not moving. */
export const BUS_STOPPED_PATH =
  "M -5.5 -5.5 C -5.5 -7 -4.5 -8 -3 -8 L 3 -8 C 4.5 -8 5.5 -7 5.5 -5.5 " +
  "L 5.5 5.5 C 5.5 7 4.5 8 3 8 L -3 8 C -4.5 8 -5.5 7 -5.5 5.5 Z";
