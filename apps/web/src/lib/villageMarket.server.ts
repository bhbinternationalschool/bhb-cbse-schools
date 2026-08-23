/**
 * Admissions → Village market intelligence: server side.
 *
 * Three sources, joined per village:
 *   1. OpenStreetMap Overpass — which villages sit inside the radius.
 *   2. village_demographics   — the Census 2011 baseline and its projection.
 *   3. admission_desk_leads   — the enquiries our field agents registered.
 *
 * Failure policy: a village whose census row is missing is reported as
 * `no_census_match`, never as a village with zero people. Overpass being
 * unreachable is an error the caller sees, not an empty list that reads as
 * "no villages nearby".
 */

import { createServiceSupabase } from "@/lib/supabase/server";
import { getServerTenantContext } from "@/lib/serverTenant";
import {
  CENSUS_BASELINE_YEAR,
  CHILD_COHORT_YEARS,
  DEFAULT_CHILD_RATIO,
  DEFAULT_GROWTH_MULTIPLIER,
  MAX_RADIUS_M,
  MIN_RADIUS_M,
  haversineKm,
  opportunityScore,
  penetrationBand,
  penetrationPct,
  toNumber,
  type NearbyPlace,
  type OverpassElement,
  type OverpassResponse,
  type VillageDemographicsRow,
  type VillageLeadCountRow,
  type BlockMarketRow,
  type LeadAttribution,
  type LeadCoverage,
  type SettlementFilter,
  type VillageMarketRow,
  type VillageQueryMode,
  type VillageSource,
  type VillagesNearbyResponse,
} from "@/lib/villageMarket";

const LOG = "[villageMarket]";

/** Thrown for conditions the route maps to a real HTTP status. */
export class VillageMarketError extends Error {
  status: number;
  retryable: boolean;
  constructor(message: string, status = 500, retryable = false) {
    super(message);
    this.name = "VillageMarketError";
    this.status = status;
    this.retryable = retryable;
  }
}

/* ─── Overpass ─────────────────────────────────────────────── */

/**
 * Mirrors, tried in order. The main endpoint rate-limits aggressively during
 * European daytime; kumi.systems is the usual fallback for bulk callers.
 */
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const OVERPASS_TIMEOUT_MS = 25_000;
/** Overpass asks callers to identify themselves. */
const USER_AGENT = "BHB-School-ERP/1.0 (admissions village market; +https://bhbinternational.school)";

const OVERPASS_CACHE_TTL_MS = 86_400_000; // 24h, matching the route revalidate.
/** Hard ceiling so one wide radius cannot fan out into hundreds of RPCs. */
export const MAX_PLACES = 80;

type OverpassHit = {
  elements: OverpassElement[];
  endpoint: string;
  fetchedAt: string;
  remark?: string;
};

/**
 * In-process cache.
 *
 * Next's fetch data cache only covers GET, and Overpass wants the query in a
 * POST body, so `next: { revalidate }` alone would cache nothing. This memo is
 * what actually saves the round trip. It is per Cloud Run instance, which is
 * fine for a read-only lookup — the worst case on a cold instance is one
 * extra Overpass call, not a wrong answer.
 */
const overpassCache = new Map<string, { at: number; hit: OverpassHit }>();

function cacheKey(lat: number, lon: number, radiusM: number): string {
  // ~100 m of rounding: two dashboard loads from the same school pin share
  // one entry even if the browser reports slightly different coordinates.
  return `${lat.toFixed(3)}:${lon.toFixed(3)}:${Math.round(radiusM / 100) * 100}`;
}

/** `around` in metres, nodes plus the centre of mapped village areas. */
export function buildOverpassQuery(lat: number, lon: number, radiusM: number): string {
  const r = Math.round(radiusM);
  return [
    "[out:json][timeout:25];",
    "(",
    `  node["place"~"^(village|hamlet)$"](around:${r},${lat},${lon});`,
    `  way["place"~"^(village|hamlet)$"](around:${r},${lat},${lon});`,
    `  relation["place"~"^(village|hamlet)$"](around:${r},${lat},${lon});`,
    ");",
    "out center tags;",
  ].join("\n");
}

async function postOverpass(endpoint: string, query: string): Promise<OverpassResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      body: new URLSearchParams({ data: query }).toString(),
      signal: controller.signal,
      // Declared for parity with the route's revalidate window. Next does not
      // cache POST responses — `overpassCache` above is what does the work.
      next: { revalidate: 86400 },
    });
    if (res.status === 429 || res.status === 504) {
      throw new VillageMarketError(
        `Overpass is rate-limiting (${res.status})`,
        503,
        true,
      );
    }
    if (!res.ok) {
      throw new VillageMarketError(
        `Overpass responded ${res.status}`,
        502,
        res.status >= 500,
      );
    }
    // A throttled Overpass answers 200 with an HTML error page. Parsing that
    // as JSON would surface as an unhelpful "Unexpected token '<'" instead of
    // "we are being rate-limited", and would not be marked retryable.
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("json")) {
      const preview = (await res.text()).slice(0, 200).replace(/\s+/g, " ");
      throw new VillageMarketError(
        `Overpass returned ${contentType || "an unknown content type"} instead of JSON (likely rate-limited): ${preview}`,
        503,
        true,
      );
    }
    return (await res.json()) as OverpassResponse;
  } finally {
    clearTimeout(timer);
  }
}

/** Query every mirror in turn; the last failure is what the caller sees. */
export async function fetchOverpassPlaces(
  lat: number,
  lon: number,
  radiusM: number,
): Promise<{ hit: OverpassHit; cached: boolean }> {
  const key = cacheKey(lat, lon, radiusM);
  const cached = overpassCache.get(key);
  if (cached && Date.now() - cached.at < OVERPASS_CACHE_TTL_MS) {
    return { hit: cached.hit, cached: true };
  }

  const query = buildOverpassQuery(lat, lon, radiusM);
  let lastError: unknown = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const started = Date.now();
      const data = await postOverpass(endpoint, query);
      const elements = Array.isArray(data.elements) ? data.elements : [];
      // Overpass answers 200 with a `remark` when it truncated or timed out.
      if (!elements.length && data.remark) {
        throw new VillageMarketError(`Overpass: ${data.remark}`, 502, true);
      }
      console.info(
        `${LOG} overpass ok endpoint=${endpoint} elements=${elements.length} ms=${Date.now() - started}`,
      );
      const hit: OverpassHit = {
        elements,
        endpoint,
        fetchedAt: new Date().toISOString(),
        remark: data.remark,
      };
      overpassCache.set(key, { at: Date.now(), hit });
      return { hit, cached: false };
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`${LOG} overpass failed endpoint=${endpoint}: ${msg}`);
    }
  }

  // Serve a stale entry rather than failing the dashboard — census figures
  // move once a decade, so yesterday's village list is still a good answer.
  if (cached) {
    console.warn(`${LOG} overpass unreachable, serving stale cache key=${key}`);
    return { hit: cached.hit, cached: true };
  }

  if (lastError instanceof VillageMarketError) throw lastError;
  const msg = lastError instanceof Error ? lastError.message : "unknown error";
  throw new VillageMarketError(
    `Could not reach OpenStreetMap Overpass (${msg})`,
    503,
    true,
  );
}

/** Flatten Overpass elements to named places with coordinates and distance. */
export function toNearbyPlaces(
  elements: OverpassElement[],
  origin: { lat: number; lon: number },
): NearbyPlace[] {
  const seen = new Set<string>();
  const out: NearbyPlace[] = [];

  for (const el of elements) {
    const tags = el.tags ?? {};
    const name = (tags["name:en"] || tags.name || "").trim();
    // An unnamed node cannot be matched to a census row or a lead, so it
    // would only ever render as an empty card.
    if (!name) continue;

    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (typeof lat !== "number" || typeof lon !== "number") continue;

    // OSM often carries the same settlement as a node and an area.
    const dedupeKey = `${name.toLowerCase()}|${lat.toFixed(2)}|${lon.toFixed(2)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const rawPop = Number((tags.population || "").replace(/[^0-9]/g, ""));

    out.push({
      osmId: el.id,
      osmType: el.type,
      name,
      placeType: tags.place || "village",
      lat,
      lon,
      distanceKm: haversineKm(origin, { lat, lon }),
      osmPopulation: Number.isFinite(rawPop) && rawPop > 0 ? rawPop : null,
    });
  }

  out.sort((a, b) => a.distanceKm - b.distanceKm);
  return out.slice(0, MAX_PLACES);
}

/* ─── Census match ─────────────────────────────────────────── */

const MATCH_THRESHOLD = 0.35;
/** Overpass can return dozens of places; keep Postgres calls in small waves. */
const MATCH_CONCURRENCY = 6;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

type CensusLookup = Map<number, VillageDemographicsRow>;

/**
 * Best census row per place, via `match_village_by_name`.
 *
 * A place with no row above the threshold is simply absent from the map —
 * the caller renders it as `no_census_match`.
 */
export async function matchCensusRows(
  sb: NonNullable<ReturnType<typeof createServiceSupabase>>,
  tenantId: string,
  places: NearbyPlace[],
): Promise<{ lookup: CensusLookup; failures: number }> {
  const lookup: CensusLookup = new Map();
  let failures = 0;

  await mapWithConcurrency(places, MATCH_CONCURRENCY, async (place) => {
    const { data, error } = await sb.rpc("match_village_by_name", {
      search_name: place.name,
      similarity_threshold: MATCH_THRESHOLD,
      p_tenant_id: tenantId,
      max_results: 1,
    });
    if (error) {
      failures += 1;
      console.warn(`${LOG} match_village_by_name failed name="${place.name}": ${error.message}`);
      return;
    }
    const row = (data as VillageDemographicsRow[] | null)?.[0];
    if (row) lookup.set(place.osmId, row);
  });

  return { lookup, failures };
}

/* ─── Lead counts ──────────────────────────────────────────── */

export async function fetchLeadCountsById(
  sb: NonNullable<ReturnType<typeof createServiceSupabase>>,
  tenantId: string,
  villageIds: string[],
  academicYearCode: string,
): Promise<{ counts: Map<string, VillageLeadCountRow>; failed: boolean }> {
  const counts = new Map<string, VillageLeadCountRow>();
  const ids = Array.from(new Set(villageIds.filter(Boolean)));
  if (!ids.length) return { counts, failed: false };

  const { data, error } = await sb.rpc("village_lead_counts_by_id", {
    p_tenant_id: tenantId,
    p_village_ids: ids,
    p_academic_year_code: academicYearCode || null,
  });
  if (error) {
    console.error(`${LOG} village_lead_counts_by_id failed: ${error.message}`);
    return { counts, failed: true };
  }
  for (const row of (data as (VillageLeadCountRow & { village_id: string })[] | null) ?? []) {
    counts.set(row.village_id, {
      village_key: row.village_id,
      lead_count: Number(row.lead_count) || 0,
      enrolled_count: Number(row.enrolled_count) || 0,
      open_count: Number(row.open_count) || 0,
      lost_count: Number(row.lost_count) || 0,
      last_lead_at: row.last_lead_at ?? null,
    });
  }
  return { counts, failed: false };
}

/**
 * How many leads sit on a village the census can size.
 *
 * Reported rather than guessed: `similarity('Ayar','Aayr')` is 0.111, so no
 * trigram threshold that avoids matching Akla to Koila will ever catch it.
 * A visible gap beats a confident wrong number.
 */
export async function fetchLeadCoverage(
  sb: NonNullable<ReturnType<typeof createServiceSupabase>>,
  tenantId: string,
  academicYearCode: string,
): Promise<LeadCoverage | null> {
  const { data, error } = await sb.rpc("village_lead_coverage", {
    p_tenant_id: tenantId,
    p_academic_year_code: academicYearCode || null,
  });
  if (error) {
    console.warn(`${LOG} village_lead_coverage failed: ${error.message}`);
    return null;
  }
  const row = (
    data as
      | {
          total_leads: number;
          blank_locality: number;
          matched_leads: number;
          unmatched_leads: number;
          top_unmatched: { locality: string; leads: number }[] | null;
        }[]
      | null
  )?.[0];
  if (!row) return null;
  return {
    totalLeads: Number(row.total_leads) || 0,
    blankLocality: Number(row.blank_locality) || 0,
    matchedLeads: Number(row.matched_leads) || 0,
    unmatchedLeads: Number(row.unmatched_leads) || 0,
    topUnmatched: (row.top_unmatched ?? []).map((u) => ({
      locality: String(u.locality),
      leads: Number(u.leads) || 0,
    })),
  };
}

/* ─── Assembly ─────────────────────────────────────────────── */

export type NearbyQuery = {
  mode: VillageQueryMode;
  lat: number;
  lon: number;
  radiusM: number;
  /** Block names to cover in block mode; empty means every block on file. */
  blocks: string[];
  /** Village-name contains-search; "" means no name filter. */
  search: string;
  settlementType: SettlementFilter;
  /** Hide settlements whose projected 0-6 pool is below this. */
  minChildPool: number;
  academicYearCode: string;
};

/** Clamp and validate query parameters, rejecting nonsense with a 400. */
export function parseNearbyQuery(params: URLSearchParams, fallback: {
  lat: number;
  lon: number;
  radiusM: number;
}): NearbyQuery {
  const num = (key: string, dflt: number): number => {
    const raw = params.get(key);
    if (raw === null || raw.trim() === "") return dflt;
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      throw new VillageMarketError(`${key} must be a number`, 400);
    }
    return n;
  };

  const lat = num("lat", fallback.lat);
  const lon = num("lon", fallback.lon);
  if (lat < -90 || lat > 90) throw new VillageMarketError("lat out of range", 400);
  if (lon < -180 || lon > 180) throw new VillageMarketError("lon out of range", 400);

  const radiusRaw = num("radius", fallback.radiusM);
  const radiusM = Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, Math.round(radiusRaw)));

  const rawMode = (params.get("mode") || "radius").trim().toLowerCase();
  if (rawMode !== "radius" && rawMode !== "block") {
    throw new VillageMarketError("mode must be radius or block", 400);
  }

  const rawType = (params.get("settlementType") || "all").trim().toLowerCase();
  if (rawType !== "all" && rawType !== "village" && rawType !== "town") {
    throw new VillageMarketError("settlementType must be all, village or town", 400);
  }

  return {
    mode: rawMode,
    lat,
    lon,
    radiusM,
    blocks: (params.get("blocks") || "")
      .split(",")
      .map((b) => b.trim())
      .filter(Boolean),
    search: (params.get("search") || "").trim().slice(0, 60),
    settlementType: rawType,
    minChildPool: Math.max(0, Math.round(num("minChildPool", 0))),
    academicYearCode: (params.get("academicYearCode") || "").trim(),
  };
}

/** Max census villages returned in one block-mode page. */
export const MAX_CENSUS_VILLAGES = 400;

/**
 * Every block name on file, for the dashboard's block picker.
 *
 * Via an RPC that does the DISTINCT in Postgres, NOT a select over every
 * village row: PostgREST caps an unbounded select at 1,000 rows and Varanasi
 * alone seeds 1,258 villages, which silently dropped the last block
 * (Sevapuri, 177 villages) off the picker entirely.
 */
async function fetchAvailableBlocks(
  sb: NonNullable<ReturnType<typeof createServiceSupabase>>,
  tenantId: string,
): Promise<string[]> {
  const { data, error } = await sb.rpc("village_blocks", { p_tenant_id: tenantId });
  if (error) {
    console.warn(`${LOG} block list failed: ${error.message}`);
    return [];
  }
  return ((data as { block_name: string }[] | null) ?? [])
    .map((r) => r.block_name)
    .filter(Boolean);
}

/** Census settlements matching the filters, largest child pool first. */
async function fetchCensusVillagesByBlock(
  sb: NonNullable<ReturnType<typeof createServiceSupabase>>,
  tenantId: string,
  query: NearbyQuery,
): Promise<{ rows: VillageDemographicsRow[]; total: number }> {
  const columns =
    "id, census_code, village_name, block_name, district_name, settlement_type, " +
    "pop_total_2011, pop_male_2011, pop_female_2011, " +
    "child_0_6_total_2011, child_0_6_male_2011, child_0_6_female_2011, " +
    "households_2011, growth_multiplier, child_ratio, projection_target_year, " +
    "estimated_current_total_pop, estimated_current_child_pop, latitude, longitude, osm_id";

  // `count: "exact"` so the UI can say "24 of 169" rather than implying the
  // capped page is the whole answer.
  let q = sb
    .from("village_demographics")
    .select(columns, { count: "exact" })
    .eq("tenant_id", tenantId);

  if (query.blocks.length) q = q.in("block_name", query.blocks);
  if (query.settlementType !== "all") q = q.eq("settlement_type", query.settlementType);
  if (query.minChildPool > 0) {
    q = q.gte("estimated_current_child_pop", query.minChildPool);
  }
  if (query.search) {
    // Escape PostgREST's pattern wildcards so a literal % typed by a clerk
    // does not silently match everything.
    const safe = query.search.replace(/[%_,()]/g, " ").trim();
    if (safe) q = q.ilike("village_name", `%${safe}%`);
  }

  const { data, error, count } = await q
    .order("estimated_current_child_pop", { ascending: false })
    .range(0, MAX_CENSUS_VILLAGES - 1);

  if (error) {
    throw new VillageMarketError(
      `Could not read the census table: ${error.message}`,
      502,
      true,
    );
  }
  return {
    rows: (data as unknown as VillageDemographicsRow[] | null) ?? [],
    total: count ?? (data?.length ?? 0),
  };
}

/** Every block's market — the drill-down index above the village cards. */
async function fetchBlockMarket(
  sb: NonNullable<ReturnType<typeof createServiceSupabase>>,
  tenantId: string,
  query: NearbyQuery,
): Promise<BlockMarketRow[]> {
  const { data, error } = await sb.rpc("village_block_market", {
    p_tenant_id: tenantId,
    p_academic_year_code: query.academicYearCode || null,
    p_settlement_type: query.settlementType,
  });
  if (error) {
    console.warn(`${LOG} village_block_market failed: ${error.message}`);
    return [];
  }
  return (
    (data as Record<string, number | string>[] | null) ?? []
  ).map((r) => {
    const projectedChildPop = Number(r.projected_child_pop) || 0;
    const leads = Number(r.leads) || 0;
    return {
      blockName: String(r.block_name),
      settlements: Number(r.settlements) || 0,
      villages: Number(r.villages) || 0,
      towns: Number(r.towns) || 0,
      pop2011: Number(r.pop_2011) || 0,
      projectedPop: Number(r.projected_pop) || 0,
      projectedChildPop,
      leads,
      enrolled: Number(r.enrolled) || 0,
      penetrationPct: penetrationPct(leads, projectedChildPop),
    };
  });
}

/** One village awaiting its lead counts, from either source. */
type Candidate = {
  key: string;
  name: string;
  osmId: number;
  placeType: string;
  source: VillageSource;
  lat: number | null;
  lon: number | null;
  distanceKm: number | null;
  census: VillageDemographicsRow | null;
};

/**
 * The whole pipeline: pick the villages, join the census, count the leads.
 *
 * Two ways to pick them (see VillageQueryMode):
 *  · radius — OpenStreetMap Overpass inside N metres of the school.
 *  · block  — the census table for whole administrative blocks.
 *
 * Degradations (Supabase unconfigured, a failed RPC) become `warnings` and a
 * `censusMatch` status, never silently-zero numbers.
 */
export async function buildVillagesNearby(
  query: NearbyQuery,
): Promise<VillagesNearbyResponse> {
  const started = Date.now();
  const warnings: string[] = [];

  const tenant = await getServerTenantContext();
  if (!tenant && query.mode === "block") {
    throw new VillageMarketError(
      "Census database is not reachable, so villages cannot be listed by block.",
      503,
      true,
    );
  }

  const [availableBlocks, blockMarket] = tenant
    ? await Promise.all([
        fetchAvailableBlocks(tenant.sb, tenant.tenantId),
        fetchBlockMarket(tenant.sb, tenant.tenantId, query),
      ])
    : [[] as string[], [] as BlockMarketRow[]];

  let candidates: Candidate[] = [];
  let matchingFilter = 0;
  let truncated = false;
  let overpassEndpoint = "";
  let fetchedAt = new Date().toISOString();
  let cached = false;
  let remark: string | undefined;

  if (query.mode === "radius") {
    const { hit, cached: wasCached } = await fetchOverpassPlaces(
      query.lat,
      query.lon,
      query.radiusM,
    );
    overpassEndpoint = hit.endpoint;
    fetchedAt = hit.fetchedAt;
    cached = wasCached;
    remark = hit.remark;

    const places = toNearbyPlaces(hit.elements, { lat: query.lat, lon: query.lon });
    if (hit.elements.length > MAX_PLACES) {
      warnings.push(
        `OpenStreetMap returned ${hit.elements.length} places; showing the ${MAX_PLACES} nearest. Reduce the radius for a complete list.`,
      );
    }

    let lookup: CensusLookup = new Map();
    if (tenant) {
      const { lookup: matched, failures } = await matchCensusRows(
        tenant.sb,
        tenant.tenantId,
        places,
      );
      lookup = matched;
      if (failures) {
        warnings.push(
          `${failures} village name${failures === 1 ? "" : "s"} could not be checked against the census table.`,
        );
      }
    } else {
      warnings.push(
        "Census database is not reachable — village names are from OpenStreetMap only, with no population or lead figures.",
      );
    }

    matchingFilter = places.length;
    candidates = places.map((p) => ({
      key: `osm/${p.osmType}/${p.osmId}`,
      name: p.name,
      osmId: p.osmId,
      placeType: p.placeType,
      source: "osm" as const,
      lat: p.lat,
      lon: p.lon,
      distanceKm: p.distanceKm,
      census: lookup.get(p.osmId) ?? null,
    }));

    // OSM's rural coverage around Varanasi is a handful of nodes against the
    // census's ~1,258 villages in the district. Saying so is the difference
    // between "there is no market here" and "OSM has not mapped it".
    if (availableBlocks.length && candidates.length < 10) {
      warnings.push(
        `OpenStreetMap has only ${candidates.length} mapped village${candidates.length === 1 ? "" : "s"} in this radius, which is far fewer than the census records for the area. Switch to "By block" for the complete market.`,
      );
    }
  } else {
    const sb = tenant!.sb;
    const found = await fetchCensusVillagesByBlock(sb, tenant!.tenantId, query);
    const rows = found.rows;
    matchingFilter = found.total;
    truncated = found.total > rows.length;
    if (truncated) {
      warnings.push(
        `${found.total} settlements match this filter; showing the ${rows.length} largest by estimated child pool. Narrow the block, name or minimum pool to see the rest.`,
      );
    }
    if (!rows.length) {
      warnings.push(
        query.search || query.minChildPool > 0 || query.settlementType !== "all"
          ? "No settlements match these filters. Clear the name search or lower the minimum child pool."
          : query.blocks.length
            ? `No census villages are on file for ${query.blocks.join(", ")}. Seed the PCA rows for that block first.`
            : "No census villages are on file yet — run scripts/seed-census.ts to load the PCA data.",
      );
    }

    candidates = rows.map((row) => {
      const lat = typeof row.latitude === "number" ? row.latitude : null;
      const lon = typeof row.longitude === "number" ? row.longitude : null;
      return {
        key: `census/${row.id}`,
        name: row.village_name,
        osmId: typeof row.osm_id === "number" ? row.osm_id : 0,
        placeType: row.settlement_type === "town" ? "town" : "village",
        source: "census" as const,
        lat,
        lon,
        // Census PCA carries no coordinates, so distance is genuinely
        // unknown for most rows rather than zero.
        distanceKm:
          lat !== null && lon !== null
            ? haversineKm({ lat: query.lat, lon: query.lon }, { lat, lon })
            : null,
        census: row,
      };
    });
  }

  /* ── leads, one call for the whole batch ─────────────────── */

  let leadCounts = new Map<string, VillageLeadCountRow>();
  let leadCoverage: LeadCoverage | null = null;
  let leadsUnavailable = !tenant;
  const travelById = new Map<string, { distanceKm: number | null; minutes: number | null; source: string }>();
  const scoresById = new Map<
    string,
    { hot: number; warm: number; cold: number; enrolled: number; avgScore: number }
  >();

  if (tenant) {
    leadCoverage = await fetchLeadCoverage(
      tenant.sb,
      tenant.tenantId,
      query.academicYearCode,
    );
  }

  if (tenant && candidates.length) {
    // Keyed by census row id, not by name: village names repeat across blocks
    // ("Chandapur" is in three), and a name key credits one lead to all of
    // them, so the cards would never reconcile with the block rollup.
    const ids = candidates
      .map((c) => c.census?.id)
      .filter((id): id is string => Boolean(id));
    const { counts, failed } = await fetchLeadCountsById(
      tenant.sb,
      tenant.tenantId,
      ids,
      query.academicYearCode,
    );
    leadCounts = counts;

    // Travel times and score mix are optional enrichments: a village with
    // neither still renders, showing "not resolved" rather than a zero.
    if (ids.length) {
      const [travelRes, scoreRes] = await Promise.all([
        tenant.sb
          .from("village_travel")
          .select("village_id, distance_km, duration_minutes, source")
          .eq("tenant_id", tenant.tenantId)
          .in("village_id", ids),
        tenant.sb.rpc("village_lead_score_summary", {
          p_tenant_id: tenant.tenantId,
          p_village_ids: ids,
        }),
      ]);
      if (travelRes.error) {
        console.warn(`${LOG} travel lookup failed: ${travelRes.error.message}`);
      } else {
        for (const r of (travelRes.data as Record<string, unknown>[] | null) ?? []) {
          const km = r.distance_km;
          travelById.set(String(r.village_id), {
            distanceKm: km === null || km === undefined ? null : Number(km),
            minutes: r.duration_minutes === null ? null : Number(r.duration_minutes),
            source: String(r.source ?? ""),
          });
        }
      }
      if (scoreRes.error) {
        console.warn(`${LOG} score summary failed: ${scoreRes.error.message}`);
      } else {
        for (const r of (scoreRes.data as Record<string, unknown>[] | null) ?? []) {
          scoresById.set(String(r.village_id), {
            hot: Number(r.hot) || 0,
            warm: Number(r.warm) || 0,
            cold: Number(r.cold) || 0,
            enrolled: Number(r.enrolled) || 0,
            avgScore: Number(r.avg_score) || 0,
          });
        }
      }
    }
    if (failed) {
      leadsUnavailable = true;
      warnings.push(
        "Registered leads could not be counted — the lead figures below are unavailable, not zero.",
      );
    }
  }

  const villages: VillageMarketRow[] = candidates.map((c) => {
    const row = c.census;
    // Attribution is settled in SQL now — one locality resolves to exactly
    // one settlement id — so a row either has its own counts or has no
    // census row to attribute against.
    const attribution: LeadAttribution = row ? "exact" : "ambiguous";
    const lead = row ? (leadCounts.get(row.id) ?? null) : null;

    const growthMultiplier = row
      ? toNumber(row.growth_multiplier, DEFAULT_GROWTH_MULTIPLIER)
      : DEFAULT_GROWTH_MULTIPLIER;
    const childRatio = row ? toNumber(row.child_ratio, DEFAULT_CHILD_RATIO) : DEFAULT_CHILD_RATIO;
    const childPool = row ? toNumber(row.estimated_current_child_pop) : 0;

    const totalLeads = lead?.lead_count ?? 0;
    const enrolled = lead?.enrolled_count ?? 0;

    // Leads unavailable, or a name we cannot attribute ⇒ penetration is
    // unknown, not 0%.
    const unknownLeads = leadsUnavailable || attribution === "ambiguous";
    const pct = unknownLeads ? null : penetrationPct(totalLeads, childPool);
    const enrolledPct = unknownLeads ? null : penetrationPct(enrolled, childPool);

    return {
      key: c.key,
      osmName: c.name,
      osmId: c.osmId,
      placeType: c.placeType,
      source: c.source,
      lat: c.lat,
      lon: c.lon,
      distanceKm: c.distanceKm,
      censusMatch: row ? "matched" : tenant ? "no_census_match" : "census_unavailable",
      leadAttribution: attribution,
      census: row
        ? {
            id: row.id,
            censusCode: row.census_code,
            villageName: row.village_name,
            blockName: row.block_name,
            districtName: row.district_name,
            matchScore: Math.round((row.match_score ?? 1) * 100) / 100,
            settlementType: row.settlement_type === "town" ? "town" : "village",
            baseline: {
              year: CENSUS_BASELINE_YEAR,
              popTotal: toNumber(row.pop_total_2011),
              popMale: toNumber(row.pop_male_2011),
              popFemale: toNumber(row.pop_female_2011),
              child06Total: toNumber(row.child_0_6_total_2011),
              child06Male: toNumber(row.child_0_6_male_2011),
              child06Female: toNumber(row.child_0_6_female_2011),
              households: toNumber(row.households_2011),
            },
            projected: {
              targetYear: toNumber(row.projection_target_year, new Date().getFullYear()),
              growthMultiplier,
              childRatio,
              popTotal: toNumber(row.estimated_current_total_pop),
              child06Total: childPool,
              annualBirthCohort: Math.round(childPool / CHILD_COHORT_YEARS),
            },
          }
        : null,
      leads: {
        total: totalLeads,
        enrolled,
        open: lead?.open_count ?? 0,
        lost: lead?.lost_count ?? 0,
        lastLeadAt: lead?.last_lead_at ?? null,
      },
      travel: row ? (travelById.get(row.id) as VillageMarketRow["travel"]) ?? null : null,
      scores: row ? (scoresById.get(row.id) ?? null) : null,
      penetrationPct: pct,
      enrolledPenetrationPct: enrolledPct,
      penetrationBand: penetrationBand(pct),
    };
  });

  if (leadCoverage && leadCoverage.unmatchedLeads > 0) {
    const pct = leadCoverage.totalLeads
      ? Math.round((leadCoverage.unmatchedLeads / leadCoverage.totalLeads) * 100)
      : 0;
    warnings.push(
      `${leadCoverage.unmatchedLeads} of ${leadCoverage.totalLeads} registered leads (${pct}%) name a locality that matches no census village, so they are counted in no village below. Every penetration figure on this page is understated by that much.`,
    );
  }

  // Opportunity first — the grid's default question is "where next?".
  villages.sort((a, b) => opportunityScore(b) - opportunityScore(a));

  const matchedRows = villages.filter((v) => v.censusMatch === "matched");
  const projectedChildPool = matchedRows.reduce(
    (sum, v) => sum + (v.census?.projected.child06Total ?? 0),
    0,
  );
  const totalLeads = villages.reduce((sum, v) => sum + v.leads.total, 0);
  const totalEnrolled = villages.reduce((sum, v) => sum + v.leads.enrolled, 0);

  console.info(
    `${LOG} ${query.mode} lat=${query.lat} lon=${query.lon} r=${query.radiusM} ` +
      `blocks=${query.blocks.join("|") || "all"} villages=${villages.length} ` +
      `matched=${matchedRows.length} leads=${totalLeads} cached=${cached} ms=${Date.now() - started}`,
  );

  return {
    ok: true,
    mode: query.mode,
    origin: { lat: query.lat, lon: query.lon, radiusM: query.radiusM },
    blocks: { selected: query.blocks, available: availableBlocks },
    blockMarket,
    filters: {
      search: query.search,
      settlementType: query.settlementType,
      minChildPool: query.minChildPool,
    },
    source: {
      overpassEndpoint,
      fetchedAt,
      cached,
      ...(remark ? { remark } : {}),
    },
    assumptions: {
      baselineYear: CENSUS_BASELINE_YEAR,
      targetYear:
        matchedRows[0]?.census?.projected.targetYear ?? new Date().getFullYear(),
      growthMultiplier:
        matchedRows[0]?.census?.projected.growthMultiplier ?? DEFAULT_GROWTH_MULTIPLIER,
      childRatio: matchedRows[0]?.census?.projected.childRatio ?? DEFAULT_CHILD_RATIO,
      note:
        "Projected figures are estimates: Census 2011 totals scaled by a rural-UP growth factor, with the 0-6 share applied to the scaled total. They are not measured counts.",
    },
    counts: {
      placesFound: villages.length,
      censusMatched: matchedRows.length,
      censusUnmatched: villages.length - matchedRows.length,
      matchingFilter,
      truncated,
    },
    totals: {
      projectedChildPool,
      leads: totalLeads,
      enrolled: totalEnrolled,
      penetrationPct: leadsUnavailable
        ? null
        : penetrationPct(totalLeads, projectedChildPool),
    },
    villages,
    leadCoverage,
    warnings,
  };
}
