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
import { haversineKm } from "../src/lib/villageMarket";

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
  | { kind: "exact"; village: Village; matchedOn: string; matchedOnName: string; candidates: Village[] }
  | { kind: "ambiguous"; name: string; block: string; matchedOn: string; matchedOnName: string; candidates: Village[] }
  | { kind: "none"; matchedOnName?: string };

/** Where a student actually boards, when transport has been arranged. */
export type StopPoint = { lat: number; lon: number; name: string };

/**
 * A matched village further than this from the student's own bus stop is not
 * believable as their home village.
 *
 * The whole roster's median village-to-stop gap is about 1 km and the largest
 * defensible one is a main-road hub at roughly 4 km. Eight is generous.
 */
const MAX_PLAUSIBLE_STOP_KM = 8;

/** How close to the stop a rescued village must be to be believable. */
const NEARBY_RESCUE_KM = 3;

/** Squashed comparison key: letters only, no spaces. */
function nameKey(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z]/g, "");
}

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
    if (hits.length === 1) {
      return { kind: "exact", village: hits[0], matchedOn, matchedOnName: name, candidates: hits };
    }
    if (hits.length > 1) {
      return { kind: "ambiguous", name: hits[0].name, block: "", matchedOn, matchedOnName: name, candidates: hits };
    }
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
  //
  // Token equality, NOT substring. The first version used
  // addrSquashed.includes(squashed) and that reintroduced the very bug pass 1
  // exists to avoid: "Pahari" matched inside "Paharia" and put five families
  // in a village 12 km from the stop whose name their address actually
  // carried. "Shambhu Pur" matched inside "Pali Shambhupur" the same way.
  // Comparing whole words on both sides cannot do that.
  const addrWords = addr.split(" ").filter(Boolean);
  for (const name of namesLongestFirst) {
    const squashed = name.replace(/\s+/g, "");
    if (squashed.length < MIN_NAME + 2) continue;
    if (!addrWords.some((w) => w === squashed)) continue;
    const hit = decide(name, `${name} (written "${squashed}")`);
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

/**
 * Settle a name match against where the student actually boards.
 *
 * Two villages can carry the same name 19 km apart — "Shambhu Pur" in
 * Sevapuri and "Pali Shambhupur" in Harhua — and an address that names one
 * loosely cannot tell them apart. The bus stop can: a family boards near
 * home, so the candidate nearest their own stop is the one they live in.
 *
 * When the only candidate is implausibly far from the stop, the match is
 * WITHDRAWN rather than kept. That is the Paharia case: the address names a
 * Varanasi city locality with no census village of its own, and the closest
 * same-named village is 15 km away in another block. No village is the
 * correct answer there; a distant namesake is not.
 */
export function settleAgainstStop(
  result: MatchResult,
  stop: StopPoint | null,
  distance: (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => number,
  coords: Map<string, { lat: number; lon: number } | null>,
  nearbyVillages?: { village: Village; km: number }[],
): { result: MatchResult; changed: "" | "reassigned" | "withdrawn" } {
  if (result.kind === "none" || !stop) return { result, changed: "" };

  const scored = result.candidates
    .map((v) => {
      const c = coords.get(v.id);
      return c ? { v, km: distance({ lat: stop.lat, lon: stop.lon }, c) } : null;
    })
    .filter((x): x is { v: Village; km: number } => x !== null)
    .sort((a, b) => a.km - b.km);

  if (!scored.length) return { result, changed: "" };

  const nearest = scored[0];
  if (nearest.km > MAX_PLAUSIBLE_STOP_KM) {
    // Before giving up: the address may name the village loosely. "Shambhu
    // Pur" is a real village 19 km away in Sevapuri, but it is also most of
    // the name of "Pali Shambhupur", which sits 0.49 km from the stop these
    // children actually board at. If exactly one village near the stop has a
    // name containing the matched one, that is the family's village.
    const key = nameKey(result.matchedOnName);
    if (key.length >= 6 && nearbyVillages) {
      const contains = nearbyVillages.filter(
        (n) => n.km <= NEARBY_RESCUE_KM && nameKey(n.village.name).includes(key),
      );
      if (contains.length === 1) {
        return {
          result: {
            kind: "exact",
            village: contains[0].village,
            matchedOn: `${contains[0].village.name} (near their stop)`,
            candidates: result.candidates,
          },
          changed: "reassigned",
        };
      }
    }
    return { result: { kind: "none" }, changed: "withdrawn" };
  }

  const wasId = result.kind === "exact" ? result.village.id : null;
  return {
    result: { kind: "exact", village: nearest.v, matchedOn: result.matchedOn, candidates: result.candidates },
    changed: wasId && wasId !== nearest.v.id ? "reassigned" : "",
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const ctx = await getServerTenantContext();
  if (!ctx) throw new Error("Supabase service-role context unavailable");

  /* ── villages ─────────────────────────────────────────────── */
  // Paginated: Supabase caps rows server-side and a wider range does not
  // lift it — an unpaginated read silently returns 1,000 of 1,292.
  const villages: Village[] = [];
  const villagesFull: { id: string; latitude: number | null; longitude: number | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await ctx.sb
      .from("village_demographics")
      .select("id, village_name, block_name, latitude, longitude")
      .eq("tenant_id", ctx.tenantId)
      .order("census_code")
      .range(from, from + 999);
    if (error) throw new Error(`Could not read villages: ${error.message}`);
    const page = (data as unknown as { id: string; village_name: string; block_name: string; latitude: number | null; longitude: number | null }[] | null) ?? [];
    villages.push(...page.map((v) => ({ id: v.id, name: v.village_name, block: v.block_name })));
    villagesFull.push(...page.map((v) => ({ id: v.id, latitude: v.latitude, longitude: v.longitude })));
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

  /* ── where each household's child actually boards ─────────── */
  // Used only to settle which of several same-named villages a family lives
  // in, and to withdraw a match that sits impossibly far from their own stop.
  const vCoords = new Map<string, { lat: number; lon: number } | null>();
  for (const v of villagesFull) {
    vCoords.set(
      v.id,
      typeof v.latitude === "number" && typeof v.longitude === "number"
        ? { lat: v.latitude, lon: v.longitude }
        : null,
    );
  }

  const stopByHousehold = new Map<string, StopPoint>();
  {
    const { data: sl } = await ctx.sb
      .from("transport_desk_slices")
      .select("slice_key, payload")
      .eq("tenant_id", ctx.tenantId);
    const slices = new Map(((sl as { slice_key: string; payload: unknown }[] | null) ?? []).map((r) => [r.slice_key, r.payload]));
    const routes = (slices.get("routes") as Record<string, unknown>[] | undefined) ?? [];
    const assigns = (slices.get("assignments") as Record<string, unknown>[] | undefined) ?? [];
    const stopById = new Map<string, StopPoint>();
    for (const r of routes) {
      for (const st of ((r.stops as Record<string, unknown>[] | undefined) ?? [])) {
        if (typeof st.geoLat === "number" && typeof st.geoLng === "number") {
          stopById.set(String(st.id), { lat: st.geoLat, lon: st.geoLng, name: String(st.name ?? "") });
        }
      }
    }
    const studentHousehold = new Map<string, string>();
    for (let from = 0; ; from += 1000) {
      const { data } = await ctx.sb
        .from("sis_students")
        .select("id, household_id")
        .eq("tenant_id", ctx.tenantId)
        .order("id")
        .range(from, from + 999);
      const page = (data as { id: string; household_id: string | null }[] | null) ?? [];
      for (const st of page) if (st.household_id) studentHousehold.set(st.id, st.household_id);
      if (page.length < 1000) break;
    }
    for (const a of assigns) {
      const hh = studentHousehold.get(String(a.studentId));
      const stop = stopById.get(String(a.stopId));
      if (hh && stop && !stopByHousehold.has(hh)) stopByHousehold.set(hh, stop);
    }
    console.info(`${LOG} ${stopByHousehold.size} household(s) have a pinned bus stop to check against`);
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
  let reassigned = 0;
  let withdrawn = 0;
  const byBlock: Record<string, number> = {};

  for (const h of households) {
    if (manual.has(h.id)) continue;
    const raw = matchVillageInAddress(
      `${h.address ?? ""} ${h.city ?? ""}`,
      byName,
      namesLongestFirst,
    );
    const stopPoint = stopByHousehold.get(h.id) ?? null;
    // Villages close to this student's own stop, for the rescue path.
    const nearby = stopPoint
      ? villages
          .map((v) => {
            const c = vCoords.get(v.id);
            return c
              ? { village: v, km: haversineKm({ lat: stopPoint.lat, lon: stopPoint.lon }, c) }
              : null;
          })
          .filter((x): x is { village: Village; km: number } => x !== null && x.km <= NEARBY_RESCUE_KM)
      : undefined;
    const settled = settleAgainstStop(raw, stopPoint, haversineKm, vCoords, nearby);
    if (settled.changed === "reassigned") reassigned += 1;
    if (settled.changed === "withdrawn") withdrawn += 1;
    const result = settled.result;
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
  console.info(
    `${LOG} settled against the bus stop: ${reassigned} reassigned to a nearer namesake, ${withdrawn} withdrawn as too far to believe`,
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
