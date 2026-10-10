import { NextRequest, NextResponse } from "next/server";
import { fetchPlacePredictions } from "@/lib/mapsPlaces";
import { mapsRateLimited } from "@/lib/mapsRateLimit";

export async function GET(req: NextRequest) {
  if (mapsRateLimited(req)) {
    return NextResponse.json({ error: "Too many requests", predictions: [] }, { status: 429 });
  }
  const input = req.nextUrl.searchParams.get("input")?.trim() || "";
  const session = req.nextUrl.searchParams.get("session")?.trim() || "";

  if (input.length < 3) {
    return NextResponse.json({ predictions: [] });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "GOOGLE_MAPS_API_KEY not configured", predictions: [] },
      { status: 503 },
    );
  }

  const predictions = await fetchPlacePredictions(input, apiKey, session || undefined);
  return NextResponse.json({ predictions });
}
