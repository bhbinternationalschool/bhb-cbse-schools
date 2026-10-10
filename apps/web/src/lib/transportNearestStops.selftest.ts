/**
 * Self-test: ranking mapped stops by how near they are to a point.
 * Run: npx tsx apps/web/src/lib/transportNearestStops.selftest.ts
 *
 * The rule: an unpinned stop is not "far away". Its distance is unknown, so it
 * never appears in the ranked list at any position — it comes back separately.
 */

import assert from "node:assert/strict";

import { rankStopsNearPoint } from "./transportPlanner";
import type { TransportState } from "./transport";

console.log("transportNearestStops.selftest.ts");

// ~0.01 degrees of latitude is ~1.1 km at this latitude.
const HOME = { lat: 25.3, lng: 83.0 };

const state = {
  feePolicy: {
    academicYearCode: "2026-27",
    rateMode: "flat_route",
    ratePerKmPaise: 0,
    minFeePaise: 0,
    maxFeePaise: null,
    slabs: [],
    bands: [],
    formula: { basePaise: 0, baseCoversKm: 0, perKmPaise: 0 },
    repairApprovalPaise: 0,
  },
  vehicles: [],
  assignments: [],
  routes: [
    {
      id: "rA",
      code: "RA",
      name: "Ayar",
      busNo: "BUS A",
      vehicleReg: "",
      vehicleId: "",
      monthlyFeePaise: 50000,
      isActive: true,
      stops: [
        // ~0.6 km from HOME
        { id: "near", name: "Near Stop", sequence: 1, distanceKm: 4, distanceSource: "google", geoLat: 25.305, geoLng: 83.001 },
        // ~5.5 km from HOME
        { id: "far", name: "Far Stop", sequence: 2, distanceKm: 9, distanceSource: "google", geoLat: 25.35, geoLng: 83.02 },
        // no coordinates at all
        { id: "blank", name: "Unpinned Stop", sequence: 3, distanceKm: 0, distanceSource: "" },
      ],
    },
    {
      id: "rB",
      code: "RB",
      name: "Katari",
      busNo: "BUS B",
      vehicleReg: "",
      vehicleId: "",
      monthlyFeePaise: 70000,
      isActive: true,
      stops: [
        // ~2.2 km from HOME — between the two on route A
        { id: "mid", name: "Mid Stop", sequence: 1, distanceKm: 6, distanceSource: "google", geoLat: 25.32, geoLng: 83.0 },
      ],
    },
    {
      id: "rDead",
      code: "RD",
      name: "Retired",
      busNo: "BUS D",
      vehicleReg: "",
      vehicleId: "",
      monthlyFeePaise: 0,
      isActive: false,
      stops: [
        { id: "dead", name: "Retired Stop", sequence: 1, distanceKm: 1, distanceSource: "google", geoLat: 25.3005, geoLng: 83.0005 },
      ],
    },
  ],
} as unknown as TransportState;

/* ── nearest first, across every active route ───────────────── */

const all = rankStopsNearPoint(state, HOME);
assert.deepEqual(
  all.ranked.map((r) => r.stopName),
  ["Near Stop", "Mid Stop", "Far Stop"],
  "ordered by distance from the point, not grouped by route",
);
assert.equal(all.ranked[0].routeLabel, "BUS A");
assert.equal(all.ranked[1].routeLabel, "BUS B");
assert.ok(all.ranked[0].fromPointKm < 1);
assert.ok(all.ranked[2].fromPointKm > 4);

// Distance from school stays separate from distance from the point — one bills,
// the other is the walk.
assert.equal(all.ranked[0].distanceFromSchoolKm, 4);
assert.equal(all.ranked[2].distanceFromSchoolKm, 9);

/* ── THE rule: unpinned is unknown, never ranked ────────────── */

assert.equal(
  all.ranked.some((r) => r.stopId === "blank"),
  false,
  "an unpinned stop must not appear in the ranked list at any position",
);
assert.deepEqual(
  all.unpinned.map((u) => u.stopName),
  ["Unpinned Stop"],
);

/* ── inactive routes are excluded entirely ──────────────────── */

assert.equal(
  all.ranked.some((r) => r.routeId === "rDead"),
  false,
  "a retired route's stop is nearest of all, and still must not be offered",
);
assert.equal(all.unpinned.some((u) => u.routeId === "rDead"), false);

/* ── radius and limit ───────────────────────────────────────── */

const within = rankStopsNearPoint(state, HOME, { withinKm: 3 });
assert.deepEqual(within.ranked.map((r) => r.stopName), ["Near Stop", "Mid Stop"]);
// Filtering by radius must not swallow the unpinned list — those are still
// stops somebody needs to go and pin.
assert.equal(within.unpinned.length, 1);

const capped = rankStopsNearPoint(state, HOME, { limit: 1 });
assert.deepEqual(capped.ranked.map((r) => r.stopName), ["Near Stop"]);

/* ── ranking from somewhere else entirely ───────────────────── */

// Searching from near the far stop flips the order — this is what typing a
// village name does.
const fromFar = rankStopsNearPoint(state, { lat: 25.35, lng: 83.02 });
assert.equal(fromFar.ranked[0].stopName, "Far Stop");

/* ── no stops at all is empty, not an error ─────────────────── */

const bare = rankStopsNearPoint(
  { ...state, routes: [] } as unknown as TransportState,
  HOME,
);
assert.deepEqual(bare.ranked, []);
assert.deepEqual(bare.unpinned, []);

console.log("  ok");
