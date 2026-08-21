/**
 * Self-test: stop distance provenance and the fee it drives.
 * Run: npx tsx apps/web/src/lib/transportStopDistance.selftest.ts
 *
 * The rule under test: a stop distance is billable only when somebody or
 * something established it. "No distance" must never be laundered into
 * "0 km", and a hand-typed figure must never be labelled as a Google
 * road measurement.
 */

import assert from "node:assert/strict";

import {
  expectedMonthlyFeePaise,
  normalizeStop,
  stopHasGeo,
  type TransportFeePolicy,
  type TransportRoute,
  type TransportStop,
} from "./transport";

console.log("transportStopDistance.selftest.ts");

/* ── provenance ─────────────────────────────────────────────── */

// A legacy stop with a typed km and no provenance is `manual`, never `google`.
assert.equal(normalizeStop({ name: "Lanka", distanceKm: 4 }, 0).distanceSource, "manual");

// No distance at all stays unsourced — it is not zero kilometres.
const blank = normalizeStop({ name: "Ayar" }, 0);
assert.equal(blank.distanceSource, "");
assert.equal(blank.distanceKm, 0);

// An explicit source is preserved.
assert.equal(
  normalizeStop({ name: "Katari", distanceKm: 7.2, distanceSource: "google" }, 0)
    .distanceSource,
  "google",
);

// Anything else in the field is not trusted — it is re-inferred, not passed on.
assert.equal(
  normalizeStop(
    { name: "X", distanceKm: 3, distanceSource: "psychic" as never },
    0,
  ).distanceSource,
  "manual",
);

// Negative / junk distances collapse to 0 and therefore to unsourced.
assert.equal(normalizeStop({ name: "X", distanceKm: -5 }, 0).distanceKm, 0);
assert.equal(normalizeStop({ name: "X", distanceKm: -5 }, 0).distanceSource, "");
assert.equal(
  normalizeStop({ name: "X", distanceKm: Number.NaN }, 0).distanceSource,
  "",
);

/* ── coordinates ────────────────────────────────────────────── */

assert.equal(stopHasGeo(normalizeStop({ name: "X" }, 0)), false);
assert.equal(
  stopHasGeo(normalizeStop({ name: "X", geoLat: 25.28, geoLng: 82.99 }, 0)),
  true,
);
// 0,0 is the Atlantic, not Varanasi — treat it as absent.
assert.equal(
  stopHasGeo(normalizeStop({ name: "X", geoLat: 0, geoLng: 0 }, 0)),
  false,
);
// Half a coordinate is no coordinate.
assert.equal(
  stopHasGeo(normalizeStop({ name: "X", geoLat: 25.28 }, 0)),
  false,
);
// Absent geo does not leave stray keys behind.
assert.equal("geoLat" in normalizeStop({ name: "X" }, 0), false);

/* ── the fee that rides on it ───────────────────────────────── */

const route = {
  id: "r1",
  monthlyFeePaise: 60000,
  stops: [],
} as unknown as TransportRoute;

const slabPolicy: TransportFeePolicy = {
  academicYearCode: "2026-27",
  rateMode: "slab",
  ratePerKmPaise: 10000,
  minFeePaise: 50000,
  maxFeePaise: null,
  slabs: [
    { id: "s1", upToKm: 5, monthlyFeePaise: 50000 },
    { id: "s2", upToKm: 99, monthlyFeePaise: 90000 },
  ],
  repairApprovalPaise: 0,
};

const near = normalizeStop(
  { name: "Near", distanceKm: 3, distanceSource: "google" },
  0,
) as TransportStop;
const far = normalizeStop(
  { name: "Far", distanceKm: 12, distanceSource: "google" },
  1,
) as TransportStop;

assert.equal(expectedMonthlyFeePaise(route, near, slabPolicy), 50000);
assert.equal(expectedMonthlyFeePaise(route, far, slabPolicy), 90000);

// An unmeasured stop falls to the minimum, not to zero — a rider is never free
// just because nobody has measured their stop yet.
const unmeasured = normalizeStop({ name: "Unknown" }, 2) as TransportStop;
assert.equal(expectedMonthlyFeePaise(route, unmeasured, slabPolicy), 50000);

// Per-km respects the floor for a very near stop.
const perKm: TransportFeePolicy = { ...slabPolicy, rateMode: "per_km" };
assert.equal(expectedMonthlyFeePaise(route, near, perKm), 50000); // 3 km × ₹100 = ₹300 → floor ₹500
assert.equal(expectedMonthlyFeePaise(route, far, perKm), 120000); // 12 km × ₹100

// Flat-route ignores distance entirely — this is the mode that made stop
// distances look pointless, and is why they were never filled in.
const flat: TransportFeePolicy = { ...slabPolicy, rateMode: "flat_route" };
assert.equal(expectedMonthlyFeePaise(route, far, flat), 60000);

console.log("  ok");
