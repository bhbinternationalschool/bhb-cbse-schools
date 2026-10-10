import "server-only";

/**
 * The one network call for the free routing tier. Every rule lives in
 * freeRouting.ts; this is fetch, a timeout, and a refusal to throw.
 */

import {
  freeRoutingEngine,
  freeRoutingRequest,
  kmFromMeters,
  parseFreeRoutingMeters,
  plausibleSchoolRunKm,
  type LatLng,
} from "@/lib/freeRouting";

/** A transport screen waits on this while a person watches, so keep it short. */
const TIMEOUT_MS = 5_000;

/**
 * Road kilometres between two points, or null.
 *
 * Null covers every reason equally — no engine configured, a timeout, a
 * quota refusal, an unroutable pair, an implausible answer — because the
 * caller does the same thing in all of them: fall through to whatever the
 * route would have done without this tier.
 */
export async function freeRoadDistanceKm(
  from: LatLng,
  to: LatLng,
): Promise<number | null> {
  const engine = freeRoutingEngine({
    ORS_API_KEY: process.env.ORS_API_KEY,
    OSRM_BASE_URL: process.env.OSRM_BASE_URL,
  });
  if (!engine) return null;

  try {
    const { url, init } = freeRoutingRequest(engine, from, to);
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // A stop does not move, so a day's cache keeps the free quota for
      // stops the school has not measured yet.
      next: { revalidate: 86_400 },
    });
    if (!res.ok) return null;
    const meters = parseFreeRoutingMeters(await res.json());
    if (meters === null) return null;
    const km = kmFromMeters(meters);
    // A snapped-to-the-wrong-continent answer is worse than no answer,
    // because a plausible-looking number reaches an invoice.
    return plausibleSchoolRunKm(km) ? km : null;
  } catch {
    return null;
  }
}
