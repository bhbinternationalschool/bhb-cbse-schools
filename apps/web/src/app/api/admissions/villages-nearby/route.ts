/**
 * GET /api/admissions/villages-nearby
 *
 * Villages inside a radius of the school, each joined to its Census 2011
 * baseline, this year's projected 0-6 pool, and the leads our field agents
 * have actually registered there.
 *
 *   ?lat=25.405&lon=82.935&radius=10000&academicYearCode=2026-27
 *
 * Defaults are the school's own coordinates in Ayar, Varanasi with a 10 km
 * radius, so a bare call answers the office's usual question.
 *
 * Caching: the route itself is dynamic — it reads the staff session cookie,
 * so it can never be a static or shared cached response. The expensive part,
 * the Overpass round trip, is cached for 24 h inside
 * `lib/villageMarket.server.ts`; the `next: { revalidate: 86400 }` on that
 * fetch declares the same window. Census figures change once a decade and
 * OSM village nodes barely move, so a day-old village list is a correct one.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import {
  DEFAULT_ORIGIN,
  DEFAULT_RADIUS_M,
  type VillagesNearbyError,
} from "@/lib/villageMarket";
import {
  VillageMarketError,
  buildVillagesNearby,
  parseNearbyQuery,
} from "@/lib/villageMarket.server";

export const runtime = "nodejs";
// The route reads the staff session cookie, so it is always dynamic and can
// carry no `revalidate` of its own — Next rejects that pairing. The 24 h
// window lives on the Overpass fetch and its memo cache instead.
export const dynamic = "force-dynamic";

function fail(message: string, status: number, retryable: boolean) {
  const body: VillagesNearbyError = { ok: false, error: message, retryable };
  return NextResponse.json(body, { status });
}

export async function GET(request: Request) {
  const auth = await requireStaffPermission(request, "admissions", "view");
  if (!auth.ok) return auth.response;

  let query;
  try {
    query = parseNearbyQuery(new URL(request.url).searchParams, {
      lat: DEFAULT_ORIGIN.lat,
      lon: DEFAULT_ORIGIN.lon,
      radiusM: DEFAULT_RADIUS_M,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid query";
    return fail(message, 400, false);
  }

  try {
    const data = await buildVillagesNearby(query);
    return NextResponse.json(data, {
      headers: {
        // Per-staff-session data: a shared cache must never hold it, but the
        // browser may reuse it while the user flips between tabs.
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e) {
    if (e instanceof VillageMarketError) {
      console.warn(
        `[villages-nearby] ${e.status} ${e.message} lat=${query.lat} lon=${query.lon} r=${query.radiusM}`,
      );
      return fail(e.message, e.status, e.retryable);
    }
    const message = e instanceof Error ? e.message : "Unexpected error";
    console.error(`[villages-nearby] unhandled: ${message}`);
    return fail("Could not build the village market view. Try again.", 500, true);
  }
}
