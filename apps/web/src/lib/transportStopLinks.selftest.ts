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
  planStopRelink,
  suggestStopsForGroup,
} from "./transportStopLinks";
import type { TransportState } from "./transport";
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

console.log("  ok");
