/**
 * A free road-distance tier for /api/maps/road-distance.
 *
 * Today that route has two answers: Google Distance Matrix when a key is
 * set (accurate, billed per call), and otherwise a GUESS — a ring around
 * the school plus jitter derived from the length of the address string.
 * The guess exists so a planning screen has something to show, and the
 * route already refuses to give it to `strict` callers, because a stop's
 * distance sets what every family at that stop is billed and an estimate
 * there would become an invoice.
 *
 * This module adds a third answer between them: a real routing engine on
 * OpenStreetMap data, for nothing.
 *
 * ── The two decisions that matter ───────────────────────────────────────
 *
 * 1. **It does not default to somebody else's demo server.** OSRM publishes
 *    one, and pointing a school's production traffic at it would be exactly
 *    the discourtesy that gets free services withdrawn. A free engine is
 *    used only when the school has configured one: an OpenRouteService key
 *    (free tier, ~2,000 calls/day) or a self-hosted OSRM.
 *
 * 2. **Free distances are not billable until the school says so.** OSM road
 *    coverage around Varanasi is good in the city and patchy on village
 *    approach roads, and nobody here can judge that from a terminal — the
 *    school can, by comparing a dozen stops against Google. So by default a
 *    free distance serves planning screens (where it is strictly better
 *    than the jitter guess) and `strict` billing callers still get nothing,
 *    exactly as today. One flag promotes it once the school has checked.
 *
 * Pure and client-safe; the fetching is in freeRouting.server.ts.
 */

export type RoutingSource = "google" | "free" | "estimate" | "unavailable";

/** Which engine the school configured, if any. */
export type FreeRoutingEngine =
  | { kind: "ors"; apiKey: string }
  | { kind: "osrm"; baseUrl: string }
  | null;

/**
 * Read the engine from the environment. ORS wins when both are set: it is
 * a supported service with a quota, where a self-hosted OSRM is whatever
 * the school last deployed.
 */
export function freeRoutingEngine(env: {
  ORS_API_KEY?: string;
  OSRM_BASE_URL?: string;
}): FreeRoutingEngine {
  const ors = (env.ORS_API_KEY || "").trim();
  if (ors) return { kind: "ors", apiKey: ors };
  const osrm = (env.OSRM_BASE_URL || "").trim().replace(/\/+$/, "");
  // Must be a real http(s) origin — a half-set variable should disable the
  // tier, not produce a request to "undefined/route/v1/...".
  if (/^https?:\/\/[^\s/]+/.test(osrm)) return { kind: "osrm", baseUrl: osrm };
  return null;
}

/**
 * May a free distance become an invoice?
 *
 * Default no. This is the one switch that changes what a family pays, so it
 * is opt-in, spelled exactly, and never inferred from "an engine is
 * configured".
 */
export function freeRoutingBillable(env: { ROUTING_FREE_BILLABLE?: string }): boolean {
  return (env.ROUTING_FREE_BILLABLE || "").trim() === "true";
}

/** Sources a `strict` caller is allowed to bill from. */
export function billableSources(billableFree: boolean): RoutingSource[] {
  return billableFree ? ["google", "free"] : ["google"];
}

export function isBillableSource(source: string, billableFree: boolean): boolean {
  return (billableSources(billableFree) as string[]).includes(source);
}

/* ── Requests ────────────────────────────────────────────────────────── */

export type LatLng = { lat: number; lng: number };

export function validLatLng(v: unknown): v is LatLng {
  if (!v || typeof v !== "object") return false;
  const { lat, lng } = v as LatLng;
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    // 0,0 is in the Atlantic and is what an unparsed coordinate becomes.
    !(lat === 0 && lng === 0)
  );
}

/**
 * Build the request. Both engines speak lon,lat — the reverse of how every
 * screen in this app writes a coordinate — which is the single easiest
 * thing to get wrong here, so the swap happens once, in one place, and the
 * self-test pins it.
 */
export function freeRoutingRequest(
  engine: NonNullable<FreeRoutingEngine>,
  from: LatLng,
  to: LatLng,
): { url: string; init: RequestInit } {
  if (engine.kind === "osrm") {
    return {
      url:
        `${engine.baseUrl}/route/v1/driving/` +
        `${from.lng},${from.lat};${to.lng},${to.lat}?overview=false&alternatives=false`,
      init: { method: "GET", headers: { Accept: "application/json" } },
    };
  }
  return {
    url: "https://api.openrouteservice.org/v2/directions/driving-car/json",
    init: {
      method: "POST",
      headers: {
        Authorization: engine.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        coordinates: [
          [from.lng, from.lat],
          [to.lng, to.lat],
        ],
      }),
    },
  };
}

/* ── Responses ───────────────────────────────────────────────────────── */

function meters(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Metres out of whichever engine answered.
 *
 *   OSRM    { code: "Ok", routes: [{ distance }] }
 *   ORS json{ routes: [{ summary: { distance } }] }
 *   ORS geo { features: [{ properties: { summary: { distance } } }] }
 *
 * All three are read, because ORS's response format follows the URL suffix
 * and a future caller that asks for GeoJSON should not silently get no
 * distance. Anything else returns null rather than throwing.
 */
export function parseFreeRoutingMeters(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  // OSRM says so explicitly when it could not route.
  const code = typeof o.code === "string" ? o.code : "";
  if (code && code !== "Ok") return null;

  const routes = Array.isArray(o.routes) ? o.routes : [];
  for (const r of routes) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    const direct = meters(row.distance);
    if (direct !== null) return direct;
    const summary = row.summary;
    if (summary && typeof summary === "object") {
      const viaSummary = meters((summary as Record<string, unknown>).distance);
      if (viaSummary !== null) return viaSummary;
    }
  }

  const features = Array.isArray(o.features) ? o.features : [];
  for (const f of features) {
    if (!f || typeof f !== "object") continue;
    const props = (f as Record<string, unknown>).properties;
    if (!props || typeof props !== "object") continue;
    const summary = (props as Record<string, unknown>).summary;
    if (summary && typeof summary === "object") {
      const d = meters((summary as Record<string, unknown>).distance);
      if (d !== null) return d;
    }
  }
  return null;
}

/** Metres to the one decimal place every distance in this app is stored at. */
export function kmFromMeters(m: number): number {
  return Math.round((m / 1000) * 10) / 10;
}

/**
 * A route longer than this from a school in Varanasi is not a school run —
 * it is the engine having snapped a coordinate onto the wrong continent, or
 * routed around a missing bridge. Refuse it rather than bill it.
 */
export const MAX_PLAUSIBLE_KM = 120;

export function plausibleSchoolRunKm(km: number): boolean {
  return Number.isFinite(km) && km > 0 && km <= MAX_PLAUSIBLE_KM;
}
