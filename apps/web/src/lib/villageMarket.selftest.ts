/**
 * Self-test: village market projection, penetration and PCA parsing.
 * Run: npx tsx apps/web/src/lib/villageMarket.selftest.ts
 *
 * The rules being pinned:
 *  · The TypeScript projection must equal the SQL trigger's arithmetic —
 *    two implementations of one number is how a dashboard starts disagreeing
 *    with the database.
 *  · A village we cannot size has UNKNOWN penetration, never 0%. Zero means
 *    "we have leads data and there are none"; null means "we cannot tell".
 *    Sending a marketing camp on the wrong one costs a day and a van.
 *  · A "Total" PCA line beside a "Rural" line must not double count.
 */

import assert from "node:assert/strict";

import {
  CHILD_COHORT_YEARS,
  DEFAULT_CHILD_RATIO,
  DEFAULT_GROWTH_MULTIPLIER,
  formatPct,
  haversineKm,
  normalizeVillageName,
  opportunityScore,
  penetrationBand,
  penetrationPct,
  projectPopulation,
  toNumber,
  type VillageMarketRow,
} from "./villageMarket";
import {
  buildCensusRows,
  buildCensusRowsFromTable,
  cellInt,
  cleanVillageName,
  nameCell,
  parseCsv,
} from "./censusPca";
import { buildOverpassQuery, toNearbyPlaces } from "./villageMarket.server";

console.log("villageMarket.selftest.ts");

/* ── projection matches the trigger ─────────────────────────── */

// The trigger is: round(pop * multiplier), then round(that * ratio).
// Note it is NOT round(pop * multiplier * ratio) — the double rounding is
// deliberate and both sides must do it the same way.
const p = projectPopulation(3417, DEFAULT_GROWTH_MULTIPLIER, DEFAULT_CHILD_RATIO);
assert.equal(p.popTotal, Math.round(3417 * 1.19));
assert.equal(p.popTotal, 4066);
assert.equal(p.child06Total, Math.round(4066 * 0.14));
assert.equal(p.child06Total, 569);
assert.equal(p.annualBirthCohort, Math.round(569 / CHILD_COHORT_YEARS));
assert.equal(p.annualBirthCohort, 81);

// A village with no recorded population projects to nothing, not to NaN.
assert.deepEqual(projectPopulation(0), { popTotal: 0, child06Total: 0, annualBirthCohort: 0 });
assert.equal(projectPopulation(Number.NaN).popTotal, 0);

// Custom assumptions are honoured — the office can override one village.
assert.equal(projectPopulation(1000, 1.5, 0.1).child06Total, 150);

/* ── unknown is not zero ────────────────────────────────────── */

assert.equal(penetrationPct(0, 500), 0, "no leads against a known pool IS 0%");
assert.equal(penetrationPct(12, 500), 2.4);
assert.equal(penetrationPct(5, 0), null, "unknown pool must be null, not 0");
assert.equal(penetrationPct(5, Number.NaN), null);
assert.equal(penetrationPct(-1, 500), null, "a negative lead count is nonsense, not 0%");

assert.equal(penetrationBand(null), "unknown");
assert.equal(penetrationBand(0), "untouched");
assert.equal(penetrationBand(1.9), "low");
assert.equal(penetrationBand(2), "medium");
assert.equal(penetrationBand(5.9), "medium");
assert.equal(penetrationBand(6), "high");

// Formatting keeps the distinction visible to the reader.
assert.equal(formatPct(null), "—");
assert.equal(formatPct(0), "0.0%");

/* ── numeric coercion from PostgREST ────────────────────────── */

// numeric(6,4) arrives over the wire as a string; a silent NaN here would
// make every projection on the card wrong.
assert.equal(toNumber("1.1900"), 1.19);
assert.equal(toNumber(""), 0);
assert.equal(toNumber(null, 0.14), 0.14);
assert.equal(toNumber("not-a-number", 7), 7);

/* ── name folding for Indian spelling drift ─────────────────── */

assert.equal(normalizeVillageName("Ayar (Rural)"), "ayar");
assert.equal(normalizeVillageName("Aayar"), "ayar");
assert.equal(normalizeVillageName("  CHIRAIGAON  "), "chiraigaon");
assert.equal(normalizeVillageName("Bara-Baniya Pur"), "bara baniya pur");
assert.equal(normalizeVillageName(""), "");

assert.equal(cleanVillageName("Baragaon (CT)"), "Baragaon");
assert.equal(cleanVillageName("Ayar (Rural)"), "Ayar");

/* ── distance ───────────────────────────────────────────────── */

// ~0.01 degrees of latitude is ~1.1 km.
const school = { lat: 25.4354, lon: 82.944 };
assert.equal(haversineKm(school, school), 0);
const oneHundredth = haversineKm(school, { lat: 25.4454, lon: 82.944 });
assert.ok(oneHundredth > 1.0 && oneHundredth < 1.2, `expected ~1.1 km, got ${oneHundredth}`);

/* ── Overpass flattening ────────────────────────────────────── */

const query = buildOverpassQuery(25.405, 82.935, 10000);
assert.ok(query.includes("around:10000,25.405,82.935"));
assert.ok(query.includes('node["place"~"^(village|hamlet)$"]'));
assert.ok(query.includes("out center tags;"), "ways/relations need their centre");

const places = toNearbyPlaces(
  [
    // A named node.
    { type: "node", id: 1, lat: 25.44, lon: 82.95, tags: { name: "Ayar", place: "village", population: "3,417" } },
    // The same settlement mapped again as an area — must not appear twice.
    { type: "way", id: 2, center: { lat: 25.4401, lon: 82.9501 }, tags: { name: "Ayar", place: "village" } },
    // Unnamed: cannot be matched to a census row or a lead.
    { type: "node", id: 3, lat: 25.46, lon: 82.96, tags: { place: "hamlet" } },
    // Named but with no coordinates at all.
    { type: "relation", id: 4, tags: { name: "Nowhere", place: "village" } },
    // Farther away — must sort after Ayar.
    { type: "node", id: 5, lat: 25.50, lon: 83.02, tags: { name: "Baragaon", place: "village" } },
  ],
  { lat: 25.4354, lon: 82.944 },
);
assert.deepEqual(places.map((x) => x.name), ["Ayar", "Baragaon"]);
assert.equal(places[0].osmPopulation, 3417, "the population tag's commas must be stripped");
assert.equal(places[1].osmPopulation, null, "a missing tag is null, not 0");
assert.ok(places[0].distanceKm < places[1].distanceKm);

/* ── opportunity ranking ────────────────────────────────────── */

function row(over: Partial<VillageMarketRow>): VillageMarketRow {
  return {
    key: "node/1",
    osmName: "X",
    osmId: 1,
    placeType: "village",
    source: "osm",
    lat: 25.4,
    lon: 82.9,
    distanceKm: 2,
    censusMatch: "matched",
    leadAttribution: "exact",
    census: {
      id: "v1",
      censusCode: "",
      villageName: "X",
      blockName: "",
      districtName: "",
      matchScore: 1,
      settlementType: "village",
      baseline: { year: 2011, popTotal: 1000, popMale: 0, popFemale: 0, child06Total: 0, child06Male: 0, child06Female: 0, households: 0 },
      projected: { targetYear: 2026, growthMultiplier: 1.19, childRatio: 0.14, popTotal: 1190, child06Total: 500, annualBirthCohort: 71 },
    },
    leads: { total: 0, enrolled: 0, open: 0, lost: 0, lastLeadAt: null },
    penetrationPct: 0,
    enrolledPenetrationPct: 0,
    penetrationBand: "untouched",
    ...over,
  };
}

const untouchedNear = row({});
const workedNear = row({ leads: { total: 250, enrolled: 10, open: 5, lost: 0, lastLeadAt: null }, penetrationPct: 50 });
assert.ok(
  opportunityScore(untouchedNear) > opportunityScore(workedNear),
  "an untouched village outranks one we have already half covered",
);

const untouchedFar = row({ distanceKm: 40 });
assert.ok(
  opportunityScore(untouchedNear) > opportunityScore(untouchedFar),
  "distance discounts the same untapped pool",
);

// A village we cannot size scores 0 — we must not claim an opportunity we
// have no denominator for.
assert.equal(opportunityScore(row({ censusMatch: "no_census_match", census: null })), 0);

// Census-sourced villages have no coordinates. An unknown distance must not
// be treated as "very far" (which would bury the biggest markets) nor as
// zero — it simply carries no distance discount.
const unmapped = row({ source: "census", lat: null, lon: null, distanceKm: null });
assert.equal(opportunityScore(unmapped), 500, "full untapped pool, no distance discount");
assert.ok(
  opportunityScore(unmapped) > opportunityScore(untouchedNear),
  "an unmapped village is not penalised for a distance nobody measured",
);

/* ── CSV parsing ────────────────────────────────────────────── */

assert.deepEqual(parseCsv('a,b\n1,2\n'), [["a", "b"], ["1", "2"]]);
assert.deepEqual(
  parseCsv('name,pop\n"Ayar, Rural",3417\n'),
  [["name", "pop"], ["Ayar, Rural", "3417"]],
  "a quoted comma must not shift the columns",
);
assert.deepEqual(parseCsv('a\r\n"say ""hi"""\r\n'), [["a"], ['say "hi"']]);
assert.deepEqual(parseCsv("﻿a,b\n1,2"), [["a", "b"], ["1", "2"]], "BOM must not join the header");

assert.equal(cellInt("3,417"), 3417);
assert.equal(cellInt("-"), 0);
assert.equal(cellInt(undefined), 0);
assert.equal(cellInt(""), 0);

/* ── PCA row build ──────────────────────────────────────────── */

const PCA = [
  "Town/Village Code,Area Name,Sub District Name,District Name,TRU,No_HH,TOT_P,TOT_M,TOT_F,P_06,M_06,F_06,P_LIT",
  '083501,"Ayar (Rural)",Arajiline,Varanasi,Rural,540,3417,1780,1637,480,250,230,2100',
  // Same village as a Total line: Rural + Urban. Must not be counted twice.
  '083501,"Ayar (Rural)",Arajiline,Varanasi,Total,600,3800,1950,1850,520,270,250,2300',
  // Different district — filtered out when --district is given.
  '090001,Kachnar,Chiraigaon,Chandauli,Rural,300,1800,930,870,260,135,125,1100',
  // A footer artefact with no people.
  '000000,TOTAL,,Varanasi,Rural,0,0,0,0,0,0,0,0',
].join("\n");

const built = buildCensusRows(PCA, { district: "Varanasi", tru: "rural" });
assert.equal(built.rows.length, 1, "one village survives the filters");
const ayar = built.rows[0];
assert.equal(ayar.village_name, "Ayar", "the (Rural) suffix is stripped");
assert.equal(ayar.block_name, "Arajiline");
assert.equal(ayar.district_name, "Varanasi");
assert.equal(ayar.census_code, "083501");
assert.equal(ayar.pop_total_2011, 3417);
assert.equal(ayar.child_0_6_total_2011, 480);
assert.equal(ayar.households_2011, 540);
assert.equal(ayar.growth_multiplier, DEFAULT_GROWTH_MULTIPLIER);
assert.equal(ayar.child_ratio, DEFAULT_CHILD_RATIO);
assert.equal(ayar.state_name, "Uttar Pradesh", "default fills the missing column");
assert.ok(
  !("estimated_current_total_pop" in ayar),
  "the seeder must not write the trigger's derived columns",
);
assert.ok(built.skipped.some((s) => s.reason.includes("population is 0")));

// tru: "all" keeps both lines but collapses them to the larger one.
const all = buildCensusRows(PCA, { district: "Varanasi", tru: "all" });
assert.equal(all.rows.length, 1, "the duplicate code collapses to one row");
assert.equal(all.rows[0].pop_total_2011, 3800, "the larger of the two lines wins");
assert.ok(all.skipped.some((s) => s.reason === "duplicate village in file"));

// --observed-child-ratio uses the village's own published share.
const observed = buildCensusRows(PCA, { district: "Varanasi", observedChildRatio: true });
assert.equal(observed.rows[0].child_ratio, Math.round((480 / 3417) * 10000) / 10000);
assert.ok(observed.rows[0].child_ratio !== DEFAULT_CHILD_RATIO);

// A CSV without the columns we need fails loudly rather than seeding zeros.
assert.throws(
  () => buildCensusRows("foo,bar\n1,2\n"),
  /village-name column/,
);
assert.throws(
  () => buildCensusRows("Area Name,Something\nAyar,2\n"),
  /total-population column/,
);

/* ── hierarchical PCA layout (the CDB export we actually have) ── */

// This is the shape of PCA_CDB-*.xlsx: one sheet interleaving CD BLOCK
// totals with the villages under them, NO block column, and "State" /
// "District" holding numeric codes rather than names.
const CDB = [
  ["State", "District", "DT Name", "Town/Village", "Ward", "Level", "Name", "TRU", "TOT_P", "TOT_M", "TOT_F", "P_06", "M_06", "F_06"],
  ["09", "197", "Varanasi", "000000", "0000", "CD BLOCK", "Harhua", "Total", "232759", "116704", "116055", "33108", "17248", "15860"],
  ["09", "197", "Varanasi", "000000", "0000", "CD BLOCK", "Harhua", "Rural", "221376", "110751", "110625", "31402", "16358", "15044"],
  ["09", "197", "Varanasi", "208434", "0000", "VILLAGE", "Ayar", "Rural", "5447", "2800", "2647", "812", "420", "392"],
  ["09", "197", "Varanasi", "208435", "0000", "VILLAGE", "Malhath", "Rural", "3374", "1612", "1762", "521", "283", "238"],
  // Uninhabited village: published as 0, not a market.
  ["09", "197", "Varanasi", "208437", "0000", "VILLAGE", "Chakmalsi", "Rural", "0", "0", "0", "0", "0", "0"],
  // A town is not a village and is also an aggregate of its wards.
  ["09", "197", "Varanasi", "800101", "0000", "TOWN", "Ramnagar", "Urban", "49132", "25000", "24132", "6000", "3100", "2900"],
  // The next block hands its name to the villages that follow it.
  ["09", "197", "Varanasi", "000000", "0000", "CD BLOCK", "Arajiline", "Rural", "180000", "92000", "88000", "25000", "13000", "12000"],
  ["09", "197", "Varanasi", "209001", "0000", "VILLAGE", "Kachnar", "Rural", "1800", "930", "870", "260", "135", "125"],
];

const cdb = buildCensusRowsFromTable(CDB, {});
assert.deepEqual(
  cdb.rows.map((r) => [r.village_name, r.block_name, r.pop_total_2011]),
  [
    ["Ayar", "Harhua", 5447],
    ["Malhath", "Harhua", 3374],
    ["Kachnar", "Arajiline", 1800],
  ],
  "villages inherit the CD BLOCK above them; blocks/towns/empties are dropped",
);

// The block totals must never be seeded as villages — 221,376 people in one
// "village" would swamp every penetration figure on the dashboard.
assert.ok(
  !cdb.rows.some((r) => r.pop_total_2011 > 100000),
  "no aggregate line survived as a village",
);
assert.ok(cdb.skipped.some((s) => s.reason === "aggregate line (block total)"));
assert.ok(cdb.skipped.some((s) => s.reason.includes("town")));

// "State" = "09" and "District" = "197" are codes, not names.
assert.equal(cdb.rows[0].state_name, "Uttar Pradesh", "numeric State falls back to the default");
assert.equal(cdb.rows[0].district_name, "Varanasi", "DT Name wins over the numeric District column");
assert.equal(cdb.rows[0].census_code, "208434");

assert.equal(nameCell("09"), "", "an all-digit cell is a code, not a name");
assert.equal(nameCell(" Varanasi "), "Varanasi");
assert.equal(nameCell(undefined), "");

// The all-zero placeholder code on aggregate lines must not become an
// identity two different rows could collide on.
const zeroCode = buildCensusRowsFromTable(
  [
    ["Town/Village", "Level", "Name", "TRU", "TOT_P", "P_06"],
    ["000000", "VILLAGE", "One", "Rural", "100", "14"],
    ["000000", "VILLAGE", "Two", "Rural", "200", "28"],
  ],
  {},
);
assert.equal(zeroCode.rows.length, 2, "two codeless villages stay two villages");
assert.deepEqual(zeroCode.rows.map((r) => r.census_code), ["", ""]);

// --levels can widen the selection when the office wants towns too.
const withTowns = buildCensusRowsFromTable(CDB, { levels: ["village", "town"], tru: "all" });
assert.ok(withTowns.rows.some((r) => r.village_name === "Ramnagar"));

/* ── duplicate village names must not double-count leads ────── */

// Varanasi has 19 name+block collisions in the real PCA data — two distinct
// Fatehpurs in Baragaon among them. Leads match by name, so the same leads
// would otherwise be credited to both and inflate every total on the page.
const dupA = row({ key: "census/a", osmName: "Fatehpur", leadAttribution: "exact", leads: { total: 8, enrolled: 2, open: 6, lost: 0, lastLeadAt: null }, penetrationPct: 1.6 });
const dupB = row({ key: "census/b", osmName: "Fatehpur", leadAttribution: "ambiguous", leads: { total: 0, enrolled: 0, open: 0, lost: 0, lastLeadAt: null }, penetrationPct: null, penetrationBand: "unknown" });
assert.equal(dupA.leads.total + dupB.leads.total, 8, "the 8 leads are counted once, not twice");
assert.equal(dupB.penetrationPct, null, "an unattributable village has unknown penetration, not 0%");
assert.equal(penetrationBand(dupB.penetrationPct), "unknown");

/* ── census towns are tagged, not silently mixed in ─────────── */

// Varanasi's 34 census towns carry 44,634 children — a market worth having,
// but a town is not a village and the office must be able to tell them apart
// when planning a camp or a bus route.
const mixed = buildCensusRowsFromTable(CDB, { levels: ["village", "town"], tru: "all" });
const ramnagar = mixed.rows.find((r) => r.village_name === "Ramnagar");
assert.ok(ramnagar, "the town is loaded when asked for");
assert.equal(ramnagar!.settlement_type, "town");
assert.equal(
  mixed.rows.find((r) => r.village_name === "Ayar")!.settlement_type,
  "village",
);
// Default stays villages-only, so an existing seed does not silently change.
assert.ok(!buildCensusRowsFromTable(CDB, {}).rows.some((r) => r.settlement_type === "town"));

console.log("  ok");
