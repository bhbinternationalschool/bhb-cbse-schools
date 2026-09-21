import "server-only";

/**
 * Aadhaar centres near a point, from Google Places (the same key and API
 * the village-travel planner uses). See aadhaarCentres.ts for which ones
 * are offered. Cached per ~1 km cell for a day: families in one village
 * share the answer, and Places is paid per call.
 */

import { pickAadhaarCentres, type AadhaarCentre, type PlaceResult } from "@/lib/aadhaarCentres";

const cache = new Map<string, { at: number; centres: AadhaarCentre[] }>();
const DAY = 86_400_000;

export async function nearbyAadhaarCentres(from: { lat: number; lng: number }, max = 3): Promise<AadhaarCentre[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey || !Number.isFinite(from.lat) || !Number.isFinite(from.lng)) return [];
  const key = `${from.lat.toFixed(2)},${from.lng.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < DAY) return hit.centres.slice(0, max);

  const results: PlaceResult[] = [];
  for (const query of ["Aadhaar Seva Kendra", "Aadhaar enrolment centre"]) {
    try {
      const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
      url.searchParams.set("query", query);
      url.searchParams.set("location", `${from.lat},${from.lng}`);
      url.searchParams.set("radius", "15000");
      url.searchParams.set("region", "in");
      url.searchParams.set("key", apiKey);
      const res = await fetch(url.toString());
      if (!res.ok) continue;
      const data = (await res.json()) as { status?: string; results?: PlaceResult[] };
      if (data.status === "OK") results.push(...(data.results ?? []));
    } catch (e) {
      console.warn("[aadhaarCentres] places lookup failed", (e as Error)?.message);
    }
  }
  const centres = pickAadhaarCentres(results, from, { max: 3 });
  // An empty answer is not cached: it is more often a failure than a fact.
  if (centres.length) cache.set(key, { at: Date.now(), centres });
  return centres.slice(0, max);
}
