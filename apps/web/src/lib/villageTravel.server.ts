/**
 * Admissions → village travel times.
 *
 * Real driving distance and duration from each village to the campus, so the
 * dashboard can rank by "can a bus actually serve this" rather than by a
 * straight line that ignores the Ganga, the level crossings and the fact that
 * two villages 4 km apart as the crow flies can be 20 minutes apart by road.
 *
 * COST IS THE DESIGN CONSTRAINT.
 * Census PCA carries no coordinates, so each village needs TWO paid Google
 * calls — a geocode, then a Distance Matrix element. At 1,292 villages that
 * is not something to run on a page load. So:
 *   · resolution is per block, on an explicit press;
 *   · results are cached in village_travel forever after (villages do not
 *     move, and the campus has not moved since 2011);
 *   · already-resolved villages are skipped, so a second press costs nothing;
 *   · a hard cap stops one click from spending a quota.
 *
 * When Google is unavailable or unconfigured we fall back to a straight line
 * and SAY SO in `source`, because around Varanasi a haversine figure is
 * optimistic by a wide margin and must never be mistaken for a road distance.
 */

import { createServiceSupabase } from "@/lib/supabase/server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { geocodeAddressWithGoogle } from "@/lib/mapsGeocode";
import { TENANT } from "@/lib/types";
import { haversineKm } from "@/lib/villageMarket";

const LOG = "[villageTravel]";

/** Ceiling per request. One press must not be able to spend a day's quota. */
export const MAX_RESOLVE_PER_CALL = 250;
/** Google's Distance Matrix takes at most 25 origins in one request. */
const MATRIX_BATCH = 25;

export class VillageTravelError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "VillageTravelError";
    this.status = status;
  }
}

export type TravelResolveResult = {
  ok: true;
  requested: number;
  alreadyCached: number;
  geocoded: number;
  routed: number;
  fellBackToStraightLine: number;
  failed: number;
  /** True when more villages in this block still need resolving. */
  more: boolean;
};

type Sb = NonNullable<ReturnType<typeof createServiceSupabase>>;

type Pending = {
  id: string;
  villageName: string;
  blockName: string;
  districtName: string;
  latitude: number | null;
  longitude: number | null;
};

/**
 * Distance Matrix for a batch of origins against the campus.
 *
 * Returns one entry per origin, in order, or null for an origin Google could
 * not route — a missing entry is "we do not know", not "distance zero".
 */
async function distanceMatrix(
  origins: { lat: number; lon: number }[],
  apiKey: string,
): Promise<({ km: number; minutes: number } | null)[]> {
  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", origins.map((o) => `${o.lat},${o.lon}`).join("|"));
  url.searchParams.set("destinations", `${TENANT.schoolLat},${TENANT.schoolLng}`);
  url.searchParams.set("mode", "driving");
  url.searchParams.set("region", "in");
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString(), { next: { revalidate: 86400 } });
  if (!res.ok) {
    throw new VillageTravelError(`Distance Matrix responded ${res.status}`, 502);
  }
  const data = (await res.json()) as {
    status?: string;
    error_message?: string;
    rows?: {
      elements?: {
        status?: string;
        distance?: { value?: number };
        duration?: { value?: number };
      }[];
    }[];
  };

  if (data.status && data.status !== "OK") {
    throw new VillageTravelError(
      `Distance Matrix: ${data.status}${data.error_message ? ` — ${data.error_message}` : ""}`,
      502,
    );
  }

  return origins.map((_, i) => {
    const el = data.rows?.[i]?.elements?.[0];
    if (!el || el.status !== "OK") return null;
    const metres = el.distance?.value;
    const seconds = el.duration?.value;
    if (typeof metres !== "number" || typeof seconds !== "number") return null;
    return {
      km: Math.round((metres / 1000) * 100) / 100,
      minutes: Math.round(seconds / 60),
    };
  });
}

/**
 * Resolve travel times for one block (or a specific set of villages).
 *
 * Villages already in village_travel are skipped, so this is safe to press
 * repeatedly — the second press resolves only what the first could not reach.
 */
export async function resolveBlockTravel(input: {
  blocks: string[];
  villageIds?: string[];
  limit?: number;
  /** Re-resolve villages already cached. Off by default: that costs money. */
  refresh?: boolean;
}): Promise<TravelResolveResult> {
  const ctx = await getServerTenantContext();
  if (!ctx) throw new VillageTravelError("Census database is not reachable.", 503);
  const sb = ctx.sb as Sb;
  const tenantId = ctx.tenantId;

  const limit = Math.min(MAX_RESOLVE_PER_CALL, Math.max(1, input.limit ?? MAX_RESOLVE_PER_CALL));

  let q = sb
    .from("village_demographics")
    .select("id, village_name, block_name, district_name, latitude, longitude")
    .eq("tenant_id", tenantId)
    .order("estimated_current_child_pop", { ascending: false });

  if (input.villageIds?.length) q = q.in("id", input.villageIds);
  else if (input.blocks.length) q = q.in("block_name", input.blocks);
  else {
    throw new VillageTravelError("Pick a block before resolving travel times.");
  }

  const { data, error } = await q.range(0, 999);
  if (error) {
    throw new VillageTravelError(`Could not read settlements: ${error.message}`, 502);
  }
  const all = (data as unknown as Pending[] | null) ?? [];
  if (!all.length) {
    throw new VillageTravelError("No settlements match that selection.", 404);
  }

  // Skip what is already cached — the whole point of caching.
  const { data: cachedRows, error: cachedError } = await sb
    .from("village_travel")
    .select("village_id")
    .eq("tenant_id", tenantId)
    .in("village_id", all.map((v) => v.id));
  if (cachedError) {
    throw new VillageTravelError(`Could not read the travel cache: ${cachedError.message}`, 502);
  }
  const cached = new Set(
    ((cachedRows as { village_id: string }[] | null) ?? []).map((r) => r.village_id),
  );

  const pending = (input.refresh ? all : all.filter((v) => !cached.has(v.id))).slice(0, limit);
  const result: TravelResolveResult = {
    ok: true,
    requested: all.length,
    alreadyCached: input.refresh ? 0 : cached.size,
    geocoded: 0,
    routed: 0,
    fellBackToStraightLine: 0,
    failed: 0,
    more: false,
  };
  if (!pending.length) return result;

  result.more = (input.refresh ? all.length : all.length - cached.size) > pending.length;

  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim() || "";

  /* ── 1. Coordinates ─────────────────────────────────────── */

  type Located = Pending & { lat: number; lon: number; confidence: string; address: string };
  const located: Located[] = [];
  const unlocated: Pending[] = [];

  for (const v of pending) {
    // A village that already carries OpenStreetMap coordinates needs no
    // geocode — that is a paid call saved on every OSM-matched village.
    if (typeof v.latitude === "number" && typeof v.longitude === "number") {
      located.push({ ...v, lat: v.latitude, lon: v.longitude, confidence: "osm", address: "" });
      continue;
    }
    if (!apiKey) {
      unlocated.push(v);
      continue;
    }
    const address = [v.villageName, v.blockName, v.districtName || TENANT.city, TENANT.state, "India"]
      .filter(Boolean)
      .join(", ");
    try {
      const hit = await geocodeAddressWithGoogle(address, apiKey);
      if (hit) {
        result.geocoded += 1;
        located.push({
          ...v,
          lat: hit.lat,
          lon: hit.lng,
          confidence: hit.confidence ?? "",
          address: hit.formattedAddress ?? "",
        });
      } else {
        unlocated.push(v);
      }
    } catch (e) {
      console.warn(`${LOG} geocode failed for "${v.villageName}": ${e instanceof Error ? e.message : e}`);
      unlocated.push(v);
    }
  }

  /* ── 2. Driving distance ────────────────────────────────── */

  const rows: Record<string, unknown>[] = [];

  for (let i = 0; i < located.length; i += MATRIX_BATCH) {
    const batch = located.slice(i, i + MATRIX_BATCH);
    let matrix: ({ km: number; minutes: number } | null)[] = batch.map(() => null);
    if (apiKey) {
      try {
        matrix = await distanceMatrix(batch.map((b) => ({ lat: b.lat, lon: b.lon })), apiKey);
      } catch (e) {
        console.warn(`${LOG} distance matrix batch failed: ${e instanceof Error ? e.message : e}`);
      }
    }

    batch.forEach((v, idx) => {
      const hit = matrix[idx];
      if (hit) {
        result.routed += 1;
        rows.push({
          village_id: v.id,
          tenant_id: tenantId,
          latitude: v.lat,
          longitude: v.lon,
          geocode_confidence: v.confidence,
          formatted_address: v.address,
          distance_km: hit.km,
          duration_minutes: hit.minutes,
          source: "google",
          note: "",
          computed_at: new Date().toISOString(),
        });
        return;
      }
      // Straight line, explicitly labelled. Around Varanasi this understates
      // the real drive badly, so the UI must be able to tell the difference.
      result.fellBackToStraightLine += 1;
      const km = haversineKm(
        { lat: TENANT.schoolLat, lon: TENANT.schoolLng },
        { lat: v.lat, lon: v.lon },
      );
      rows.push({
        village_id: v.id,
        tenant_id: tenantId,
        latitude: v.lat,
        longitude: v.lon,
        geocode_confidence: v.confidence,
        formatted_address: v.address,
        distance_km: km,
        duration_minutes: null,
        source: "haversine",
        note: apiKey
          ? "Google could not route this village; straight-line distance shown."
          : "GOOGLE_MAPS_API_KEY not configured; straight-line distance shown.",
        computed_at: new Date().toISOString(),
      });
    });
  }

  // Villages we could not even place. Recorded rather than silently retried
  // on every press, with the reason kept so somebody can fix the name.
  for (const v of unlocated) {
    result.failed += 1;
    rows.push({
      village_id: v.id,
      tenant_id: tenantId,
      latitude: null,
      longitude: null,
      geocode_confidence: "",
      formatted_address: "",
      distance_km: null,
      duration_minutes: null,
      source: "unresolved",
      note: apiKey
        ? "No geocoding result for this village name."
        : "GOOGLE_MAPS_API_KEY not configured.",
      computed_at: new Date().toISOString(),
    });
  }

  if (rows.length) {
    const { error: upsertError } = await sb
      .from("village_travel")
      .upsert(rows, { onConflict: "village_id" });
    if (upsertError) {
      throw new VillageTravelError(
        `Could not save travel times: ${upsertError.message}`,
        502,
      );
    }
  }

  console.info(
    `${LOG} resolve blocks=${input.blocks.join("|") || "ids"} pending=${pending.length} ` +
      `geocoded=${result.geocoded} routed=${result.routed} straightLine=${result.fellBackToStraightLine} failed=${result.failed}`,
  );

  return result;
}
