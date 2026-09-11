/**
 * Self-test: the boarding-point audit.
 * Run: npx tsx apps/web/src/lib/boardingPointAudit.selftest.ts
 *
 * Shapes taken from the real fleet on 11 Sep 2026, including the two cases
 * that made the first run of this audit wrong or misleading: a student
 * carrying superseded assignment rows alongside the live one, and a village
 * centroid being mistaken for a house.
 */

import assert from "node:assert/strict";

import {
  auditBoardingPoints,
  clusterByAssignedStop,
  type BoardingHome,
} from "./boardingPointAudit";
import type { TransportState } from "./transport";

console.log("boardingPointAudit.selftest.ts");

const AY = "2026-27";

// MAGIC-1, roughly as it runs. Ekala is sequence 1 — first in the picker.
const stop = (id: string, name: string, lat: number, lng: number, km: number) => ({
  id, name, sequence: 1, geoLat: lat, geoLng: lng, distanceKm: km, distanceSource: "maps",
});

const state = {
  feePolicy: { bands: [{ upToKm: 5 }, { upToKm: 8 }] },
  routes: [
    {
      id: "r1", code: "MAGIC-1", busNo: "", isActive: true,
      stops: [
        stop("s_ekala", "9XX9+VG Ekala", 25.3996, 82.9688, 5.4),
        stop("s_kakalpur", "Kakalpur", 25.4290, 82.9490, 4.1),
        stop("s_ayar", "Ayar Bazar", 25.4230, 82.9370, 3.0),
        stop("s_unpinned", "Not pinned yet", NaN, NaN, 2.0),
      ],
    },
    { id: "r2", code: "WINGER", busNo: "", isActive: true, stops: [] },
  ],
  assignments: [],
  vehicles: [],
} as unknown as TransportState;

const homes = new Map<string, BoardingHome>([
  ["hh_kakalpur", { lat: 25.4289, lng: 82.9487, label: "Kakalpur", precision: "village" }],
  ["hh_ayar", { lat: 25.4228, lng: 82.9368, label: "Ayar", precision: "village" }],
  ["hh_next_door", { lat: 25.3997, lng: 82.9689, label: "Ekala", precision: "village" }],
]);

const asg = (o: Record<string, unknown>) => ({
  id: "a", studentId: "stu", householdId: "hh", routeId: "r1", stopId: "s_ekala",
  academicYearCode: AY, effectiveFrom: "2026-05-01", effectiveTo: null,
  monthlyFeePaise: 0, feeOverrideReason: "", boardingSuspended: false, ...o,
});

const run = (assignments: unknown[], min?: number) =>
  auditBoardingPoints({
    state: { ...state, assignments } as unknown as TransportState,
    homes,
    nameOf: (id) => `Name ${id}`,
    academicYearCode: AY,
    minGapKm: min,
  });

/* ── the case findMisroutedRiders throws away ───────────────── */

const sameRoute = run([asg({ studentId: "s1", householdId: "hh_kakalpur" })]);
assert.equal(sameRoute.flags.length, 1, "wrong stop on the RIGHT bus is the point of this audit");
assert.equal(sameRoute.flags[0]!.assignedStopName, "9XX9+VG Ekala");
assert.equal(sameRoute.flags[0]!.nearestStopName, "Kakalpur");
assert.ok(sameRoute.flags[0]!.gapKm > 3, `gap should be ~3.4: ${sameRoute.flags[0]!.gapKm}`);
assert.equal(sameRoute.checked, 1);

/* ── superseded rows must not invent a gap ──────────────────── */

// Exactly the shape that produced a phantom 7.4 km error on the first run:
// one live row and two expired ones for the same child.
const withHistory = run([
  asg({ studentId: "s1", householdId: "hh_kakalpur", stopId: "s_kakalpur" }),
  asg({ studentId: "s1", householdId: "hh_kakalpur", stopId: "s_ekala", effectiveTo: "2026-08-29" }),
  asg({ studentId: "s1", householdId: "hh_kakalpur", stopId: "s_ayar", effectiveTo: "2026-08-22" }),
]);
assert.equal(withHistory.checked, 1, "only the live row is judged");
assert.equal(withHistory.flags.length, 0, "the live assignment is correct, so nothing is flagged");

/* ── a closed year is not this year's problem ───────────────── */

assert.equal(
  run([asg({ studentId: "s1", householdId: "hh_kakalpur", academicYearCode: "2025-26" })]).checked,
  0,
);

// A suspended rider is not boarding anywhere, so there is nothing to correct.
assert.equal(
  run([asg({ studentId: "s1", householdId: "hh_kakalpur", boardingSuspended: true })]).checked,
  0,
);

/* ── centroid noise is not a finding ────────────────────────── */

// This family lives beside the stop they are assigned to. Nothing to say.
assert.equal(run([asg({ studentId: "s2", householdId: "hh_next_door" })]).flags.length, 0);

// And the threshold is honoured rather than hard-coded.
assert.equal(run([asg({ studentId: "s1", householdId: "hh_kakalpur" })], 99).flags.length, 0);

/* ── what cannot be judged is counted, never dropped ────────── */

const noHome = run([asg({ studentId: "s3", householdId: "hh_unknown" })]);
assert.equal(noHome.checked, 0);
assert.equal(noHome.skipped.noHome, 1, "an unmatched household is reported, not ignored");

const unpinned = run([asg({ studentId: "s4", householdId: "hh_kakalpur", stopId: "s_unpinned" })]);
assert.equal(unpinned.checked, 0);
assert.equal(unpinned.skipped.assignedStopUnpinned, 1);
assert.equal(unpinned.flags.length, 0, "an unpinned stop is unknown, not correct");

const noStops = run([asg({ studentId: "s5", householdId: "hh_kakalpur", routeId: "r2" })]);
assert.equal(noStops.skipped.noPinnedStopsOnRoute, 1);

/* ── the fee consequence is stated, or admitted as unknown ──── */

// Ekala is 5.4 km from school (band 2), Kakalpur 4.1 km (band 1) — correcting
// this moves the child across a band, so the bill changes.
assert.equal(sameRoute.flags[0]!.feeChanges, true);

// Ayar 3.0 and Kakalpur 4.1 are both inside the first band.
const sameBand = auditBoardingPoints({
  state: {
    ...state,
    assignments: [asg({ studentId: "s6", householdId: "hh_ayar", stopId: "s_kakalpur" })],
  } as unknown as TransportState,
  homes, nameOf: () => "x", academicYearCode: AY,
});
assert.equal(sameBand.flags[0]!.feeChanges, false, "a move inside one band does not change the bill");

// With no bands configured the fee effect is unknown — and says so rather
// than reporting "no change", which would read as "safe to correct".
const noBands = auditBoardingPoints({
  state: {
    ...state,
    feePolicy: { bands: [] },
    assignments: [asg({ studentId: "s1", householdId: "hh_kakalpur" })],
  } as unknown as TransportState,
  homes, nameOf: () => "x", academicYearCode: AY,
});
assert.equal(noBands.flags[0]!.feeChanges, null);

/* ── a bad default shows up as a cluster, not fifty rows ────── */

const cluster = clusterByAssignedStop(
  run([
    asg({ studentId: "s1", householdId: "hh_kakalpur" }),
    asg({ studentId: "s2", householdId: "hh_ayar" }),
  ]).flags,
);
assert.equal(cluster.length, 1);
assert.equal(cluster[0]!.stopName, "9XX9+VG Ekala");
assert.equal(cluster[0]!.riders, 2);
assert.deepEqual(cluster[0]!.villages, ["Ayar", "Kakalpur"]);

// One village on one odd stop is a decision, not a picker problem.
assert.equal(
  clusterByAssignedStop(run([asg({ studentId: "s1", householdId: "hh_kakalpur" })]).flags).length,
  0,
);

console.log("  ok");
