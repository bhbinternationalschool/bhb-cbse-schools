/**
 * Census 2011 PCA CSV → village_demographics rows.
 *
 * Parsing lives here rather than in scripts/seed-census.ts so it is type
 * checked with the rest of the app and covered by a self-test. The script
 * keeps the CLI, the file read and the database write.
 *
 * The output deliberately excludes estimated_current_total_pop /
 * estimated_current_child_pop: the database trigger derives those, and a
 * seeder that supplied them would be a second source of truth for the same
 * number.
 */

import { DEFAULT_CHILD_RATIO, DEFAULT_GROWTH_MULTIPLIER } from "@/lib/villageMarket";

/* ─── CSV ──────────────────────────────────────────────────── */

/**
 * RFC 4180 parser: quoted fields, embedded commas, doubled quotes, CRLF and
 * LF. PCA exports contain area names like `"Ayar, Rural"` — splitting on
 * commas shifts every column after it, which surfaces later as a village
 * with another village's population.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  // Strip a UTF-8 BOM, which would otherwise become part of the first header.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Fold a header to a comparison key: "TOT_P" and "Tot P" both become "totp". */
function headerKey(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Census PCA column names, plus the friendlier headers cleaned exports use.
 * The first alias present in the file wins.
 */
const COLUMN_ALIASES = {
  censusCode: ["townvillagecode", "townvillage", "villagecode", "villcode", "censuscode", "code"],
  areaName: ["areaname", "villagename", "village", "name"],
  blockName: ["subdistrictname", "blockname", "block", "tehsil", "subdistrict"],
  // "DT Name" before "District": in the CDB export "District" holds the
  // numeric district code (197) and "DT Name" holds "Varanasi". Picking the
  // code would name every village's district "197".
  districtName: ["districtname", "dtname", "distname", "district"],
  stateName: ["statename", "state"],
  // Hierarchical exports interleave DISTRICT / CD BLOCK / VILLAGE / TOWN
  // lines in one sheet. Without this we would seed a block's 232,759 people
  // as a single village.
  level: ["level", "reclevel", "recordlevel"],
  tru: ["tru", "ruralurban"],
  households: ["nohh", "households", "totalhouseholds", "hh"],
  popTotal: ["totp", "totalpopulationperson", "totalpopulation", "poptotal", "totalp"],
  popMale: ["totm", "totalpopulationmale", "popmale", "totalm"],
  popFemale: ["totf", "totalpopulationfemale", "popfemale", "totalf"],
  child06Total: ["p06", "populationinage06person", "child06", "childpop06"],
  child06Male: ["m06", "populationinage06male", "child06male"],
  child06Female: ["f06", "populationinage06female", "child06female"],
  literacy: ["plit", "literatespersons", "literate", "totalliterate"],
  latitude: ["latitude", "lat"],
  longitude: ["longitude", "lon", "lng"],
} as const;

export type CensusColumnKey = keyof typeof COLUMN_ALIASES;

export function resolveColumns(
  header: string[],
): Partial<Record<CensusColumnKey, number>> {
  const keys = header.map(headerKey);
  const out: Partial<Record<CensusColumnKey, number>> = {};
  for (const [name, aliases] of Object.entries(COLUMN_ALIASES) as [
    CensusColumnKey,
    readonly string[],
  ][]) {
    for (const alias of aliases) {
      const idx = keys.indexOf(headerKey(alias));
      if (idx >= 0) {
        out[name] = idx;
        break;
      }
    }
  }
  return out;
}

/** Census numeric cells carry thousands commas, and "-" for a real zero. */
export function cellInt(raw: string | undefined): number {
  if (raw === undefined) return 0;
  const cleaned = raw.replace(/[,\s]/g, "");
  if (!cleaned || cleaned === "-") return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

export function cellFloat(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const cleaned = raw.replace(/[,\s]/g, "");
  if (!cleaned || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * A name cell that is nothing but digits is a census CODE sitting in a
 * name-shaped column ("State" = "09"). Returning "" lets the caller fall
 * back to the supplied default instead of labelling a village's state "09".
 */
export function nameCell(raw: string | undefined): string {
  const v = (raw ?? "").trim();
  if (!v || /^[0-9]+$/.test(v)) return "";
  return v;
}

/** Strip the "(Rural)" / "(CT)" suffix the PCA appends to Area Name. */
export function cleanVillageName(raw: string): string {
  return raw
    .replace(/\s*\((rural|urban|ct|cb|og|part)\)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ─── Row build ────────────────────────────────────────────── */

/** Exactly the payload `village_demographics_upsert` expects. */
export type CensusSeedRow = {
  census_code: string;
  village_name: string;
  block_name: string;
  district_name: string;
  state_name: string;
  /** Census towns are a real market but must stay distinguishable. */
  settlement_type: "village" | "town";
  pop_total_2011: number;
  pop_male_2011: number;
  pop_female_2011: number;
  child_0_6_total_2011: number;
  child_0_6_male_2011: number;
  child_0_6_female_2011: number;
  households_2011: number;
  literacy_total_2011: number;
  growth_multiplier: number;
  child_ratio: number;
  latitude: number | null;
  longitude: number | null;
  source_note: string;
};

export type CensusBuildOptions = {
  district?: string;
  block?: string;
  state?: string;
  /** PCA TRU filter. "Total" rows are Rural+Urban and would double count. */
  tru?: "rural" | "urban" | "all";
  /**
   * Which `Level` rows to keep in a hierarchical export. Default is villages
   * only — DISTRICT / CD BLOCK / TOWN lines are aggregates of the very rows
   * beside them. Ignored when the file has no Level column.
   */
  levels?: string[];
  growth?: number;
  childRatio?: number;
  /** Use each village's own published 0-6 share instead of the flat default. */
  observedChildRatio?: boolean;
  limit?: number;
};

export type CensusBuildResult = {
  rows: CensusSeedRow[];
  skipped: { reason: string; count: number }[];
};

/** Level values that carry a block name down to the villages beneath them. */
const BLOCK_LEVELS = new Set([
  "cdblock",
  "cd block",
  "subdistrict",
  "sub-district",
  "sub district",
  "tehsil",
  "taluk",
  "block",
]);

/** Default: keep only the leaf rows that actually are villages. */
const DEFAULT_LEVELS = ["village"];

/** Levels that are settlements rather than aggregates, and what to call them. */
const SETTLEMENT_TYPE: Record<string, "village" | "town"> = {
  village: "village",
  town: "town",
  ct: "town",
  censustown: "town",
};

/** A village's own 0-6 share is only trusted inside a plausible range. */
const MIN_OBSERVED_CHILD_RATIO = 0.02;
const MAX_OBSERVED_CHILD_RATIO = 0.4;

/** Parse a CSV and build rows. See `buildCensusRowsFromTable` for the rules. */
export function buildCensusRows(
  csvText: string,
  options: CensusBuildOptions = {},
): CensusBuildResult {
  return buildCensusRowsFromTable(parseCsv(csvText), options);
}

/**
 * Build seed rows from an already-parsed sheet (CSV rows, or an XLSX sheet
 * converted to a matrix).
 *
 * Handles the two PCA layouts we see in practice:
 *  · flat — every row is a village and carries its own block column;
 *  · hierarchical — DISTRICT / CD BLOCK / VILLAGE / TOWN lines interleaved in
 *    one sheet, where a village's block is the CD BLOCK line ABOVE it and
 *    there is no block column at all. Keeping the aggregate lines would seed
 *    a whole block's population as one enormous village.
 */
export function buildCensusRowsFromTable(
  table: string[][],
  options: CensusBuildOptions = {},
): CensusBuildResult {
  const district = (options.district ?? "").trim();
  const block = (options.block ?? "").trim();
  const state = (options.state ?? "Uttar Pradesh").trim();
  const tru = options.tru ?? "rural";
  const growth = options.growth ?? DEFAULT_GROWTH_MULTIPLIER;
  const defaultChildRatio = options.childRatio ?? DEFAULT_CHILD_RATIO;
  const limit = options.limit ?? 0;
  const wantedLevels = new Set(
    (options.levels ?? DEFAULT_LEVELS).map((l) => l.toLowerCase().replace(/[^a-z]/g, "")),
  );

  if (table.length < 2) throw new Error("Sheet has no data rows");

  const header = table[0];
  const col = resolveColumns(header);
  if (col.areaName === undefined) {
    throw new Error(
      `Could not find a village-name column. Headers seen: ${header.join(", ")}`,
    );
  }
  if (col.popTotal === undefined) {
    throw new Error(
      `Could not find a total-population column (TOT_P). Headers seen: ${header.join(", ")}`,
    );
  }

  const skips = new Map<string, number>();
  const skip = (reason: string) => skips.set(reason, (skips.get(reason) ?? 0) + 1);

  const at = (row: string[], key: CensusColumnKey): string | undefined => {
    const idx = col[key];
    return idx === undefined ? undefined : row[idx];
  };

  // Deduplicate inside the file: the upsert would otherwise hit the unique
  // index and fail a whole chunk because of one repeated village.
  const seen = new Map<string, number>();
  const rows: CensusSeedRow[] = [];

  // Hierarchical files hand the block down from the CD BLOCK line above.
  const hasLevels = col.level !== undefined;
  let carriedBlock = "";

  for (let r = 1; r < table.length; r += 1) {
    if (limit > 0 && rows.length >= limit) break;
    const raw = table[r];

    const level = (at(raw, "level") || "").trim().toLowerCase().replace(/[^a-z]/g, "");
    if (hasLevels) {
      if (BLOCK_LEVELS.has(level) || BLOCK_LEVELS.has(level.replace(/\s/g, ""))) {
        // Remember it, then skip: a block line is the sum of its villages.
        const blockName = nameCell(at(raw, "areaName"));
        if (blockName) carriedBlock = cleanVillageName(blockName);
        skip("aggregate line (block total)");
        continue;
      }
      if (!wantedLevels.has(level)) {
        skip(`level "${level || "blank"}" is not a village`);
        continue;
      }
    }

    const villageName = cleanVillageName(nameCell(at(raw, "areaName")));
    if (!villageName) {
      skip("no village name");
      continue;
    }

    const rowTru = (at(raw, "tru") || "").trim().toLowerCase();
    if (tru !== "all" && rowTru && rowTru !== tru) {
      skip(`TRU is "${rowTru}", wanted "${tru}"`);
      continue;
    }

    const districtName = nameCell(at(raw, "districtName")) || district;
    if (district && districtName.toLowerCase() !== district.toLowerCase()) {
      skip("outside the requested district");
      continue;
    }

    // Column first, then the carried CD BLOCK, then the CLI default.
    const blockName = nameCell(at(raw, "blockName")) || carriedBlock || block;
    if (block && blockName.toLowerCase() !== block.toLowerCase()) {
      skip("outside the requested block");
      continue;
    }

    const popTotal = cellInt(at(raw, "popTotal"));
    if (popTotal <= 0) {
      // Uninhabited villages are published with 0 population, and footer
      // lines look the same. Neither is a market.
      skip("population is 0 or missing");
      continue;
    }

    const child06 = cellInt(at(raw, "child06Total"));

    // The observed ratio is used only when actually published and plausible;
    // otherwise the flat default stands rather than an invented number.
    let childRatio = defaultChildRatio;
    if (options.observedChildRatio && child06 > 0) {
      const observed = child06 / popTotal;
      if (observed > MIN_OBSERVED_CHILD_RATIO && observed < MAX_OBSERVED_CHILD_RATIO) {
        childRatio = Math.round(observed * 10000) / 10000;
      }
    }

    // A code that is all zeroes is a placeholder on an aggregate line, not an
    // identity — treat it as absent so it cannot collide with another.
    const rawCode = (at(raw, "censusCode") || "").trim();
    const censusCode = /^0+$/.test(rawCode) ? "" : rawCode;

    const dedupeKey = censusCode
      ? `code:${censusCode}`
      : `name:${villageName.toLowerCase()}|${blockName.toLowerCase()}`;

    const row: CensusSeedRow = {
      census_code: censusCode,
      village_name: villageName,
      block_name: blockName,
      district_name: districtName,
      state_name: nameCell(at(raw, "stateName")) || state,
      settlement_type: SETTLEMENT_TYPE[level] ?? "village",
      pop_total_2011: popTotal,
      pop_male_2011: cellInt(at(raw, "popMale")),
      pop_female_2011: cellInt(at(raw, "popFemale")),
      child_0_6_total_2011: child06,
      child_0_6_male_2011: cellInt(at(raw, "child06Male")),
      child_0_6_female_2011: cellInt(at(raw, "child06Female")),
      households_2011: cellInt(at(raw, "households")),
      literacy_total_2011: cellInt(at(raw, "literacy")),
      growth_multiplier: growth,
      child_ratio: childRatio,
      latitude: cellFloat(at(raw, "latitude")),
      longitude: cellFloat(at(raw, "longitude")),
      source_note: "Census of India 2011 — PCA",
    };

    const already = seen.get(dedupeKey);
    if (already === undefined) {
      seen.set(dedupeKey, rows.length);
      rows.push(row);
      continue;
    }

    // A duplicate is usually a "Total" line beside a "Rural" line. Keep the
    // larger of the two — the smaller one is a part, not the village.
    skip("duplicate village in file");
    if (popTotal > rows[already].pop_total_2011) rows[already] = row;
  }

  return {
    rows,
    skipped: [...skips.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  };
}
