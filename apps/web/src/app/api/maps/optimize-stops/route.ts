import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { TENANT } from "@/lib/types";

/**
 * Best driving order for a route's stops, from Google Directions.
 *
 * Deliberately NOT a language model. Ordering stops is a travelling-salesman
 * problem over a real road network — Directions solves it against actual roads,
 * turn restrictions and one-ways. A model asked to order stop names would be
 * guessing at geography it cannot see, and would produce a confident sequence
 * that no bus can drive.
 *
 * Staff-only and permission-gated, unlike the autocomplete and geocode proxies
 * which the public enquiry form needs. Waypoint optimisation is the most
 * expensive Maps call in the app and there is no reason for it to be reachable
 * without a session.
 *
 * The bus leaves campus, works the stops, and returns to campus, so the request
 * is a loop with the school at both ends and every stop as an optimised
 * waypoint. The order Google returns is the pickup sequence.
 */

export const runtime = "nodejs";

type StopInput = { id: string; name: string; lat: number; lng: number };

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "edit");
  if (!auth.ok) return auth.response;

  let body: { stops?: StopInput[] };
  try {
    body = (await req.json()) as { stops?: StopInput[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const stops = (body.stops ?? []).filter(
    (s) =>
      s &&
      typeof s.lat === "number" &&
      typeof s.lng === "number" &&
      Number.isFinite(s.lat) &&
      Number.isFinite(s.lng) &&
      (s.lat !== 0 || s.lng !== 0),
  );

  // Two stops have exactly one sensible order; there is nothing to optimise.
  if (stops.length < 3) {
    return NextResponse.json({
      ok: false,
      error:
        "At least three pinned stops are needed before an order can be suggested.",
    });
  }
  // Directions allows 25 waypoints on the standard plan.
  if (stops.length > 23) {
    return NextResponse.json({
      ok: false,
      error: `${stops.length} pinned stops — Google can optimise at most 23 in one route. Split the route first.`,
    });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "GOOGLE_MAPS_API_KEY not configured" },
      { status: 503 },
    );
  }

  const school = `${TENANT.schoolLat},${TENANT.schoolLng}`;
  const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
  url.searchParams.set("origin", school);
  url.searchParams.set("destination", school);
  url.searchParams.set(
    "waypoints",
    `optimize:true|${stops.map((s) => `${s.lat},${s.lng}`).join("|")}`,
  );
  url.searchParams.set("mode", "driving");
  url.searchParams.set("units", "metric");
  url.searchParams.set("key", apiKey);

  try {
    const res = await fetch(url.toString(), { cache: "no-store" });
    const data = (await res.json()) as {
      status?: string;
      error_message?: string;
      routes?: {
        waypoint_order?: number[];
        legs?: {
          distance?: { value?: number };
          duration?: { value?: number };
        }[];
      }[];
    };

    if (data.status !== "OK" || !data.routes?.length) {
      return NextResponse.json({
        ok: false,
        error:
          data.error_message ||
          `Google could not build a route for these stops (${data.status ?? "no status"})`,
      });
    }

    const route = data.routes[0];
    const order = route.waypoint_order;
    if (!Array.isArray(order) || order.length !== stops.length) {
      // Without a complete ordering we have nothing trustworthy to return.
      // Half an answer here would silently drop stops from a bus route.
      return NextResponse.json({
        ok: false,
        error: "Google returned an incomplete ordering — nothing was changed.",
      });
    }

    const totalMeters =
      route.legs?.reduce((n, l) => n + (l.distance?.value ?? 0), 0) ?? 0;
    const totalSeconds =
      route.legs?.reduce((n, l) => n + (l.duration?.value ?? 0), 0) ?? 0;

    return NextResponse.json({
      ok: true,
      /** Stop ids in the suggested pickup order. */
      orderedStopIds: order.map((i) => stops[i].id),
      totalKm: Math.round((totalMeters / 1000) * 10) / 10,
      totalMinutes: Math.round(totalSeconds / 60),
    });
  } catch {
    return NextResponse.json({
      ok: false,
      error: "Could not reach the Directions service",
    });
  }
}
