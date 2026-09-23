import { NextRequest, NextResponse } from "next/server";
import { TENANT } from "@/lib/types";
import { mapsRateLimited } from "@/lib/mapsRateLimit";
import { freeRoutingBillable, validLatLng } from "@/lib/freeRouting";
import { freeRoadDistanceKm } from "@/lib/freeRouting.server";

/**
 * Road distance (km) from origin address to destination (school by default).
 *
 * Three answers, in order of how much they can be trusted:
 *
 *   "google"   Distance Matrix, when GOOGLE_MAPS_API_KEY is set. Billed.
 *   "free"     A routing engine on OpenStreetMap data (OpenRouteService or
 *              a self-hosted OSRM), when the school configured one. Free,
 *              and a REAL road distance — see lib/freeRouting.ts.
 *   "estimate" A guess: a ring around the school plus jitter from the
 *              length of the address. For planning screens only.
 *
 * `strict` callers bill families by the kilometre, so they are served only
 * from a source the school has accepted — Google always, "free" only once
 * ROUTING_FREE_BILLABLE is set. They get null rather than a guess.
 */

const SCHOOL_LAT = TENANT.schoolLat;
const SCHOOL_LNG = TENANT.schoolLng;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function GET(req: NextRequest) {
  if (mapsRateLimited(req)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const origin = req.nextUrl.searchParams.get("origin")?.trim() || "";
  const originLat = req.nextUrl.searchParams.get("originLat")?.trim();
  const originLng = req.nextUrl.searchParams.get("originLng")?.trim();
  const destination =
    req.nextUrl.searchParams.get("destination")?.trim() ||
    `${SCHOOL_LAT},${SCHOOL_LNG}`;
  const strict = req.nextUrl.searchParams.get("strict") === "1";

  if (!origin && !(originLat && originLng)) {
    return NextResponse.json({ error: "origin required" }, { status: 400 });
  }

  const origins =
    originLat && originLng ? `${originLat},${originLng}` : origin;

  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();

  if (apiKey) {
    try {
      const url = new URL(
        "https://maps.googleapis.com/maps/api/distancematrix/json",
      );
      url.searchParams.set("origins", origins);
      url.searchParams.set("destinations", destination);
      url.searchParams.set("mode", "driving");
      url.searchParams.set("units", "metric");
      url.searchParams.set("key", apiKey);

      const res = await fetch(url.toString(), { next: { revalidate: 86400 } });
      const data = (await res.json()) as {
        rows?: { elements?: { status?: string; distance?: { value?: number } }[] }[];
      };
      const meters = data.rows?.[0]?.elements?.[0]?.distance?.value;
      if (meters && meters > 0) {
        return NextResponse.json({
          km: Math.round((meters / 1000) * 10) / 10,
          source: "google",
        });
      }
    } catch {
      /* fall through */
    }
  }

  // Free tier. Reached when Google has no key or could not answer, so it
  // costs the school nothing and strictly improves on the guess below.
  //
  // It needs COORDINATES: neither engine geocodes, so a request carrying
  // only a typed address skips this and falls through, exactly as before.
  const billableFree = freeRoutingBillable({
    ROUTING_FREE_BILLABLE: process.env.ROUTING_FREE_BILLABLE,
  });
  const originGeo = originLat && originLng
    ? { lat: Number(originLat), lng: Number(originLng) }
    : null;
  // Only the school is a known destination; a typed one cannot be routed to.
  const destGeo = destination === `${SCHOOL_LAT},${SCHOOL_LNG}`
    ? { lat: SCHOOL_LAT, lng: SCHOOL_LNG }
    : null;
  if (validLatLng(originGeo) && validLatLng(destGeo) && (!strict || billableFree)) {
    const km = await freeRoadDistanceKm(originGeo, destGeo);
    if (km !== null) {
      return NextResponse.json({ km, source: "free" });
    }
  }

  // `strict` callers would rather have nothing than a guess. Transport stop
  // distances bill parents by the kilometre, so the estimate below — which is a
  // ring around the school plus jitter derived from the length of the address
  // string — must never reach a fee. Return no distance and say why.
  if (strict) {
    return NextResponse.json(
      {
        km: null,
        source: "unavailable",
        error: apiKey
          ? "Google returned no road distance for this origin"
          : "GOOGLE_MAPS_API_KEY not configured",
      },
      { status: 200 },
    );
  }

  // Rough estimate: assume origin is ~road factor 1.3× straight line from a ring around school
  const estimate = haversineKm(SCHOOL_LAT, SCHOOL_LNG, SCHOOL_LAT + 0.05, SCHOOL_LNG + 0.05);
  const jitter = (origin.length % 7) + 2;
  return NextResponse.json({
    km: Math.round((estimate * 1.3 + jitter) * 10) / 10,
    source: "estimate",
    note: apiKey
      ? "Google returned no result — using estimate"
      : "Set GOOGLE_MAPS_API_KEY for road distance",
  });
}
