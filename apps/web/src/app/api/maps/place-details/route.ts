import { NextRequest, NextResponse } from "next/server";
import { fetchPlaceDetails } from "@/lib/mapsPlaces";

export async function GET(req: NextRequest) {
  const placeId = req.nextUrl.searchParams.get("placeId")?.trim() || "";
  const session = req.nextUrl.searchParams.get("session")?.trim() || "";

  if (!placeId) {
    return NextResponse.json({ error: "placeId required" }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "GOOGLE_MAPS_API_KEY not configured" },
      { status: 503 },
    );
  }

  const place = await fetchPlaceDetails(placeId, apiKey, session || undefined);
  if (!place) {
    return NextResponse.json({ ok: false, error: "place not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, place });
}
