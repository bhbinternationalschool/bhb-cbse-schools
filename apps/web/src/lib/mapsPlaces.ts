/**
 * Google Places — autocomplete + place details (address parsing for India).
 */

import type { GeoConfidence, GeoSource } from "@/lib/mapsGeocode";
import { householdGeoAddressKey } from "@/lib/mapsGeocode";
import { TENANT } from "@/lib/types";

export type PlacePrediction = {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
};

export type ResolvedPlaceAddress = {
  address: string;
  locality: string;
  landmark: string;
  city: string;
  state: string;
  pincode: string;
  formattedAddress: string;
  placeId: string;
  lat: number;
  lng: number;
  confidence: GeoConfidence;
};

export type HouseholdPlaceGeo = {
  geoLat: number;
  geoLng: number;
  geoPlaceId: string;
  geoFormattedAddress: string;
  geoGeocodedAt: string;
  geoSource: GeoSource;
  geoConfidence: GeoConfidence;
  geoAddressKey: string;
};

const VARANASI_BIAS = `${TENANT.schoolLat},${TENANT.schoolLng}`;

export async function fetchPlacePredictions(
  input: string,
  apiKey: string,
  sessionToken?: string,
): Promise<PlacePrediction[]> {
  const trimmed = input.trim();
  if (trimmed.length < 3 || !apiKey.trim()) return [];

  const url = new URL(
    "https://maps.googleapis.com/maps/api/place/autocomplete/json",
  );
  url.searchParams.set("input", trimmed);
  url.searchParams.set("key", apiKey.trim());
  url.searchParams.set("components", "country:in");
  url.searchParams.set("location", VARANASI_BIAS);
  url.searchParams.set("radius", "60000");
  if (sessionToken) url.searchParams.set("sessiontoken", sessionToken);

  const res = await fetch(url.toString(), { next: { revalidate: 0 } });
  const data = (await res.json()) as {
    status?: string;
    predictions?: {
      place_id?: string;
      description?: string;
      structured_formatting?: {
        main_text?: string;
        secondary_text?: string;
      };
    }[];
  };

  if (data.status !== "OK" || !data.predictions?.length) return [];

  return data.predictions
    .filter((p) => p.place_id && p.description)
    .map((p) => ({
      placeId: p.place_id!,
      description: p.description!,
      mainText: p.structured_formatting?.main_text || p.description!,
      secondaryText: p.structured_formatting?.secondary_text || "",
    }));
}

type AddressComponent = {
  long_name?: string;
  short_name?: string;
  types?: string[];
};

function pickComponent(
  components: AddressComponent[],
  ...types: string[]
): string {
  for (const type of types) {
    const hit = components.find((c) => c.types?.includes(type));
    if (hit?.long_name) return hit.long_name;
  }
  return "";
}

export function parsePlaceDetails(data: {
  place_id?: string;
  formatted_address?: string;
  name?: string;
  geometry?: { location?: { lat?: number; lng?: number } };
  address_components?: AddressComponent[];
  types?: string[];
}): ResolvedPlaceAddress | null {
  const lat = data.geometry?.location?.lat;
  const lng = data.geometry?.location?.lng;
  if (typeof lat !== "number" || typeof lng !== "number") return null;

  const components = data.address_components ?? [];
  const streetNumber = pickComponent(components, "street_number");
  const route = pickComponent(components, "route");
  const premise = pickComponent(components, "premise", "subpremise");
  const sublocality =
    pickComponent(
      components,
      "sublocality_level_1",
      "sublocality",
      "neighborhood",
    ) || pickComponent(components, "sublocality_level_2");
  const locality =
    pickComponent(components, "locality") ||
    sublocality ||
    pickComponent(components, "administrative_area_level_3");
  const city =
    pickComponent(components, "locality") ||
    pickComponent(components, "administrative_area_level_2") ||
    TENANT.city;
  const state =
    pickComponent(components, "administrative_area_level_1") ||
    TENANT.state;
  const pincode = pickComponent(components, "postal_code");

  const streetLine = [streetNumber, route, premise].filter(Boolean).join(" ");
  const address =
    streetLine ||
    data.name ||
    sublocality ||
    data.formatted_address?.split(",")[0]?.trim() ||
    "";

  const landmark =
    data.types?.includes("establishment") || data.types?.includes("point_of_interest")
      ? data.name || ""
      : premise || "";

  const confidence: GeoConfidence =
    streetLine && pincode
      ? "high"
      : pincode || sublocality
        ? "low"
        : "low";

  return {
    address,
    locality: sublocality || locality,
    landmark,
    city,
    state,
    pincode,
    formattedAddress: data.formatted_address || address,
    placeId: data.place_id || "",
    lat,
    lng,
    confidence,
  };
}

export async function fetchPlaceDetails(
  placeId: string,
  apiKey: string,
  sessionToken?: string,
): Promise<ResolvedPlaceAddress | null> {
  if (!placeId.trim() || !apiKey.trim()) return null;

  const url = new URL(
    "https://maps.googleapis.com/maps/api/place/details/json",
  );
  url.searchParams.set("place_id", placeId.trim());
  url.searchParams.set(
    "fields",
    "place_id,formatted_address,name,geometry,address_components,types",
  );
  url.searchParams.set("key", apiKey.trim());
  if (sessionToken) url.searchParams.set("sessiontoken", sessionToken);

  const res = await fetch(url.toString(), { next: { revalidate: 86400 } });
  const data = (await res.json()) as {
    status?: string;
    result?: Parameters<typeof parsePlaceDetails>[0];
  };

  if (data.status !== "OK" || !data.result) return null;
  return parsePlaceDetails(data.result);
}

export function householdGeoFromPlace(
  place: ResolvedPlaceAddress,
): HouseholdPlaceGeo {
  const addressKey = householdGeoAddressKey({
    address: place.address,
    locality: place.locality,
    landmark: place.landmark,
    pincode: place.pincode,
    city: place.city,
    state: place.state,
  });

  return {
    geoLat: place.lat,
    geoLng: place.lng,
    geoPlaceId: place.placeId,
    geoFormattedAddress: place.formattedAddress,
    geoGeocodedAt: new Date().toISOString(),
    geoSource: "places",
    geoConfidence: place.confidence,
    geoAddressKey: addressKey,
  };
}
