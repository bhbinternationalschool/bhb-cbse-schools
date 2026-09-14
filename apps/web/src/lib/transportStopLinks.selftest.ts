/**
 * Self-test: broken stop links — detection, ranking, repair.
 * Run: npx tsx apps/web/src/lib/transportStopLinks.selftest.ts
 *
 * The fault this guards. On 2026-08-23 all 124 live assignments on five buses
 * pointed at stop ids that no longer existed. Every route was healthy — 47
 * stops, all measured, 46 pinned — but not one rider resolved. The roster
 * responded by reporting a confident ₹0 shortfall for every rider on every
 * bus, and the driver's manifest came up empty, because both are built by
 * looking a stop up by id.
 *
 * Two rules are pinned here:
 *   1. A broken link is DETECTED and named, never absorbed into "no distance".
 *   2. A repair moves the link and NOTHING else — not the fee, not the start
 *      date. Re-deriving a fee from a stop somebody just guessed at would
 *      rewrite what a family is charged on the strength of an inference.
 */

import assert from "node:assert/strict";

import {
  findBrokenStopLinks,
  pickReceiptBackedStop,
  planStopRelink,
  receiptStopNamesForGroup,
  suggestStopsForGroup,
} from "./transportStopLinks";
import { planRouteStops, type TransportState, type TransportStop } from "./transport";
import type { StudentTransportProfile } from "./transportPlanner";

console.log("transportStopLinks.selftest.ts");

const route = {
  id: "r1",
  code: "MAGIC-1",
  name: "Magic 1",
  busNo: "MAGIC 1",
  vehicleReg: "",
  vehicleId: "",
  monthlyFeePaise: 0,
  isActive: true,
  stops: [
    { id: "st_new_a", name: "Ayar Mod", sequence: 1, distanceKm: 4,
      monthlyFeePaise: 50000, geoLat: 25.40, geoLng: 82.99, distanceSource: "google" },
    { id: "st_new_b", name: "Katari Bazar", sequence: 2, distanceKm: 7,
      monthlyFeePaise: 70000, geoLat: 25.45, geoLng: 83.05, distanceSource: "google" },
    { id: "st_new_c", name: "Unpinned Corner", sequence: 3, distanceKm: 0,
      monthlyFeePaise: 0, distanceSource: "" },
  ],
};

function state(assignments: {
  id: string; studentId: string; stopId: string; fee: number; ended?: boolean;
}[]): TransportState {
  return {
    routes: [route],
    vehicles: [],
    assignments: assignments.map((a) => ({
      id: a.id,
      studentId: a.studentId,
      householdId: `hh_${a.studentId}`,
      routeId: "r1",
      stopId: a.stopId,
      academicYearCode: "2026-27",
      effectiveFrom: "2026-04-01",
      effectiveTo: a.ended ? "2026-06-30" : null,
      monthlyFeePaise: a.fee,
      feeOverrideReason: "",
      serviceMode: "both",
      boardingSuspended: false,
      createdAt: "",
    })),
  } as unknown as TransportState;
}

function profiles(rows: { id: string; lat?: number; lng?: number }[]): StudentTransportProfile[] {
  return rows.map((r) => ({
    studentId: r.id,
    fullName: r.id.toUpperCase(),
    householdId: `hh_${r.id}`,
    hasGeo: r.lat != null,
    geoLat: r.lat,
    geoLng: r.lng,
  })) as unknown as StudentTransportProfile[];
}

/* ── detection ──────────────────────────────────────────────── */

const s1 = state([
  { id: "a1", studentId: "s1", stopId: "st_GONE", fee: 50000 },
  { id: "a2", studentId: "s2", stopId: "st_GONE", fee: 50000 },
  { id: "a3", studentId: "s3", stopId: "st_OTHER", fee: 70000 },
  { id: "a4", studentId: "s4", stopId: "st_new_a", fee: 50000 },
]);
const p1 = profiles([
  { id: "s1", lat: 25.401, lng: 82.991 },
  { id: "s2", lat: 25.399, lng: 82.989 },
  { id: "s3", lat: 25.451, lng: 83.051 },
  { id: "s4" },
]);

const rep = findBrokenStopLinks(s1, p1);
assert.equal(rep.ridersAffected, 3, "three riders orphaned");
assert.equal(rep.ridersHealthy, 1, "the one good link is counted as healthy");
assert.equal(rep.groups.length, 2, "two distinct orphan ids -> two groups");

const gone = rep.groups.find((g) => g.orphanStopId === "st_GONE")!;
assert.equal(gone.riderCount, 2, "riders sharing an orphan id stay together");
assert.deepEqual(gone.feesPaise, [50000], "their common fee is evidence and is kept");
assert.equal(gone.geoCount, 2);
assert.ok(gone.centroid, "a centroid exists when households are pinned");

// An ended assignment pointing at a dead stop is history, not a repair job.
const withEnded = findBrokenStopLinks(
  state([
    { id: "a9", studentId: "s9", stopId: "st_GONE", fee: 50000, ended: true },
  ]),
  profiles([{ id: "s9" }]),
);
assert.equal(withEnded.ridersAffected, 0, "ended assignments are not listed");

// No pins at all still produces a group — just an unranked one.
const noPins = findBrokenStopLinks(
  state([{ id: "b1", studentId: "x1", stopId: "st_GONE", fee: 50000 }]),
  profiles([{ id: "x1" }]),
);
assert.equal(noPins.groups[0].centroid, null, "no pins -> no centroid, not 0,0");
assert.equal(noPins.groups[0].geoCount, 0);

/* ── ranking ────────────────────────────────────────────────── */

const cands = suggestStopsForGroup(gone, route as never);
assert.equal(cands.length, 3, "every stop is offered, including unmeasured ones");
assert.equal(cands[0].stop.id, "st_new_a", "nearest + price match wins");
assert.equal(cands[0].feeMatches, true);
assert.ok(/km from where these families live/.test(cands[0].reason));

// The unpinned stop is last, and says why rather than showing a fake distance.
const unpinned = cands.find((c) => c.stop.id === "st_new_c")!;
assert.equal(unpinned.distanceKm, null, "unpinned stop has no distance, not 0");
assert.ok(/not pinned/.test(unpinned.reason));
assert.equal(cands[cands.length - 1].stop.id, "st_new_c", "unranked sinks");

// A group with no pins ranks on price alone and never invents a distance.
const blindCands = suggestStopsForGroup(noPins.groups[0], route as never);
assert.equal(blindCands[0].stop.id, "st_new_a", "price match still leads");
assert.equal(blindCands[0].distanceKm, null, "no centroid -> no distance claimed");

/* ── the group's fee list is a union, not a guess ───────────── */

const mixed = findBrokenStopLinks(
  state([
    { id: "m1", studentId: "m1", stopId: "st_GONE", fee: 50000 },
    { id: "m2", studentId: "m2", stopId: "st_GONE", fee: 70000 },
    { id: "m3", studentId: "m3", stopId: "st_GONE", fee: 0 },
  ]),
  profiles([{ id: "m1" }, { id: "m2" }, { id: "m3" }]),
);
assert.deepEqual(
  mixed.groups[0].feesPaise,
  [50000, 70000],
  "distinct non-zero fees, ascending; a nil fee is not reported as ₹0 paid",
);
assert.equal(mixed.groups[0].riderCount, 3, "the nil-fee rider is still in the group");

/* ── THE repair invariant: move the link, touch nothing else ── */

const before = state([
  { id: "r1a", studentId: "s1", stopId: "st_GONE", fee: 50000 },
  { id: "r1b", studentId: "s2", stopId: "st_GONE", fee: 70000 },
  { id: "r1c", studentId: "s3", stopId: "st_new_a", fee: 50000 },
  { id: "r1d", studentId: "s4", stopId: "st_GONE", fee: 50000, ended: true },
]);
const planned = planStopRelink(before, {
  routeId: "r1",
  orphanStopId: "st_GONE",
  toStopId: "st_new_b",
});
assert.equal(planned.ok, true);
if (!planned.ok) throw new Error("unreachable");
assert.equal(planned.relinked, 2, "only the two LIVE orphans move");

const after = new Map(planned.assignments.map((a) => [a.id, a]));

// The whole point: the fee a family is charged is not rewritten because
// somebody picked a stop for them.
assert.equal(after.get("r1a")!.stopId, "st_new_b");
assert.equal(after.get("r1a")!.monthlyFeePaise, 50000, "fee untouched");
assert.equal(after.get("r1b")!.monthlyFeePaise, 70000, "differing fee also untouched");

// And nobody starts riding today because of a clerical fix.
assert.equal(after.get("r1a")!.effectiveFrom, "2026-04-01", "start date untouched");
assert.equal(after.get("r1a")!.effectiveTo, null);

// Untouched rows really are untouched.
assert.equal(after.get("r1c")!.stopId, "st_new_a", "a healthy rider is left alone");
assert.equal(after.get("r1d")!.stopId, "st_GONE", "an ended assignment is not rewritten");
assert.equal(after.get("r1d")!.effectiveTo, "2026-06-30");

/* ── a repair cannot invent a destination ───────────────────── */

const bogus = planStopRelink(before, {
  routeId: "r1",
  orphanStopId: "st_GONE",
  toStopId: "st_does_not_exist",
});
assert.equal(bogus.ok, false, "cannot relink to a stop that is not on the route");

const noMatch = planStopRelink(before, {
  routeId: "r1",
  orphanStopId: "st_NOTHING_HERE",
  toStopId: "st_new_a",
});
assert.equal(noMatch.ok, false, "an empty repair reports failure, not silent success");

/* ── partial repair, when one family stands elsewhere ───────── */

const partial = planStopRelink(before, {
  routeId: "r1",
  orphanStopId: "st_GONE",
  toStopId: "st_new_a",
  studentIds: ["s1"],
});
assert.equal(partial.ok, true);
if (!partial.ok) throw new Error("unreachable");
assert.equal(partial.relinked, 1);
const pa = new Map(partial.assignments.map((a) => [a.id, a]));
assert.equal(pa.get("r1a")!.stopId, "st_new_a");
assert.equal(pa.get("r1b")!.stopId, "st_GONE", "the rest of the group stays put");

/* ── receipts are the strongest evidence ────────────────────── */
//
// 14 Sep 2026: 171 of 182 riders orphaned again. Every receipt ever issued
// for a transport due carries the stop NAME, so for 44 of 46 groups the
// receipts named exactly one current stop. The panel had ranked by map pins
// and price only — and the stops on five of six routes carry no price.

const receipts = [
  { lines: [{ transport: { assignmentId: "a1", stopName: "Katari Bazar" } }] },
  { lines: [{ transport: { assignmentId: "a2", stopName: "katari  bazar" } }] },
  // Another child's receipt — not this group's, must not count.
  { lines: [{ transport: { assignmentId: "a3", stopName: "Ayar Mod" } }] },
  // A receipt line that is not transport at all.
  { lines: [{ transport: null }, {}] },
];
const evidence = receiptStopNamesForGroup(gone, receipts);
assert.equal(evidence.get("katari bazar"), 2, "names are matched loosely and counted");
assert.equal(evidence.get("ayar mod"), undefined, "another rider's receipt is not evidence for this group");

const ranked = suggestStopsForGroup(gone, route as never, { receiptStopNames: evidence });
assert.equal(ranked[0].stop.id, "st_new_b", "the stop the receipts name outranks the nearer, price-matching one");
assert.equal(ranked[0].receiptCount, 2);
assert.ok(/named on 2 fee receipt lines/.test(ranked[0].reason), "and the screen says why");
assert.equal(pickReceiptBackedStop(ranked), "st_new_b", "one place named -> pre-selected");

// No receipt names a stop on this route: nothing is pre-selected.
assert.equal(pickReceiptBackedStop(suggestStopsForGroup(gone, route as never)), null);

// Receipts naming two different places is a disagreement, not a tie.
const split = suggestStopsForGroup(gone, route as never, {
  receiptStopNames: new Map([["katari bazar", 1], ["ayar mod", 1]]),
});
assert.equal(pickReceiptBackedStop(split), null, "two places -> a person decides");

// The same place entered twice (same Google place id) is one place: the
// earlier one in sequence is chosen.
const dupRoute = {
  ...route,
  stops: [
    { id: "st_dup_1", name: "Puari Khurd", sequence: 10, distanceKm: 1.6, placeId: "P1", distanceSource: "google" },
    { id: "st_dup_2", name: "Puari Khurd", sequence: 11, distanceKm: 1.6, placeId: "P1", distanceSource: "google" },
  ],
};
const dupPick = pickReceiptBackedStop(
  suggestStopsForGroup(gone, dupRoute as never, {
    receiptStopNames: new Map([["puari khurd", 24]]),
  }),
);
assert.equal(dupPick, "st_dup_1", "a duplicated stop is one place; the first in sequence is chosen");

/* ── THE ROOT CAUSE: saving a route must keep its stop ids ──── */
//
// setRouteStops minted a new id for every row on every save, so adding one
// stop — or fixing one spelling — orphaned every rider on the route. Twice.

const existing: TransportStop[] = [
  { id: "st_a", name: "Ayar Mod", sequence: 1, distanceKm: 4, placeId: "PA", distanceSource: "google" },
  { id: "st_b", name: "Katari Bazar", sequence: 2, distanceKm: 7, placeId: "PB", distanceSource: "google" },
  { id: "st_c", name: "Unpinned Corner", sequence: 3, distanceKm: 0, distanceSource: "" },
];

// Re-saving the same list, as the editor does, changes nothing.
const same = planRouteStops(existing, existing.map((s) => ({ ...s })));
assert.deepEqual(same.map((s) => s.id), ["st_a", "st_b", "st_c"], "an unchanged list keeps every id");

// Adding a stop in the middle keeps the others and mints one id.
const added = planRouteStops(existing, [
  { id: "st_a", name: "Ayar Mod", placeId: "PA" },
  { name: "New Chowk" },
  { id: "st_b", name: "Katari Bazar", placeId: "PB" },
  { id: "st_c", name: "Unpinned Corner" },
]);
assert.deepEqual(added.map((s) => s.id).filter((id) => id.startsWith("st_") && ["st_a","st_b","st_c"].includes(id)), ["st_a", "st_b", "st_c"]);
assert.equal(added.length, 4);
assert.ok(!["st_a", "st_b", "st_c"].includes(added[1].id), "only the new row gets a new id");
assert.equal(added[1].sequence, 2, "sequence follows the new order");
assert.equal(added[2].sequence, 3);

// Rows without ids (an older editor, the CSV path) still keep ids by place, then by name.
const byPlaceAndName = planRouteStops(existing, [
  { name: "AYAR MOD (renamed)", placeId: "PA" },
  { name: "  katari bazar " },
  { name: "Unpinned Corner" },
]);
assert.deepEqual(byPlaceAndName.map((s) => s.id), ["st_a", "st_b", "st_c"], "place id, then loose name, recover the ids");
assert.equal(byPlaceAndName[0].name, "AYAR MOD (renamed)", "the rename is kept — only the id is preserved");

// Two rows with one name claim two existing ids in order, never the same one.
const twice: TransportStop[] = [
  { id: "st_x1", name: "Mahadepur", sequence: 1, distanceKm: 1, distanceSource: "" },
  { id: "st_x2", name: "Mahadepur", sequence: 2, distanceKm: 1, distanceSource: "" },
];
const claimed = planRouteStops(twice, [{ name: "Mahadepur" }, { name: "Mahadepur" }]);
assert.deepEqual(claimed.map((s) => s.id), ["st_x1", "st_x2"]);

// Removing the SECOND duplicate keeps the first id — the one riders were relinked to.
const dedup = planRouteStops(twice, [{ name: "Mahadepur" }]);
assert.deepEqual(dedup.map((s) => s.id), ["st_x1"]);

// A row that names its stop wins over a later row that merely shares its old name.
const renamedFirst = planRouteStops(existing, [
  { name: "Ayar Mod" },              // a NEW row typed with the old name
  { id: "st_a", name: "Ayar Tiraha", placeId: "PA" }, // the real stop, renamed
]);
assert.equal(renamedFirst[1].id, "st_a", "the row that says which stop it is keeps that id");
assert.notEqual(renamedFirst[0].id, "st_a", "and the impostor gets a fresh one");

// Blank rows are dropped, as before.
assert.equal(planRouteStops(existing, [{ name: "  " }, { id: "st_c", name: "Unpinned Corner" }]).length, 1);

console.log("  ok");
