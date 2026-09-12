/**
 * How far a child actually walks to a stop.
 *
 * WHY A STRAIGHT LINE IS NOT GOOD ENOUGH HERE
 * Every ranking in the transport desk so far measures haversine — fine for
 * "is this rider on completely the wrong bus", useless for choosing between
 * two stops 400 m apart. Around Varanasi the difference is the whole answer:
 * a stop 300 m away as the crow flies can be a kilometre on foot around a
 * canal, a rail line or a wall, and the nearer-looking stop is the one across
 * the highway that no parent will let a five-year-old cross.
 *
 * Walking mode, not driving. The bus drives; the child walks, and Google's
 * walking network includes the lanes and footbridges the driving network does
 * not — which is exactly where the two candidate stops differ.
 *
 * WHEN GOOGLE IS NOT AVAILABLE
 * The straight line comes back with `source: "straight"` and every caller is
 * expected to say so. A haversine figure presented as a walking distance is
 * optimistic by a wide margin around here, and a suggestion built on one would
 * read as measured when it is a guess.
 */

import { haversineKm } from "@/lib/transport";

export type WalkLeg = {
  km: number;
  /** Minutes on foot, only ever from Google. null on a straight line. */
  minutes: number | null;
  source: "google" | "straight";
};

/** Google's Distance Matrix takes at most 25 destinations in one request. */
const MAX_DESTINATIONS = 25;

export function mapsConfigured(): boolean {
  return !!process.env.GOOGLE_MAPS_API_KEY?.trim();
}

/**
 * Walking distance from one origin to several destinations, in order.
 *
 * Never throws and never returns a short array: a destination Google could not
 * answer for falls back to its straight line rather than dropping out, because
 * a missing candidate is invisible to the caller while a flagged one is not.
 */
export async function walkingDistances(
  origin: { lat: number; lng: number },
  destinations: { lat: number; lng: number }[],
): Promise<WalkLeg[]> {
  const straight = (d: { lat: number; lng: number }): WalkLeg => ({
    km: Math.round(haversineKm(origin.lat, origin.lng, d.lat, d.lng) * 100) / 100,
    minutes: null,
    source: "straight",
  });

  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey || destinations.length === 0) return destinations.map(straight);

  const out: WalkLeg[] = [];
  for (let i = 0; i < destinations.length; i += MAX_DESTINATIONS) {
    const batch = destinations.slice(i, i + MAX_DESTINATIONS);
    let elements:
      | { status?: string; distance?: { value?: number }; duration?: { value?: number } }[]
      | undefined;
    try {
      const url = new URL(
        "https://maps.googleapis.com/maps/api/distancematrix/json",
      );
      url.searchParams.set("origins", `${origin.lat},${origin.lng}`);
      url.searchParams.set(
        "destinations",
        batch.map((d) => `${d.lat},${d.lng}`).join("|"),
      );
      url.searchParams.set("mode", "walking");
      url.searchParams.set("units", "metric");
      url.searchParams.set("region", "in");
      url.searchParams.set("key", apiKey);
      // Stops and homes do not move. A day's cache turns a clerk trying three
      // children in the same village into one billable call.
      const res = await fetch(url.toString(), { next: { revalidate: 86400 } });
      const data = (await res.json()) as {
        status?: string;
        rows?: { elements?: typeof elements }[];
      };
      if (!data.status || data.status === "OK") {
        elements = data.rows?.[0]?.elements;
      }
    } catch {
      elements = undefined;
    }

    batch.forEach((d, j) => {
      const el = elements?.[j];
      const metres = el?.status === "OK" ? el.distance?.value : undefined;
      const seconds = el?.status === "OK" ? el.duration?.value : undefined;
      if (typeof metres === "number" && metres >= 0) {
        out.push({
          km: Math.round((metres / 1000) * 100) / 100,
          minutes:
            typeof seconds === "number" ? Math.max(1, Math.round(seconds / 60)) : null,
          source: "google",
        });
      } else {
        out.push(straight(d));
      }
    });
  }
  return out;
}
