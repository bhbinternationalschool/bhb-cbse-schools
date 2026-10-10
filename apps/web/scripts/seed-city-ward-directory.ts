#!/usr/bin/env npx tsx
/**
 * Seed city_ward_directory from the official 2022 Nagar Nigam delimitation.
 *
 * Source: apps/web/data/varanasi-nagar-nigam-wards-2022.json — transcribed
 * from UP Govt notification 3474/9-1-2022-55Pari/22 (nnvns.org.in). This
 * script turns each ward's gazetted extent into match-ready locality rows:
 * the ward's own name plus every mohalla, minus the entries that are code
 * ranges ("S-8/401 to 420"), boundary prose, or bare direction words.
 *
 * The JSON stays the faithful transcription; the cleaning happens here, so a
 * questionable row can always be traced back to the gazette wording.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/seed-city-ward-directory.ts --dry-run
 *   npx tsx scripts/seed-city-ward-directory.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvLocal } from "./lib/loadEnvLocal";

loadEnvLocal();

import { getServerTenantContext } from "../src/lib/serverTenant";

const LOG = "[seed-city-wards]";

type WardsFile = {
  source: { notification: string };
  wards: { no: number; name: string; name_hi: string; localities: string[] }[];
};

/** Words that survive cleaning but are not places on their own. */
const STOPWORDS = new Set([
  "upper", "lower", "part", "complete", "total", "north", "south", "east",
  "west", "northern", "southern", "eastern", "western", "last",
]);

/** Trailing qualifiers the gazette appends that are not part of the name. */
const TRAILING = /\s+(part|complete|sampurn|anshik)$/i;

/**
 * One gazette extent entry → zero or more locality names.
 *
 * Dropped entirely: census enumeration-code ranges ("S-8/401 to 420",
 * "A.39/1 to A.39/159") — they identify house-number spans, not places a
 * parent would write as their locality.
 */
export function cleanExtentEntry(raw: string): string[] {
  let s = (raw || "").trim();
  if (!s) return [];

  // "BHU Ward No 5" and friends → the campus itself is the locality.
  if (/^BHU\b/i.test(s)) return ["BHU"];

  // Parentheticals are qualifiers ("(East)", "(B-16)", "(part)") — never
  // part of the name a parent writes.
  s = s.replace(/\([^)]*\)/g, " ");

  // Code ranges make the whole entry a house-number span, not a place.
  if (/\d+\s*\/\s*\d+/.test(s)) return [];

  return s
    .split(/,|\band\b/i)
    .map((part) =>
      part
        .replace(/\bRevenue Village\b/gi, " ")
        .replace(/\bNagar Panchayat\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
        // After the whitespace collapse, or "part " (trailing space) escapes.
        .replace(TRAILING, "")
        .trim(),
    )
    .filter((name) => {
      if (name.length < 3 || name.length > 40) return false;
      if (STOPWORDS.has(name.toLowerCase())) return false;
      // A leftover code fragment ("S-2", "C33") is not a locality.
      if (/^[A-Z]{1,3}[-.]?\s*\d/.test(name)) return false;
      return true;
    });
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const path = resolve(process.cwd(), "data/varanasi-nagar-nigam-wards-2022.json");
  const file = JSON.parse(readFileSync(path, "utf8")) as WardsFile;

  if (file.wards.length !== 100) {
    throw new Error(`Expected 100 wards in ${path}, found ${file.wards.length}`);
  }

  type Row = {
    ward_no: number;
    ward_name: string;
    ward_name_hi: string;
    locality: string;
  };
  const rows: Row[] = [];
  const skipped: string[] = [];

  for (const w of file.wards) {
    const seen = new Set<string>();
    const push = (locality: string) => {
      const key = locality.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({
        ward_no: w.no,
        ward_name: w.name,
        ward_name_hi: w.name_hi,
        locality,
      });
    };

    // The ward's own name is what most people will actually write.
    // "Chhittupur (Loko Chhittupur)" carries its qualifier as a real alias.
    for (const part of cleanExtentEntry(w.name)) push(part);

    for (const entry of w.localities) {
      const parts = cleanExtentEntry(entry);
      if (!parts.length) skipped.push(`${w.no}: ${entry}`);
      for (const part of parts) push(part);
    }
  }

  console.info(`${LOG} built ${rows.length} locality rows for 100 wards`);
  console.info(`${LOG} skipped ${skipped.length} extent entries (code ranges/prose):`);
  for (const s of skipped) console.info(`${LOG}   - ${s}`);

  if (dryRun) {
    const sample = rows.filter((r) => [24, 53, 55].includes(r.ward_no));
    for (const r of sample) console.info(`${LOG} sample: ward ${r.ward_no} ${r.ward_name} ← "${r.locality}"`);
    console.info(`${LOG} --dry-run: nothing written`);
    return;
  }

  const tenant = await getServerTenantContext();
  if (!tenant) {
    throw new Error(
      "Supabase service-role context unavailable — need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in apps/web/.env.local",
    );
  }

  const payload = rows.map((r) => ({ ...r, tenant_id: tenant.tenantId }));
  const CHUNK = 200;
  let written = 0;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const chunk = payload.slice(i, i + CHUNK);
    const { error } = await tenant.sb
      .from("city_ward_directory")
      .upsert(chunk, { onConflict: "tenant_id,ward_no,locality_key" });
    if (error) throw new Error(`chunk ${i / CHUNK + 1} failed: ${error.message}`);
    written += chunk.length;
    console.info(`${LOG} upserted ${written}/${payload.length}`);
  }

  const { count, error } = await tenant.sb
    .from("city_ward_directory")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.tenantId);
  if (error) throw new Error(`count check failed: ${error.message}`);
  console.info(`${LOG} done — table now holds ${count} rows for this tenant`);
}

main().catch((e) => {
  console.error(`${LOG} ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
