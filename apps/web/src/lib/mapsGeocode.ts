/**
 * Google Geocoding helpers — server (API route) and shared address formatting.
 */

import type { Household } from "@/lib/sis";
import { TENANT } from "@/lib/types";

export type GeoConfidence = "high" | "low" | "failed";
export type GeoSource = "geocode" | "places" | "gps" | "manual";

export type GeocodeHit = {
  lat: number;
  lng: number;
  placeId: string;
  formattedAddress: string;
  confidence: GeoConfidence;
};

export type HouseholdGeoFields = {
  geoLat?: number;
  geoLng?: number;
  geoPlaceId?: string;
  geoFormattedAddress?: string;
  geoGeocodedAt?: string;
  geoSource?: GeoSource;
  geoConfidence?: GeoConfidence;
  geoAddressKey?: string;
};

export function formatHouseholdAddress(
  hh: Pick<
    Household,
    "address" | "locality" | "landmark" | "pincode" | "city" | "state"
  >,
): string {
  const parts = [
    hh.address,
    hh.landmark,
    hh.locality,
    hh.pincode,
    hh.city || TENANT.city,
    hh.state || TENANT.state,
  ].filter((p) => String(p || "").trim());
  return parts.join(", ");
}

export function householdGeoAddressKey(
  hh: Pick<
    Household,
    "address" | "locality" | "landmark" | "pincode" | "city" | "state"
  >,
): string {
  return [hh.address, hh.locality, hh.landmark, hh.pincode, hh.city, hh.state]
    .map((s) => String(s || "").trim().toLowerCase())
    .filter(Boolean)
    .join("|");
}

export function householdHasGeo(
  hh: Pick<
    Household,
    | "address"
    | "locality"
    | "landmark"
    | "pincode"
    | "city"
    | "state"
    | "geoLat"
    | "geoLng"
    | "geoConfidence"
    | "geoAddressKey"
  >,
): boolean {
  return (
    typeof hh.geoLat === "number" &&
    typeof hh.geoLng === "number" &&
    hh.geoConfidence !== "failed" &&
    hh.geoAddressKey === householdGeoAddressKey(hh)
  );
}

export function householdNeedsGeocode(
  hh: Pick<
    Household,
    | "address"
    | "locality"
    | "landmark"
    | "pincode"
    | "city"
    | "state"
    | keyof HouseholdGeoFields
  >,
): boolean {
  const key = householdGeoAddressKey(hh);
  if (!key) return false;
  if (!householdHasGeo(hh)) return true;
  return hh.geoAddressKey !== key;
}

function locationTypeConfidence(
  types: string[] | undefined,
): GeoConfidence {
  if (!types?.length) return "low";
  if (
    types.includes("street_address") ||
    types.includes("premise") ||
    types.includes("subpremise") ||
    types.includes("route")
  ) {
    return "high";
  }
  if (
    types.includes("neighborhood") ||
    types.includes("sublocality") ||
    types.includes("locality")
  ) {
    return "low";
  }
  return "low";
}

export async function geocodeAddressWithGoogle(
  address: string,
  apiKey: string,
): Promise<GeocodeHit | null> {
  const trimmed = address.trim();
  if (!trimmed || !apiKey.trim()) return null;

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", trimmed);
  url.searchParams.set("key", apiKey.trim());
  url.searchParams.set("region", "in");

  const res = await fetch(url.toString(), { next: { revalidate: 86400 } });
  const data = (await res.json()) as {
    status?: string;
    results?: {
      formatted_address?: string;
      place_id?: string;
      geometry?: { location?: { lat?: number; lng?: number } };
      types?: string[];
    }[];
  };

  if (data.status !== "OK" || !data.results?.[0]) return null;

  const hit = data.results[0];
  const lat = hit.geometry?.location?.lat;
  const lng = hit.geometry?.location?.lng;
  if (typeof lat !== "number" || typeof lng !== "number") return null;

  return {
    lat,
    lng,
    placeId: hit.place_id || "",
    formattedAddress: hit.formatted_address || trimmed,
    confidence: locationTypeConfidence(hit.types),
  };
}

export function applyGeocodeToHousehold(
  hh: Household,
  hit: GeocodeHit,
  source: GeoSource = "geocode",
): Household {
  return {
    ...hh,
    geoLat: hit.lat,
    geoLng: hit.lng,
    geoPlaceId: hit.placeId,
    geoFormattedAddress: hit.formattedAddress,
    geoGeocodedAt: new Date().toISOString(),
    geoSource: source,
    geoConfidence: hit.confidence,
    geoAddressKey: householdGeoAddressKey(hh),
  };
}

export function markHouseholdGeocodeFailed(hh: Household): Household {
  return {
    ...hh,
    geoLat: undefined,
    geoLng: undefined,
    geoPlaceId: undefined,
    geoFormattedAddress: undefined,
    geoGeocodedAt: new Date().toISOString(),
    geoSource: "geocode",
    geoConfidence: "failed",
    geoAddressKey: householdGeoAddressKey(hh),
  };
}
