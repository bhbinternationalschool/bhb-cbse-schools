#!/usr/bin/env npx tsx
/**
 * Link each enrolled household to its census village, by scanning its address.
 *
 * WHY THE ADDRESS AND NOT THE LEAD IT CAME FROM
 * admission_desk_households.sis_household_id is populated on 0 of 1,000 rows,
 * and matching households to leads by mobile reaches 8 of 198 — 4%. The 919
 * field-survey leads are prospects; the 198 enrolled households arrived by a
 * different route. Their own address text carries the village name in 80% of
 * cases, which is the only source that actually covers the roster.
 *
 * WHAT THIS UNLOCKS
 * Every linked household inherits its village's road distance and drive time
 * to campus, already resolved for 1,122 villages. That is the demand side of
 * route planning: how many students sit on each corridor and how far away.
 *
 * WHAT IT IS NOT
 * A census village centroid places a family in the right VILLAGE, not at the
 * right house. Good enough to decide which stop serves a village and to price
 * a distance slab; not good enough to choose between two stops 400 m apart.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/backfill-household-village.ts --dry-run
 *   npx tsx scripts/backfill-household-village.ts
 */

import { loadEnvLocal } from "./lib/loadEnvLocal";

loadEnvLocal();

import { getServerTenantContext } from "../src/lib/serverTenant";

const LOG = "[household-village]";

/**
 * Shortest name we will match on.
 *
 * Below four characters a village name starts appearing inside unrelated
 * words — "Aura" sits inside "Chaurasia", a common surname in these
 * addresses — and a wrong village is worse than none.
 */
const MIN_NAME = 4;

type Village = { id: string; name: string; block: string };

/** Fold for matching: lowercase, punctuation to spaces, single-spaced. */
function fold(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Does `haystack` contain `needle` as whole words?
 *
 * Substring matching is not enough: "Aura" would match "Chaurasia" and
 * "Bari" would match "Baripur". Both sides are already folded, so word
 * boundaries are plain spaces.
 */
export function containsWords(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

/**
 * Consonant skeleton — drop the vowels, keep the order.
 *
 * "Aayar" and "Ayar" both give "yr"… which is why this is only used when the
 * skeleton is long enough to be distinctive. On short names it collides
 * freely (Akla / Ekala / Koila all give "kl").
 */
export function consonantKey(s: string): string {
  return s.replace(/[^a-z]/g, "").replace(/[aeiou]/g, "");
}

/** Minimum consonant skeleton length before a skeleton match is trusted. */
const MIN_SKELETON = 4;

export type MatchResult =
  | { kind: "exact"; village: Village; matchedOn: string }
  | { kind: "ambiguous"; name: string; block: string; matchedOn: string }
  | { kind: "none" };

/**
 * Find the village named in an address.
 *
 * Longest name first, so "Puari Kala" wins over "Puari" and "Bira Patti" over
 * "Bira". When several villages share the matched name — Chandapur exists in
 * three blocks — the name is kept and the id withheld, because picking a
 * block would present a coin-flip as a location.
 */
export function matchVillageInAddress(
  address: string,
  villagesByName: Map<string, Village[]>,
  namesLongestFirst: string[],
): MatchResult {
  const addr = fold(address);
  if (!addr) return { kind: "none" };

  const decide = (name: string, matchedOn: string): MatchResult | null => {
    const hits = villagesByName.get(name) ?? [];
    if (hits.length === 1) return { kind: "exact", village: hits[0], matchedOn };
    if (hits.length > 1) return { kind: "ambiguous", name: hits[0].name, block: "", matchedOn };
    return null;
  };

  // Pass 1 — the name appears as whole words. Longest first, so "Puari Kala"
  // is tried before "Puari".
  for (const name of namesLongestFirst) {
    if (!containsWords(addr, name)) continue;
    const hit = decide(name, name);
    if (hit) return hit;
  }

  // Pass 2 — the same name written without its spaces. Addresses here say
  // "Puarikala" and "Puarikalan" where the census says "Puari Kala"; that is
  // 25 of the 55 households pass 1 could not place. Still an exact string
  // comparison, just with spacing normalised out of both sides.
  const addrSquashed = addr.replace(/\s+/g, "");
  for (const name of namesLongestFirst) {
    const squashed = name.replace(/\s+/g, "");
    if (squashed.length < MIN_NAME + 2) continue;
    if (!addrSquashed.includes(squashed)) continue;
    const hit = decide(name, `${name} (as "${squashed}")`);
    if (hit) return hit;
  }

  // Pass 3 — same consonants, different vowels: "Aayar" for "Ayar". Only for
  // skeletons long enough to be distinctive, and only against a single
  // address word, so this cannot match halfway across a sentence.
  const words = addr.split(" ").filter((w) => w.length >= MIN_NAME);
  for (const name of namesLongestFirst) {
    if (name.includes(" ")) continue;
    const key = consonantKey(name);
    if (key.length < MIN_SKELETON) continue;
    if (!words.some((w) => consonantKey(w) === key)) continue;
    const hit = decide(name, `${name} (same consonants)`);
    if (hit) return hit;
  }

  return { kind: "none" };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const ctx = await getServerTenantContext();
  if (!ctx) throw new Error("Supabase service-role context unavailable");

  /* ── villages ─────────────────────────────────────────────── */
  // Paginated: Supabase caps rows server-side and a wider range does not
  // lift it — an unpaginated read silently returns 1,000 of 1,292.
  const villages: Village[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await ctx.sb
      .from("village_demographics")
      .select("id, village_name, block_name")
      .eq("tenant_id", ctx.tenantId)
      .order("census_code")
      .range(from, from + 999);
    if (error) throw new Error(`Could not read villages: ${error.message}`);
    const page = (data as unknown as { id: string; village_name: string; block_name: string }[] | null) ?? [];
    villages.push(...page.map((v) => ({ id: v.id, name: v.village_name, block: v.block_name })));
    if (page.length < 1000) break;
  }

  const byName = new Map<string, Village[]>();
  for (const v of villages) {
    const key = fold(v.name);
    if (key.length < MIN_NAME) continue;
    const list = byName.get(key) ?? [];
    list.push(v);
    byName.set(key, list);
  }
  const namesLongestFirst = [...byName.keys()].sort((a, b) => b.length - a.length);
  console.info(`${LOG} ${villages.length} villages, ${byName.size} distinct matchable names`);

  /* ── households ───────────────────────────────────────────── */
  const households: { id: string; address: string; city: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await ctx.sb
      .from("sis_households")
      .select("id, address, city")
      .eq("tenant_id", ctx.tenantId)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`Could not read households: ${error.message}`);
    const page = (data as unknown as { id: string; address: string; city: string }[] | null) ?? [];
    households.push(...page);
    if (page.length < 1000) break;
  }

  // A person's choice outranks any re-run of the scanner.
  const { data: manualRows } = await ctx.sb
    .from("sis_household_village")
    .select("household_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("match_source", "manual");
  const manual = new Set(
    ((manualRows as { household_id: string }[] | null) ?? []).map((r) => r.household_id),
  );
  if (manual.size) console.info(`${LOG} ${manual.size} household(s) confirmed by hand — left alone`);

  const rows: Record<string, unknown>[] = [];
  let exact = 0;
  let ambiguous = 0;
  let none = 0;
  const byBlock: Record<string, number> = {};

  for (const h of households) {
    if (manual.has(h.id)) continue;
    const result = matchVillageInAddress(
      `${h.address ?? ""} ${h.city ?? ""}`,
      byName,
      namesLongestFirst,
    );
    if (result.kind === "none") {
      none += 1;
      continue;
    }
    if (result.kind === "ambiguous") {
      ambiguous += 1;
      rows.push({
        household_id: h.id,
        tenant_id: ctx.tenantId,
        village_id: null,
        village_name: result.name,
        block_name: "",
        match_source: "address_scan",
        match_confidence: "ambiguous",
        matched_on: result.matchedOn,
        updated_at: new Date().toISOString(),
      });
      continue;
    }
    exact += 1;
    byBlock[result.village.block] = (byBlock[result.village.block] ?? 0) + 1;
    rows.push({
      household_id: h.id,
      tenant_id: ctx.tenantId,
      village_id: result.village.id,
      village_name: result.village.name,
      block_name: result.village.block,
      match_source: "address_scan",
      match_confidence: "exact",
      matched_on: result.matchedOn,
      updated_at: new Date().toISOString(),
    });
  }

  console.info(
    `${LOG} households=${households.length} exact=${exact} ambiguous=${ambiguous} noMatch=${none}`,
  );
  console.info(`${LOG} blocks: ${JSON.stringify(byBlock)}`);

  if (dryRun) {
    console.info(`${LOG} --dry-run: nothing written`);
    return;
  }
  if (!rows.length) {
    console.info(`${LOG} nothing to write`);
    return;
  }

  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await ctx.sb
      .from("sis_household_village")
      .upsert(chunk, { onConflict: "household_id" });
    if (error) throw new Error(`Could not save links: ${error.message}`);
  }

  console.info(
    `${LOG} done: ${rows.length} household(s) linked (${ambiguous} kept name-only, id withheld)`,
  );
  console.info(
    `${LOG} ${none} household(s) still unlinked — their address names no census village.`,
  );
}

main().catch((e) => {
  console.error(`${LOG} ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
