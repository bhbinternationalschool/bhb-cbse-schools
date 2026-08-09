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
  const address = req.nextUrl.searchParams.get("address")?.trim() || "";
  if (!address) {
    return NextResponse.json({ error: "address required" }, { status: 400 });
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
