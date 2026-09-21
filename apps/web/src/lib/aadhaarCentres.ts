/**
 * Aadhaar centres near a family — chosen from what Google Maps lists, never
 * typed in by hand.
 *
 * A centre named in a message to a parent has to exist and be open: an
 * invented or closed address sends a family with a small child on a wasted
 * trip. So the names, addresses and pins come from Google Places at send
 * time, and this file only decides which of them to offer.
 *
 * Pure.
 */

export type PlaceResult = {
  place_id?: string;
  name?: string;
  formatted_address?: string;
  business_status?: string;
  user_ratings_total?: number;
  geometry?: { location?: { lat?: number; lng?: number } };
};

export type AadhaarCentre = {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  km: number;
  reviews: number;
  mapsUrl: string;
};

/** Straight-line distance, km, 1 decimal. */
export function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const r = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(r(b.lat - a.lat) / 2) ** 2 +
    Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))) * 10) / 10;
}

/** A link that opens this exact place in Google Maps (and its directions). */
export function mapsLinkFor(c: { name: string; placeId: string }): string {
  const q = encodeURIComponent(c.name);
  return `https://www.google.com/maps/search/?api=1&query=${q}${c.placeId ? `&query_place_id=${encodeURIComponent(c.placeId)}` : ""}`;
}

/**
 * The centres to offer, nearest first.
 *
 * Only places Google marks OPERATIONAL, and — when there is a choice —
 * only ones at least a few people have actually used (MIN_REVIEWS): a
 * listing with one review may be a shop that once did Aadhaar work. Within
 * `maxKm`, at most `max` of them.
 */
export const MIN_REVIEWS = 5;

export function pickAadhaarCentres(
  results: PlaceResult[],
  from: { lat: number; lng: number },
  opts: { max?: number; maxKm?: number } = {},
): AadhaarCentre[] {
  const max = opts.max ?? 3;
  const maxKm = opts.maxKm ?? 25;
  const seen = new Set<string>();
  const all: AadhaarCentre[] = [];
  for (const r of results) {
    const lat = r.geometry?.location?.lat;
    const lng = r.geometry?.location?.lng;
    const name = (r.name || "").trim();
    if (typeof lat !== "number" || typeof lng !== "number" || !name) continue;
    if (r.business_status && r.business_status !== "OPERATIONAL") continue;
    // Something that is not an Aadhaar service at all ("Common Services
    // Center" alone may be one; a hotel that matched the word is not).
    // "Aadhaar", "Aadhar", "Adhar" — all three spellings are on the map.
    if (!/aa?dh?aa?r|आधार|\bcsc\b|common service|seva kendra|sewa kendra/i.test(`${name} ${r.formatted_address || ""}`)) continue;
    const key = r.place_id || `${name}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const km = kmBetween(from, { lat, lng });
    if (km > maxKm) continue;
    const c: AadhaarCentre = {
      placeId: r.place_id || "",
      name,
      address: (r.formatted_address || "").replace(/,\s*India$/, ""),
      lat,
      lng,
      km,
      reviews: r.user_ratings_total ?? 0,
      mapsUrl: "",
    };
    c.mapsUrl = mapsLinkFor(c);
    all.push(c);
  }
  const used = all.filter((c) => c.reviews >= MIN_REVIEWS);
  const pool = used.length ? used : all;
  return pool.sort((a, b) => a.km - b.km).slice(0, max);
}
