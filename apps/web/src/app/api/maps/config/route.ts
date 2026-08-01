import { NextResponse } from "next/server";
import { TENANT } from "@/lib/types";

/** Browser Maps JS key — prefer NEXT_PUBLIC_*; falls back to server key (restrict by HTTP referrer). */
export async function GET() {
  const mapsJsKey =
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    null;

  return NextResponse.json({
    mapsJsKey,
    school: {
      lat: TENANT.schoolLat,
      lng: TENANT.schoolLng,
      name: TENANT.name,
      address: TENANT.schoolAddress,
    },
  });
}
