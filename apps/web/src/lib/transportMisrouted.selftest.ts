/**
 * Self-test: riders who are not on their nearest bus.
 * Run: npx tsx apps/web/src/lib/transportMisrouted.selftest.ts
 *
 * The rule that matters: only compare what is actually known. A household
 * without coordinates, or a stop nobody has pinned, is silence — not a reason
 * to move a child onto a different bus.
 */

import assert from "node:assert/strict";

import { findMisroutedRiders } from "./transportPlanner";
import type { StudentTransportProfile } from "./transportPlanner";
import type { TransportAssignment, TransportState } from "./transport";

console.log("transportMisrouted.selftest.ts");

// ~0.01 degrees of latitude is ~1.1 km, which is the scale these fixtures use.
const A1 = { lat: 25.3, lng: 83.0 }; // route A, stop 1
const A2 = { lat: 25.305, lng: 83.002 }; // route A, stop 2
const B1 = { lat: 25.32, lng: 83.05 }; // route B, stop 1

const state = {
  routes: [
    {
      id: "rA",
      code: "RA",
      busNo: "BUS A",
      isActive: true,
      stops: [
        { id: "a1", name: "Ayar Mod", geoLat: A1.lat, geoLng: A1.lng, distanceKm: 4, distanceSource: "google" },
        { id: "a2", name: "Ayar Bazaar", geoLat: A2.lat, geoLng: A2.lng, distanceKm: 5, distanceSource: "google" },
        { id: "a3", name: "Unpinned Stop", distanceKm: 0, distanceSource: "" },
      ],
    },
    {
      id: "rB",
      code: "RB",
      busNo: "BUS B",
      isActive: true,
      stops: [
        { id: "b1", name: "Katari", geoLat: B1.lat, geoLng: B1.lng, distanceKm: 9, distanceSource: "google" },
      ],
    },
  ],
} as unknown as TransportState;

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
  id: string,
  geo: { lat: number; lng: number } | null,
  assignment?: TransportAssignment,
): StudentTransportProfile {
  return {
    studentId: id,
    fullName: id.toUpperCase(),
    admissionNo: `ADM-${id}`,
    classLabel: "IV A",
    classId: "c_iv",
    sectionId: "sec_a",
    sectionLabel: "A",
    householdId: `hh_${id}`,
    addressLine: "",
    locality: "",
    landmark: "",
    pincode: "",
    academicYearCode: "2026-27",
    hasAssignment: Boolean(assignment),
    assignment,
    geoLat: geo?.lat,
    geoLng: geo?.lng,
    hasGeo: !!geo,
  };
}

/* ── the actual case: lives next to BUS B, rides BUS A ──────── */

const nearB = { lat: 25.319, lng: 83.049 };
const flagged = findMisroutedRiders(
  [profile("wrong", nearB, asg("wrong", "rA", "a1"))],
  state,
);
assert.equal(flagged.length, 1);
assert.equal(flagged[0].studentId, "wrong");
assert.equal(flagged[0].currentRouteLabel, "BUS A");
assert.equal(flagged[0].betterRouteLabel, "BUS B");
assert.equal(flagged[0].betterStopName, "Katari");
assert.ok(flagged[0].savingKm > 4, `expected a big saving, got ${flagged[0].savingKm}`);

/* ── correctly placed riders are not flagged ────────────────── */

const nearA = { lat: 25.301, lng: 83.001 };
assert.deepEqual(
  findMisroutedRiders([profile("right", nearA, asg("right", "rA", "a1"))], state),
  [],
);

// A nearer stop on the SAME bus is a stop change, not a wrong vehicle.
const nearA2 = { lat: 25.3049, lng: 83.0019 };
assert.deepEqual(
  findMisroutedRiders([profile("shuffle", nearA2, asg("shuffle", "rA", "a1"))], state),
  [],
);

/* ── silence when the inputs are unknown ────────────────────── */

// No household coordinates → cannot compare, must not guess.
assert.deepEqual(
  findMisroutedRiders([profile("nogeo", null, asg("nogeo", "rA", "a1"))], state),
  [],
);

// Assigned to a stop nobody pinned → nothing to measure from.
assert.deepEqual(
  findMisroutedRiders([profile("unpinned", nearB, asg("unpinned", "rA", "a3"))], state),
  [],
);

// Not a rider at all.
assert.deepEqual(findMisroutedRiders([profile("walker", nearB)], state), []);

// No pinned stops anywhere → the whole check is inert, not a blanket flag.
const bareState = {
  routes: [
    { id: "rA", code: "RA", busNo: "BUS A", isActive: true, stops: [{ id: "a1", name: "Ayar Mod", distanceKm: 0, distanceSource: "" }] },
  ],
} as unknown as TransportState;
assert.deepEqual(
  findMisroutedRiders([profile("x", nearB, asg("x", "rA", "a1"))], bareState),
  [],
);

/* ── threshold ──────────────────────────────────────────────── */

// A saving below the threshold is noise — walking 200 m further is not a
// reason to move a child to another bus.
const marginal = { lat: 25.3095, lng: 83.024 }; // roughly between A1 and B1
const noneAtDefault = findMisroutedRiders(
  [profile("mid", marginal, asg("mid", "rA", "a1"))],
  state,
  { minSavingKm: 99 },
);
assert.deepEqual(noneAtDefault, []);

// Sorted by saving, biggest first.
const many = findMisroutedRiders(
  [
    profile("small", { lat: 25.3105, lng: 83.026 }, asg("small", "rA", "a1")),
    profile("big", nearB, asg("big", "rA", "a1")),
  ],
  state,
  { minSavingKm: 0.2 },
);
assert.ok(many.length >= 1);
for (let i = 1; i < many.length; i += 1) {
  assert.ok(
    many[i - 1].savingKm >= many[i].savingKm,
    "results must be sorted by saving, largest first",
  );
}

console.log("  ok");
