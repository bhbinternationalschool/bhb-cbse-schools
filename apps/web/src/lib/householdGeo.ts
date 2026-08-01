/**
 * Client-side household geocoding — calls /api/maps/geocode and persists on SIS.
 */

import {
  applyGeocodeToHousehold,
  formatHouseholdAddress,
  householdNeedsGeocode,
  markHouseholdGeocodeFailed,
  type GeocodeHit,
} from "@/lib/mapsGeocode";
import {
  loadSis,
  normalizeHousehold,
  saveSis,
  type Household,
  type SisState,
} from "@/lib/sis";

export type GeocodeBatchProgress = {
  done: number;
  total: number;
  householdId: string;
  ok: boolean;
};

async function geocodeAddressRemote(address: string): Promise<GeocodeHit | null> {
  const q = new URLSearchParams({ address });
  const res = await fetch(`/api/maps/geocode?${q}`);
  if (!res.ok) return null;
  const data = (await res.json()) as {
    ok?: boolean;
    lat?: number;
    lng?: number;
    placeId?: string;
    formattedAddress?: string;
    confidence?: GeocodeHit["confidence"];
  };
  if (!data.ok || typeof data.lat !== "number" || typeof data.lng !== "number") {
    return null;
  }
  return {
    lat: data.lat,
    lng: data.lng,
    placeId: data.placeId || "",
    formattedAddress: data.formattedAddress || address,
    confidence: data.confidence || "low",
  };
}

export async function geocodeHousehold(
  householdId: string,
  sis?: SisState,
): Promise<{ ok: true; household: Household } | { ok: false; error: string }> {
  const state = sis ?? loadSis();
  const idx = state.households.findIndex((h) => h.id === householdId);
  if (idx < 0) return { ok: false, error: "Household not found" };

  const hh = state.households[idx]!;
  const address = formatHouseholdAddress(hh);
  if (!address.trim()) {
    return { ok: false, error: "No address on household" };
  }

  const hit = await geocodeAddressRemote(address);
  const households = [...state.households];
  households[idx] = normalizeHousehold(
    hit ? applyGeocodeToHousehold(hh, hit) : markHouseholdGeocodeFailed(hh),
  );

  if (!sis) {
    saveSis({ ...state, households });
  }

  if (!hit) return { ok: false, error: "Geocoding failed — check address" };
  return { ok: true, household: households[idx]! };
}

export async function bulkGeocodeHouseholds(
  householdIds: string[],
  onProgress?: (p: GeocodeBatchProgress) => void,
): Promise<{
  ok: number;
  failed: number;
  skipped: number;
  households: Household[];
}> {
  const state = loadSis();
  const unique = [...new Set(householdIds)];
  let ok = 0;
  let failed = 0;
  let skipped = 0;
  const households = [...state.households];

  for (let i = 0; i < unique.length; i++) {
    const id = unique[i]!;
    const idx = households.findIndex((h) => h.id === id);
    if (idx < 0) {
      skipped += 1;
      onProgress?.({ done: i + 1, total: unique.length, householdId: id, ok: false });
      continue;
    }

    const hh = households[idx]!;
    if (!householdNeedsGeocode(hh)) {
      skipped += 1;
      onProgress?.({ done: i + 1, total: unique.length, householdId: id, ok: true });
      continue;
    }

    const address = formatHouseholdAddress(hh);
    if (!address.trim()) {
      skipped += 1;
      onProgress?.({ done: i + 1, total: unique.length, householdId: id, ok: false });
      continue;
    }

    const hit = await geocodeAddressRemote(address);
    households[idx] = normalizeHousehold(
      hit ? applyGeocodeToHousehold(hh, hit) : markHouseholdGeocodeFailed(hh),
    );
    if (hit) ok += 1;
    else failed += 1;
    onProgress?.({
      done: i + 1,
      total: unique.length,
      householdId: id,
      ok: Boolean(hit),
    });

    // Gentle pacing for Google Geocoding quotas
    if (i < unique.length - 1) {
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  saveSis({ ...state, households });
  return { ok, failed, skipped, households };
}

export function countHouseholdsNeedingGeocode(householdIds: string[]): number {
  const state = loadSis();
  const set = new Set(householdIds);
  return state.households.filter(
    (h) => set.has(h.id) && householdNeedsGeocode(h),
  ).length;
}
