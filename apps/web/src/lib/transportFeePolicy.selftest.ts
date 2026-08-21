/**
 * Self-test: the 2026-27 transport pricing rule.
 * Run: npx tsx apps/web/src/lib/transportFeePolicy.selftest.ts
 *
 * The rule, as the school states it:
 *   up to 5 km  — stop-priced, ₹300–500
 *   5 to 8 km   — stop-priced, ₹700–800
 *   above 8 km  — ₹500 covering the first 5 km, then ₹100 per started km
 *
 * The thing this file exists to protect: a stop nobody has measured or priced
 * yields `ok: false`, never a plausible-looking number. A transport fee that
 * quietly defaults is a wrong invoice nobody notices.
 */

import assert from "node:assert/strict";

import {
  expectedMonthlyFeeDetail,
  expectedMonthlyFeePaise,
  normalizeStop,
  type TransportFeePolicy,
  type TransportRoute,
  type TransportStop,
} from "./transport";

console.log("transportFeePolicy.selftest.ts");

const policy: TransportFeePolicy = {
  academicYearCode: "2026-27",
  rateMode: "band_then_formula",
  ratePerKmPaise: 10000,
  minFeePaise: 0,
  maxFeePaise: null,
  slabs: [],
  bands: [
    { id: "b1", upToKm: 5, minPaise: 30000, maxPaise: 50000 },
    { id: "b2", upToKm: 8, minPaise: 70000, maxPaise: 80000 },
  ],
  formula: { basePaise: 50000, baseCoversKm: 5, perKmPaise: 10000 },
  repairApprovalPaise: 0,
};

const route = { id: "r1", monthlyFeePaise: 60000, stops: [] } as unknown as TransportRoute;

function stop(km: number, feePaise?: number, name = `${km}km`): TransportStop {
  return normalizeStop(
    { name, distanceKm: km, distanceSource: "google", monthlyFeePaise: feePaise },
    0,
  );
}

/* ── band 1: stop-priced, ₹300–500 ──────────────────────────── */

const near = expectedMonthlyFeeDetail(route, stop(3, 40000), policy);
assert.equal(near.ok, true);
assert.equal(near.paise, 40000, "the stop's own price is used, not a band edge");
assert.equal(near.basis, "stop-price");
assert.equal(near.warning, undefined);

// Exactly on the boundary belongs to the lower band.
assert.equal(expectedMonthlyFeeDetail(route, stop(5, 50000), policy).paise, 50000);

/* ── band 2: stop-priced, ₹700–800 ──────────────────────────── */

const mid = expectedMonthlyFeeDetail(route, stop(7, 75000), policy);
assert.equal(mid.ok, true);
assert.equal(mid.paise, 75000);
assert.equal(expectedMonthlyFeeDetail(route, stop(8, 80000), policy).paise, 80000);

/* ── above 8 km: ₹500 + ₹100 per started km beyond 5 ────────── */

// 9 km → 4 km beyond the covered 5 → ₹500 + ₹400 = ₹900
assert.equal(expectedMonthlyFeeDetail(route, stop(9), policy).paise, 90000);
assert.equal(expectedMonthlyFeeDetail(route, stop(9), policy).basis, "formula");
// 12 km → ₹500 + ₹700 = ₹1,200
assert.equal(expectedMonthlyFeeDetail(route, stop(12), policy).paise, 120000);

// A part kilometre counts as a whole one: 8.2 km is charged as 9 km.
assert.equal(expectedMonthlyFeeDetail(route, stop(8.2), policy).paise, 90000);
assert.equal(expectedMonthlyFeeDetail(route, stop(8.9), policy).paise, 90000);

// Past 8 km the stop needs no price of its own — distance decides.
assert.equal(expectedMonthlyFeeDetail(route, stop(10), policy).ok, true);

/* ── THE protection: unknown never becomes a number ─────────── */

// Measured, but nobody set the stop's price → refuse, and say what to do.
const unpriced = expectedMonthlyFeeDetail(route, stop(4), policy);
assert.equal(unpriced.ok, false);
assert.equal(unpriced.basis, "unpriced");
assert.equal(unpriced.paise, 0);
assert.ok(/₹300/.test(unpriced.reason ?? ""), "names the band it must sit in");
assert.ok(/₹500/.test(unpriced.reason ?? ""));

// Priced, but never measured → refuse, and point at the map.
const unmeasured = expectedMonthlyFeeDetail(
  route,
  normalizeStop({ name: "Ayar Mod", monthlyFeePaise: 40000 }, 0),
  policy,
);
assert.equal(unmeasured.ok, false);
assert.ok(/no measured distance/.test(unmeasured.reason ?? ""));

// No stop at all.
assert.equal(expectedMonthlyFeeDetail(route, undefined, policy).ok, false);

// The compatibility wrapper yields 0 for these, which computeTransportPeriodDues
// already skips rather than billing.
assert.equal(expectedMonthlyFeePaise(route, stop(4), policy), 0);

/* ── a mistyped stop price is flagged, not silently accepted ── */

const tooLow = expectedMonthlyFeeDetail(route, stop(3, 5000), policy);
assert.equal(tooLow.ok, true, "still billable — the clerk may have meant it");
assert.equal(tooLow.paise, 5000);
assert.ok(/outside/.test(tooLow.warning ?? ""), "but the mismatch is surfaced");

const tooHigh = expectedMonthlyFeeDetail(route, stop(3, 500000), policy);
assert.ok(/outside/.test(tooHigh.warning ?? ""));

// A price in the wrong band's range is still flagged against its own band.
assert.ok(
  /outside/.test(expectedMonthlyFeeDetail(route, stop(7, 40000), policy).warning ?? ""),
  "₹400 is a band-1 price; at 7 km it belongs to band 2",
);

/* ── older policies are untouched ───────────────────────────── */

const flat: TransportFeePolicy = { ...policy, rateMode: "flat_route" };
assert.equal(expectedMonthlyFeePaise(route, stop(12), flat), 60000);
assert.equal(expectedMonthlyFeeDetail(route, stop(12), flat).basis, "route-flat");
assert.equal(expectedMonthlyFeeDetail(route, stop(12), flat).ok, true);

console.log("  ok");
