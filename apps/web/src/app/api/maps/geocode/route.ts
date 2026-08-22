import { NextRequest, NextResponse } from "next/server";
import { geocodeAddressWithGoogle } from "@/lib/mapsGeocode";
import { mapsRateLimited } from "@/lib/mapsRateLimit";

const MAX_BATCH = 20;

/**
 * Geocode one address or a small batch (household backfill).
 * POST { address: string } | { addresses: string[] }
 * GET  ?address=...
 */

export async function GET(req: NextRequest) {
  if (mapsRateLimited(req)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  // Reverse: a pin dropped on the map has coordinates but no name yet.
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
    return reverseGeocode(lat, lng);
  }

  const address = req.nextUrl.searchParams.get("address")?.trim() || "";
  if (!address) {
    return NextResponse.json(
      { error: "address, or lat and lng, required" },
      { status: 400 },
    );
  }
  return geocodeOne(address);
}

export async function POST(req: NextRequest) {
  if (mapsRateLimited(req)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  let body: { address?: string; addresses?: string[] };
  try {
    body = (await req.json()) as { address?: string; addresses?: string[] };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const list = body.addresses?.map((a) => a.trim()).filter(Boolean) ?? [];
  if (body.address?.trim()) list.unshift(body.address.trim());

  if (list.length === 0) {
    return NextResponse.json({ error: "address or addresses required" }, { status: 400 });
  }
  if (list.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `max ${MAX_BATCH} addresses per request` },
      { status: 400 },
    );
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "GOOGLE_MAPS_API_KEY not configured", results: [] },
      { status: 503 },
    );
  }

  const results = [];
  for (const address of list) {
    const hit = await geocodeAddressWithGoogle(address, apiKey);
    results.push({
      address,
      ok: Boolean(hit),
      lat: hit?.lat,
      lng: hit?.lng,
      placeId: hit?.placeId,
      formattedAddress: hit?.formattedAddress,
      confidence: hit?.confidence,
    });
  }

  return NextResponse.json({ results });
}

/**
 * Coordinates → a human label for a dropped pin.
 *
 * Returns `ok: false` with the coordinates intact when Google has no address
 * for the spot, which is common for a field turning or an unnamed crossing.
 * That is not a failure — the pin is still exactly where the clerk put it, and
 * the stop keeps the name they typed. Only the label is missing.
 */
async function reverseGeocode(lat: number, lng: number) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "GOOGLE_MAPS_API_KEY not configured" },
      { status: 503 },
    );
  }
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("latlng", `${lat},${lng}`);
  url.searchParams.set("key", apiKey);
  try {
    const res = await fetch(url.toString(), { next: { revalidate: 86400 } });
    const data = (await res.json()) as {
      status?: string;
      results?: { formatted_address?: string; place_id?: string }[];
    };
    const hit = data.results?.[0];
    if (data.status !== "OK" || !hit?.formatted_address) {
      return NextResponse.json({
        ok: false,
        lat,
        lng,
        formattedAddress: "",
        note: "Google has no address for this spot — the pin is still valid.",
      });
    }
    return NextResponse.json({
      ok: true,
      lat,
      lng,
      formattedAddress: hit.formatted_address,
      placeId: hit.place_id ?? "",
    });
  } catch {
    return NextResponse.json({
      ok: false,
      lat,
      lng,
      formattedAddress: "",
      note: "Could not reach the geocoding service — the pin is still valid.",
    });
  }
}

async function geocodeOne(address: string) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "GOOGLE_MAPS_API_KEY not configured" },
      { status: 503 },
    );
  }

  const hit = await geocodeAddressWithGoogle(address, apiKey);
  if (!hit) {
    return NextResponse.json(
      { ok: false, error: "no geocode result" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    ok: true,
    lat: hit.lat,
    lng: hit.lng,
    placeId: hit.placeId,
    formattedAddress: hit.formattedAddress,
    confidence: hit.confidence,
  });
}
