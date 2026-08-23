#!/usr/bin/env npx tsx
/**
 * Import village coordinates from a census-code keyed CSV.
 *
 * WHY THIS EXISTS
 * Google cannot geocode rural Varanasi village names. The Geocoding API
 * resolved 0 of Harhua's 169 villages (every one widened to the district
 * centroid); Places Text Search resolved 79. The remaining 90 — and the
 * ~1,100 villages in the other seven blocks — need coordinates from a
 * dataset that is keyed to census codes rather than from a search box.
 *
 * INPUT is deliberately source-agnostic: a CSV of
 *
 *     census_code,village_name,latitude,longitude
 *
 * so the same importer works whichever dataset the school is licensed to
 * use. The join is on census_code = village_demographics.census_code, which
 * is the PC11 town/village id and the only true identity in this data
 * (village names repeat across blocks — see the partial unique index on
 * village_demographics).
 *
 * Usage (from apps/web):
 *   npx tsx scripts/import-village-coordinates.ts --file ./centroids.csv --dry-run
 *   npx tsx scripts/import-village-coordinates.ts --file ./centroids.csv --source shrug
 *
 * Flags:
 *   --file <path>     CSV to read (required)
 *   --source <name>   Recorded on each row for provenance (default "import")
 *   --overwrite       Replace coordinates that are already set. Off by
 *                     default: an OpenStreetMap match already on the row was
 *                     verified against a real place and outranks a centroid.
 *   --dry-run         Report what would change; write nothing.
 *
 * Coordinates land on village_demographics.latitude/longitude, which
 * villageTravel.server.ts checks BEFORE spending a geocoding call — so after
 * this import, resolving travel costs one Distance Matrix element per
 * village instead of two paid calls, and cannot silently land on a centroid.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvLocal } from "./lib/loadEnvLocal";

loadEnvLocal();

import { parseCsv } from "../src/lib/censusPca";
import { getServerTenantContext } from "../src/lib/serverTenant";

const LOG = "[import-coords]";
const BATCH = 300;

/** Varanasi district sits inside this envelope; anything outside is a bad row. */
const PLAUSIBLE = { minLat: 20, maxLat: 31, minLon: 77, maxLon: 89 };

type Row = { censusCode: string; villageName: string; lat: number; lon: number };

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const file = get("--file") || "";
  if (!file) throw new Error("--file <path-to-csv> is required");
  return {
    file,
    source: (get("--source") || "import").trim(),
    overwrite: argv.includes("--overwrite"),
    dryRun: argv.includes("--dry-run"),
  };
}

function readRows(path: string): { rows: Row[]; skipped: number } {
  const table = parseCsv(readFileSync(path, "utf8"));
  if (table.length < 2) throw new Error("CSV has no data rows");

  const header = table[0].map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
  const idx = (...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iCode = idx("censuscode", "code", "pc11townvillageid", "townvillagecode");
  const iName = idx("villagename", "name", "townvillagename");
  const iLat = idx("latitude", "lat");
  const iLon = idx("longitude", "lon", "lng");

  if (iCode < 0) throw new Error(`No census-code column. Headers: ${table[0].join(", ")}`);
  if (iLat < 0 || iLon < 0) throw new Error(`No latitude/longitude columns. Headers: ${table[0].join(", ")}`);

  const rows: Row[] = [];
  let skipped = 0;
  for (let r = 1; r < table.length; r += 1) {
    const raw = table[r];
    const censusCode = (raw[iCode] || "").trim();
    const lat = Number(raw[iLat]);
    const lon = Number(raw[iLon]);
    // A row whose coordinates are absent, unparseable or outside north India
    // is a parsing mistake, not a village — importing it would put a
    // settlement in the sea and hand every lead there a nonsense distance.
    if (
      !censusCode ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < PLAUSIBLE.minLat ||
      lat > PLAUSIBLE.maxLat ||
      lon < PLAUSIBLE.minLon ||
      lon > PLAUSIBLE.maxLon
    ) {
      skipped += 1;
      continue;
    }
    rows.push({
      censusCode,
      villageName: (raw[iName] || "").trim(),
      lat: Math.round(lat * 1e6) / 1e6,
      lon: Math.round(lon * 1e6) / 1e6,
    });
  }
  return { rows, skipped };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const path = resolve(process.cwd(), args.file);

  console.info(`${LOG} reading ${path}`);
  const { rows, skipped } = readRows(path);
  console.info(`${LOG} ${rows.length} usable row(s), ${skipped} skipped as implausible`);
  if (!rows.length) process.exit(1);

  const ctx = await getServerTenantContext();
  if (!ctx) throw new Error("Supabase service-role context unavailable — check apps/web/.env.local");

  // Only settlements this tenant actually has. The CSV may cover a whole
  // district while the school has seeded one part of it.
  //
  // Paginated because Supabase enforces a server-side max-rows cap (1,000
  // here) that a wider .range() does NOT lift — a single call silently
  // returned 1,000 of 1,292 and would have left 292 villages without
  // coordinates while reporting success. The same cap has already cost this
  // module a missing block in the picker; it is invisible every time.
  type VillageRow = {
    id: string;
    census_code: string;
    village_name: string;
    latitude: number | null;
    longitude: number | null;
  };
  const PAGE = 1000;
  const mine: VillageRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await ctx.sb
      .from("village_demographics")
      .select("id, census_code, village_name, latitude, longitude")
      .eq("tenant_id", ctx.tenantId)
      .order("census_code", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read settlements: ${error.message}`);
    const page = (data as unknown as VillageRow[] | null) ?? [];
    mine.push(...page);
    if (page.length < PAGE) break;
  }

  const byCode = new Map(rows.map((r) => [r.censusCode, r]));
  const source = ["osm", "shrug", "manual", "import"].includes(args.source)
    ? args.source
    : "import";
  const updates: { id: string; latitude: number; longitude: number }[] = [];
  let alreadySet = 0;
  let noMatch = 0;
  const nameMismatch: string[] = [];

  for (const v of mine) {
    const hit = byCode.get(String(v.census_code));
    if (!hit) {
      noMatch += 1;
      continue;
    }
    if (!args.overwrite && v.latitude !== null && v.longitude !== null) {
      alreadySet += 1;
      continue;
    }
    // Codes are the identity, but a name that disagrees is worth seeing —
    // it usually means the CSV is for a different district.
    if (
      hit.villageName &&
      hit.villageName.toLowerCase() !== (v.village_name || "").toLowerCase() &&
      nameMismatch.length < 10
    ) {
      nameMismatch.push(`${v.census_code}: ours "${v.village_name}" vs csv "${hit.villageName}"`);
    }
    updates.push({ id: v.id, latitude: hit.lat, longitude: hit.lon });
  }

  console.info(
    `${LOG} settlements=${mine.length} toUpdate=${updates.length} ` +
      `alreadyHadCoords=${alreadySet} noCsvMatch=${noMatch}`,
  );
  for (const m of nameMismatch) console.warn(`${LOG}   name mismatch — ${m}`);

  if (args.dryRun) {
    console.info(`${LOG} --dry-run: nothing written`);
    return;
  }
  if (!updates.length) {
    console.info(`${LOG} nothing to update`);
    return;
  }

  let written = 0;
  for (let i = 0; i < updates.length; i += BATCH) {
    const chunk = updates.slice(i, i + BATCH);
    // Updated one by one rather than upserted: an upsert would need every
    // NOT NULL column in the payload and would rewrite census figures we did
    // not come here to touch.
    for (const u of chunk) {
      const { error: upErr } = await ctx.sb
        .from("village_demographics")
        .update({
          latitude: u.latitude,
          longitude: u.longitude,
          coordinate_source: source,
        })
        .eq("tenant_id", ctx.tenantId)
        .eq("id", u.id);
      if (upErr) {
        console.error(`${LOG} update failed id=${u.id}: ${upErr.message}`);
        process.exit(1);
      }
      written += 1;
    }
    console.info(`${LOG} ${written}/${updates.length}`);
  }

  console.info(`${LOG} done: ${written} settlement(s) given coordinates, source="${source}"`);
  console.info(
    `${LOG} next: resolve travel times — they now cost one Distance Matrix call each, with no geocoding.`,
  );
}

main().catch((e) => {
  console.error(`${LOG} ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
