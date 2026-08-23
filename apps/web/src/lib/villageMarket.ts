/**
 * Admissions → Village market intelligence: shared types and pure maths.
 *
 * Isomorphic on purpose — the API route, the seeder and the dashboard grid
 * all read the same shapes and the same arithmetic, so a number shown to the
 * office is the number the server computed and not a second implementation
 * that drifted.
 *
 * Vocabulary used throughout:
 *   baseline    Census of India 2011, as published. Never derived.
 *   projected   baseline scaled by an assumption. An ESTIMATE, always
 *               labelled as one, and always carrying the assumptions used.
 *   leads       rows our field agents actually registered. A hard fact.
 *   penetration leads ÷ projected 0-6 pool. Null — not zero — when the
 *               denominator is unknown, because "we have no idea" and
 *               "we have 0% of this village" are different answers.
 */

/* ─── Projection assumptions ───────────────────────────────── */

/** Compounded rural-UP growth applied to the 2011 baseline. */
export const DEFAULT_GROWTH_MULTIPLIER = 1.19;
/** Share of population in the 0-6 bracket in rural UP. */
export const DEFAULT_CHILD_RATIO = 0.14;
/** Census baseline year the projection starts from. */
export const CENSUS_BASELINE_YEAR = 2011;
/** 0-6 spans seven birth-years — used to size one intake cohort. */
export const CHILD_COHORT_YEARS = 7;

/** Ayar, Varanasi — the school's own coordinates, used as the map origin. */
export const DEFAULT_ORIGIN = { lat: 25.405, lon: 82.935 } as const;
export const DEFAULT_RADIUS_M = 10_000;
export const MIN_RADIUS_M = 500;
export const MAX_RADIUS_M = 40_000;

/* ─── Overpass API payload ─────────────────────────────────── */

export type OverpassTags = {
  name?: string;
  "name:en"?: string;
  "name:hi"?: string;
  place?: string;
  population?: string;
  "addr:district"?: string;
  "addr:state"?: string;
  [key: string]: string | undefined;
};

export type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  /** Present on nodes. */
  lat?: number;
  lon?: number;
  /** Present on ways/relations when the query asks for `out center`. */
  center?: { lat: number; lon: number };
  tags?: OverpassTags;
};

export type OverpassResponse = {
  version?: number;
  generator?: string;
  osm3s?: { timestamp_osm_base?: string; copyright?: string };
  elements?: OverpassElement[];
  /** Overpass returns this instead of elements when a query is rejected. */
  remark?: string;
};

/** An Overpass element flattened to what we actually use. */
export type NearbyPlace = {
  osmId: number;
  osmType: OverpassElement["type"];
  name: string;
  /** "village" | "hamlet" | "town" … straight from the OSM place tag. */
  placeType: string;
  lat: number;
  lon: number;
  /** Distance from the query origin, km, 2dp. */
  distanceKm: number;
  /** OSM's own population tag when present — a cross-check, not our source. */
  osmPopulation: number | null;
};

/* ─── Supabase rows ────────────────────────────────────────── */

/** A `village_demographics` row as returned by PostgREST / the match RPC. */
export type VillageDemographicsRow = {
  id: string;
  tenant_id?: string;
  census_code: string;
  village_name: string;
  block_name: string;
  district_name: string;
  pop_total_2011: number;
  pop_male_2011: number;
  pop_female_2011: number;
  child_0_6_total_2011: number;
  child_0_6_male_2011: number;
  child_0_6_female_2011: number;
  households_2011: number;
  growth_multiplier: number | string;
  child_ratio: number | string;
  projection_target_year: number;
  estimated_current_total_pop: number;
  estimated_current_child_pop: number;
  latitude: number | null;
  longitude: number | null;
  /** Absent from the match RPC's projection; present on direct selects. */
  osm_id?: number | null;
  settlement_type?: string | null;
  /** Only present on rows returned by `match_village_by_name`. */
  match_score?: number;
};

/** A `village_lead_counts` row. */
export type VillageLeadCountRow = {
  village_key: string;
  lead_count: number;
  enrolled_count: number;
  open_count: number;
  lost_count: number;
  last_lead_at: string | null;
};

/* ─── Combined API response ────────────────────────────────── */

/** Why a village has no census figures — shown instead of a fake zero. */
export type CensusMatchStatus =
  | "matched"
  | "no_census_match"
  | "census_unavailable";

export type VillageMarketRow = {
  /* identity */
  key: string;
  osmName: string;
  osmId: number;
  placeType: string;
  /**
   * Where this village entered the list. "osm" means OpenStreetMap put it in
   * the radius; "census" means it came from the census table by block and may
   * have no coordinates at all — OSM's rural coverage around Varanasi is a
   * few nodes against the census's ~1,258 villages.
   */
  source: VillageSource;
  /** null when nothing has ever mapped this village. */
  lat: number | null;
  lon: number | null;
  /** null when the village has no coordinates to measure from. */
  distanceKm: number | null;

  /* census link */
  censusMatch: CensusMatchStatus;
  /** null when censusMatch !== "matched". */
  census: {
    id: string;
    censusCode: string;
    villageName: string;
    blockName: string;
    districtName: string;
    matchScore: number;
    settlementType: "village" | "town";
    baseline: {
      year: number;
      popTotal: number;
      popMale: number;
      popFemale: number;
      child06Total: number;
      child06Male: number;
      child06Female: number;
      households: number;
    };
    projected: {
      targetYear: number;
      growthMultiplier: number;
      childRatio: number;
      popTotal: number;
      child06Total: number;
      /** child06Total ÷ 7 — one birth-year, i.e. one nursery intake pool. */
      annualBirthCohort: number;
    };
  } | null;

  /**
   * Whether the lead counts below can be trusted to belong to THIS village.
   *
   * Leads are matched by village name, but names repeat: Varanasi district
   * has 19 name+block collisions, e.g. two distinct Fatehpurs in Baragaon.
   * When a name is ambiguous the counts go to the larger village and the
   * others are marked "ambiguous" with unknown penetration — attributing the
   * same leads to both would inflate every total on the page.
   */
  leadAttribution: LeadAttribution;

  /* our own funnel */
  leads: {
    total: number;
    enrolled: number;
    open: number;
    lost: number;
    lastLeadAt: string | null;
  };

  /** Road travel to campus. Null until resolved — it costs API quota. */
  travel: {
    distanceKm: number | null;
    minutes: number | null;
    /**
     * "google" is a real road route. "haversine" is a straight line, which
     * around Varanasi is optimistic by a wide margin — the UI must never let
     * the two read the same.
     */
    source: "google" | "haversine" | "unresolved" | "";
  } | null;

  /** Lead temperature mix here. Null before the first scoring run. */
  scores: {
    hot: number;
    warm: number;
    cold: number;
    enrolled: number;
    /** Mean excluding enrolled, who are a flat 100 by definition. */
    avgScore: number;
  } | null;

  /** leads.total ÷ projected 0-6 pool × 100. Null when the pool is unknown. */
  penetrationPct: number | null;
  /** enrolled ÷ projected 0-6 pool × 100. Null when the pool is unknown. */
  enrolledPenetrationPct: number | null;
  /** Coarse bucket for colour-coding; "unknown" when penetration is null. */
  penetrationBand: PenetrationBand;
};

export type PenetrationBand = "unknown" | "untouched" | "low" | "medium" | "high";

export type VillageSource = "osm" | "census";

export type LeadAttribution = "exact" | "ambiguous";

/**
 * How the village list is chosen.
 *
 * "radius" is the OpenStreetMap query: everything OSM has mapped as a village
 * or hamlet inside N metres of the school.
 *
 * "block" reads the census table directly for whole administrative blocks.
 * It exists because OSM's coverage of rural Varanasi is a handful of nodes,
 * so radius mode alone shows four villages where the market is three hundred.
 * Block mode has no distances — census PCA carries no coordinates — but it is
 * complete, which for planning a campaign matters more.
 */
export type VillageQueryMode = "radius" | "block";

/** Villages, census towns, or both. */
export type SettlementFilter = "all" | "village" | "town";

/** One CD block's whole market — the dashboard's entry point. */
export type BlockMarketRow = {
  blockName: string;
  settlements: number;
  villages: number;
  towns: number;
  pop2011: number;
  projectedPop: number;
  projectedChildPop: number;
  leads: number;
  enrolled: number;
  /** leads ÷ projected child pool × 100; null when the pool is 0. */
  penetrationPct: number | null;
};

/**
 * How much of the lead book the census can actually size.
 *
 * Leads are matched to villages by the locality a field agent typed, and a
 * good share of those spellings match no census village. Reporting the gap is
 * the difference between "penetration is 2.1%" and "penetration is 2.1% of
 * the leads we could place, and 268 more are unplaced".
 */
export type LeadCoverage = {
  totalLeads: number;
  blankLocality: number;
  matchedLeads: number;
  unmatchedLeads: number;
  /** Loudest unmatched spellings, so the office knows what to correct. */
  topUnmatched: { locality: string; leads: number }[];
};

export type VillagesNearbyResponse = {
  ok: true;
  mode: VillageQueryMode;
  origin: { lat: number; lon: number; radiusM: number };
  /** Blocks the query covered (block mode) and every block on file. */
  blocks: { selected: string[]; available: string[] };
  /** Every block's market, whatever the current filter — the drill-down index. */
  blockMarket: BlockMarketRow[];
  /** Filters the server applied, echoed back so the UI stays in step. */
  filters: {
    search: string;
    settlementType: SettlementFilter;
    minChildPool: number;
  };
  /** Where the Overpass payload came from and how fresh it is. */
  source: {
    /** "" in block mode, which never touches OpenStreetMap. */
    overpassEndpoint: string;
    fetchedAt: string;
    cached: boolean;
    /** Present when Overpass answered but complained (e.g. timeout note). */
    remark?: string;
  };
  assumptions: {
    baselineYear: number;
    targetYear: number;
    growthMultiplier: number;
    childRatio: number;
    note: string;
  };
  counts: {
    placesFound: number;
    censusMatched: number;
    censusUnmatched: number;
    /** Rows matching the filter before the display cap; may exceed villages.length. */
    matchingFilter: number;
    /** True when the cap hid some matches — the UI must say so. */
    truncated: boolean;
  };
  totals: {
    projectedChildPool: number;
    leads: number;
    enrolled: number;
    /** Null when no village in the radius has a census match. */
    penetrationPct: number | null;
  };
  villages: VillageMarketRow[];
  /** null when the lead book could not be read at all. */
  leadCoverage: LeadCoverage | null;
  /** Non-fatal degradations the UI should surface rather than hide. */
  warnings: string[];
};

export type VillagesNearbyError = {
  ok: false;
  error: string;
  /** Present when the failure is recoverable by retrying. */
  retryable?: boolean;
};

export type VillagesNearbyResult = VillagesNearbyResponse | VillagesNearbyError;

/* ─── Name aliases ─────────────────────────────────────────── */

/**
 * A spelling decision a person made.
 *
 * "confirmed" pins a locality to a settlement; "ignored" pins it to nothing —
 * a landmark, a mohalla, a typo beyond rescue. Both outrank the fuzzy guess,
 * which is the point: an alias is an asserted fact, not a better heuristic.
 */
export type VillageAliasStatus = "confirmed" | "ignored";

export type VillageAliasSuggestion = {
  villageId: string;
  villageName: string;
  blockName: string;
  settlementType: "village" | "town";
  childPool: number;
  /** Trigram similarity, 0-1. Shown so a weak suggestion looks weak. */
  score: number;
  /**
   * Same consonant skeleton as the typed spelling (Aayr/Ayar -> "yr").
   * Ranks first, because trigram scores that pair 0.111 and would bury the
   * right answer. Never an automatic match — skeletons collide on short names.
   */
  skeletonMatch?: boolean;
};

/** An unresolved spelling awaiting a decision. */
export type VillageAliasCandidate = {
  locality: string;
  leadCount: number;
  enrolledCount: number;
  suggestions: VillageAliasSuggestion[];
};

/** A decision already taken, so it can be reviewed or undone. */
export type VillageAliasRow = {
  id: string;
  alias: string;
  status: VillageAliasStatus;
  villageId: string | null;
  villageName: string;
  blockName: string;
  leadCountAtConfirm: number;
  note: string;
  confirmedBy: string;
  updatedAt: string;
};

export type VillageAliasesResponse = {
  ok: true;
  candidates: VillageAliasCandidate[];
  aliases: VillageAliasRow[];
  coverage: LeadCoverage | null;
  /** True when more candidates exist than the page returned. */
  truncated: boolean;
};

/** Manual lookup, for spellings the suggestions still miss. */
export type VillageSearchResponse = {
  ok: true;
  results: VillageAliasSuggestion[];
};

export type VillageAliasesError = { ok: false; error: string };
export type VillageAliasesResult = VillageAliasesResponse | VillageAliasesError;

/**
 * Leads that a decision would move out of the unplaced pile.
 *
 * Only "confirmed" counts: ignoring a spelling is a valid decision but it
 * places no leads, and reporting it as progress would overstate coverage.
 */
export function leadsPlacedBy(aliases: VillageAliasRow[]): number {
  return aliases
    .filter((a) => a.status === "confirmed")
    .reduce((sum, a) => sum + (a.leadCountAtConfirm || 0), 0);
}

/* ─── Ad-targeting export ──────────────────────────────────── */

/** One settlement's contactable parents, fetched only on an explicit export. */
export type VillageContactRow = {
  villageId: string;
  villageName: string;
  blockName: string;
  latitude: number | null;
  longitude: number | null;
  childPool: number;
  leadCount: number;
  /** Distinct E.164 numbers. Empty when nobody in this village is reachable. */
  phones: string[];
};

export type VillageContactsResponse = {
  ok: true;
  rows: VillageContactRow[];
  totals: { settlements: number; contacts: number; withCoordinates: number };
};

export type VillageContactsResult = VillageContactsResponse | { ok: false; error: string };

/** RFC 4180: quote when the value contains a comma, quote or newline. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (!/[",\r\n]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

export function csvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(",");
}

/**
 * The planning sheet: one row per settlement, with its whole contact list in
 * a single cell.
 *
 * This is NOT a Meta customer-list upload and will not import as one — that
 * format is one row per person and has no village or coordinate columns. This
 * is the sheet you plan location targeting and field routes from, and hand to
 * whoever sets the campaign up.
 */
export function buildVillageTargetingCsv(rows: VillageContactRow[]): string {
  const header = [
    "Village Name",
    "Block",
    "Latitude",
    "Longitude",
    "Estimated Children 0-6",
    "Registered Leads",
    "Contactable Numbers",
    "Collected Parent Phone Numbers",
  ];
  const body = rows.map((r) =>
    csvRow([
      r.villageName,
      r.blockName,
      r.latitude ?? "",
      r.longitude ?? "",
      r.childPool,
      r.leadCount,
      r.phones.length,
      // The comma-separated blob is why every cell goes through csvCell:
      // unquoted, it would shift every column after it.
      r.phones.join(", "),
    ]),
  );
  return [csvRow(header), ...body].join("\r\n");
}

/**
 * The file Meta Ads Manager actually ingests for a Customer List audience:
 * one identifier per row, using Meta's own column names.
 *
 * Numbers are E.164 because that is what matches; `country` is included
 * because Meta's matcher uses it to disambiguate. Nothing inaccurate is
 * added — a wrong city or name column lowers the match rate rather than
 * raising it.
 */
export function buildMetaCustomAudienceCsv(rows: VillageContactRow[]): string {
  const seen = new Set<string>();
  const lines = [csvRow(["phone", "country"])];
  for (const r of rows) {
    for (const phone of r.phones) {
      if (seen.has(phone)) continue;
      seen.add(phone);
      lines.push(csvRow([phone, "IN"]));
    }
  }
  return lines.join("\r\n");
}

/** Numbers exported, de-duplicated across settlements. */
export function countUniquePhones(rows: VillageContactRow[]): number {
  const seen = new Set<string>();
  for (const r of rows) for (const p of r.phones) seen.add(p);
  return seen.size;
}

/* ─── Component state ──────────────────────────────────────── */

export type VillageGridQuery = {
  mode: VillageQueryMode;
  lat: number;
  lon: number;
  radiusM: number;
  blocks: string[];
  search: string;
  settlementType: SettlementFilter;
  minChildPool: number;
  academicYearCode: string;
};

export type VillageGridSort = "distance" | "opportunity" | "penetration" | "pool";

export type VillageGridState =
  | { status: "idle" }
  | { status: "loading"; query: VillageGridQuery }
  | { status: "ready"; query: VillageGridQuery; data: VillagesNearbyResponse }
  | { status: "error"; query: VillageGridQuery; message: string; retryable: boolean };

/* ─── Pure maths ───────────────────────────────────────────── */

/**
 * Fold a village name to a comparison key: case, punctuation, the
 * "(Rural)" / "(CT)" suffixes the PCA appends, and the Hindi-transliteration
 * doubled vowels that make Ayar / Aayar two strings for one place.
 */
export function normalizeVillageName(raw: string): string {
  return (raw || "")
    .toLowerCase()
    .replace(/\((rural|urban|ct|cb|og|part)\)/g, " ")
    .replace(/[^a-zऀ-ॿ]+/g, " ")
    .replace(/aa+/g, "a")
    .replace(/ee+/g, "i")
    .replace(/oo+/g, "u")
    .trim()
    .replace(/\s+/g, " ");
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in km, rounded to 2dp. */
export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const km = 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  return Math.round(km * 100) / 100;
}

/**
 * The same arithmetic the database trigger runs, so the seeder and the UI
 * can preview a projection without a round trip. Keep in step with
 * `village_demographics_project()`.
 */
export function projectPopulation(
  popTotal2011: number,
  growthMultiplier = DEFAULT_GROWTH_MULTIPLIER,
  childRatio = DEFAULT_CHILD_RATIO,
): { popTotal: number; child06Total: number; annualBirthCohort: number } {
  const base = Number.isFinite(popTotal2011) ? Math.max(0, popTotal2011) : 0;
  const popTotal = Math.round(base * growthMultiplier);
  const child06Total = Math.round(popTotal * childRatio);
  return {
    popTotal,
    child06Total,
    annualBirthCohort: Math.round(child06Total / CHILD_COHORT_YEARS),
  };
}

/**
 * Leads as a percentage of the projected pool, 1dp.
 *
 * Returns null when the pool is zero or unknown. A village we have no census
 * row for is not a 0% village — it is an unmeasured one, and the grid says so
 * rather than painting it red and sending a bus there.
 */
export function penetrationPct(leads: number, pool: number): number | null {
  if (!Number.isFinite(pool) || pool <= 0) return null;
  if (!Number.isFinite(leads) || leads < 0) return null;
  return Math.round((leads / pool) * 1000) / 10;
}

export function penetrationBand(pct: number | null): PenetrationBand {
  if (pct === null) return "unknown";
  if (pct <= 0) return "untouched";
  if (pct < 2) return "low";
  if (pct < 6) return "medium";
  return "high";
}

/**
 * Ranking for "where should the next camp go": the biggest pool we have
 * barely touched, discounted by how far the bus has to drive. Villages with
 * no census row score 0 — we cannot claim an opportunity we cannot size.
 */
export function opportunityScore(row: VillageMarketRow): number {
  const pool = row.census?.projected.child06Total ?? 0;
  if (pool <= 0) return 0;
  const pct = row.penetrationPct ?? 0;
  const untapped = Math.max(0, pool * (1 - Math.min(pct, 100) / 100));
  // An unmapped village is not penalised for distance — we do not know it.
  // Inventing a large distance would bury real opportunities.
  if (row.distanceKm === null) return Math.round(untapped);
  const distancePenalty = 1 / (1 + Math.max(0, row.distanceKm) / 5);
  return Math.round(untapped * distancePenalty);
}

/** 12,345 → "12,345" in the Indian grouping the office reads. */
export function formatIndianNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN").format(Math.round(n));
}

/** Percentages the office reads: null → "—", never "0%". */
export function formatPct(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return "—";
  return `${pct.toFixed(1)}%`;
}

/** Coerce PostgREST numerics (which arrive as strings) to a number. */
export function toNumber(v: number | string | null | undefined, fallback = 0): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}
