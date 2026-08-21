/**
 * Self-test: households split between riding and not riding.
 * Run: npx tsx apps/web/src/lib/transportSiblingGaps.selftest.ts
 */

import assert from "node:assert/strict";

import { findSiblingTransportGaps } from "./transportPlanner";
import type { StudentTransportProfile } from "./transportPlanner";
import type { TransportAssignment, TransportState } from "./transport";

console.log("transportSiblingGaps.selftest.ts");

function asg(studentId: string, routeId: string, stopId: string) {
  return {
    id: `a_${studentId}`,
    studentId,
    householdId: "",
    routeId,
    stopId,
    academicYearCode: "2026-27",
    effectiveFrom: "2026-04-01",
    effectiveTo: null,
    monthlyFeePaise: 50000,
    feeOverrideReason: "",
    boardingSuspended: false,
    createdAt: "2026-04-01T00:00:00.000Z",
  } as TransportAssignment;
}

function profile(
  studentId: string,
  householdId: string,
  assignment?: TransportAssignment,
): StudentTransportProfile {
  return {
    studentId,
    fullName: studentId.toUpperCase(),
    admissionNo: `ADM-${studentId}`,
    classLabel: "IV A",
    householdId,
    addressLine: "",
    locality: "",
    landmark: "",
    pincode: "",
    academicYearCode: "2026-27",
    hasAssignment: Boolean(assignment),
    assignment,
    hasGeo: false,
  };
}

const state = {
  routes: [
    {
      id: "r1",
      code: "R1",
      busNo: "BUS 1",
      stops: [{ id: "s1", name: "Ayar Mod" }],
    },
    {
      id: "r2",
      code: "R2",
      busNo: "BUS 2",
      stops: [{ id: "s2", name: "Katari" }],
    },
  ],
} as unknown as TransportState;

// A household where every child rides is not a gap.
assert.deepEqual(
  findSiblingTransportGaps(
    [profile("a", "h1", asg("a", "r1", "s1")), profile("b", "h1", asg("b", "r1", "s1"))],
    state,
  ),
  [],
);

// Nor is a household where nobody rides — there is nothing to prompt about.
assert.deepEqual(
  findSiblingTransportGaps([profile("a", "h1"), profile("b", "h1")], state),
  [],
);

// An only child is never a "sibling" gap, however they travel.
assert.deepEqual(
  findSiblingTransportGaps([profile("a", "h1", asg("a", "r1", "s1"))], state),
  [],
);

// One riding, one not — the actual case, with both sides named.
const gaps = findSiblingTransportGaps(
  [profile("a", "h1", asg("a", "r1", "s1")), profile("b", "h1")],
  state,
  new Map([["h1", "RAKESH KUMAR"]]),
);
assert.equal(gaps.length, 1);
assert.equal(gaps[0].householdLabel, "RAKESH KUMAR");
assert.deepEqual(gaps[0].riders.map((r) => r.fullName), ["A"]);
assert.deepEqual(gaps[0].nonRiders.map((r) => r.fullName), ["B"]);
assert.equal(gaps[0].riders[0].routeLabel, "BUS 1 · Ayar Mod");
assert.equal(gaps[0].splitAcrossRoutes, false);

// Missing label stays empty rather than inventing a family name.
const unlabelled = findSiblingTransportGaps(
  [profile("a", "h1", asg("a", "r1", "s1")), profile("b", "h1")],
  state,
);
assert.equal(unlabelled[0].householdLabel, "");

// Siblings on different buses is flagged, and sorts above plain gaps.
const mixed = findSiblingTransportGaps(
  [
    // h2: two riders on different routes, one non-rider.
    profile("c", "h2", asg("c", "r1", "s1")),
    profile("d", "h2", asg("d", "r2", "s2")),
    profile("e", "h2"),
    // h1: a bigger plain gap — two children left off the bus.
    profile("a", "h1", asg("a", "r1", "s1")),
    profile("b", "h1"),
    profile("f", "h1"),
  ],
  state,
);
assert.equal(mixed.length, 2);
assert.equal(mixed[0].householdId, "h2", "split family sorts first");
assert.equal(mixed[0].splitAcrossRoutes, true);
assert.equal(mixed[1].householdId, "h1");
assert.equal(mixed[1].splitAcrossRoutes, false);
assert.equal(mixed[1].nonRiders.length, 2);

// Students with no household are skipped, not grouped together under "".
assert.deepEqual(
  findSiblingTransportGaps(
    [profile("a", "", asg("a", "r1", "s1")), profile("b", "")],
    state,
  ),
  [],
);

console.log("  ok");
