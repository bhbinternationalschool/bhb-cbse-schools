/**
 * Self-test: the distance benchmark and the shortfall it produces.
 * Run: npx tsx apps/web/src/lib/transportShortfall.selftest.ts
 *
 * The rule as the school states it: ₹500 covers the first 5 km, then ₹100 for
 * every started kilometre. 5.4 km benchmarks at ₹600.
 *
 * The rule this file mainly protects: an unmeasured stop produces NO shortfall.
 * A blank distance must never send the office chasing a family for money.
 */

import assert from "node:assert/strict";

import { distanceBenchmarkPaise } from "./transportPlanner";

console.log("transportShortfall.selftest.ts");

const P = { formula: { basePaise: 50000, baseCoversKm: 5, perKmPaise: 10000 } };
const rs = (km: number) => distanceBenchmarkPaise(km, P) / 100;

/* ── inside the base distance ───────────────────────────────── */

assert.equal(rs(0.5), 500);
assert.equal(rs(3), 500);
assert.equal(rs(4.9), 500);
assert.equal(rs(5), 500, "exactly 5 km is still covered by the base");

/* ── beyond it, every started kilometre counts ──────────────── */

assert.equal(rs(5.1), 600, "a tenth of a kilometre over starts the next km");
assert.equal(rs(5.4), 600, "the school's own worked example");
assert.equal(rs(6), 600, "exactly 6 km is one whole km beyond");
assert.equal(rs(6.1), 700);
assert.equal(rs(8), 800);
assert.equal(rs(9.1), 1000, "9.1 km is FIVE started km beyond 5, not four");
assert.equal(rs(12), 1200);
assert.equal(rs(12.9), 1300);

/* ── whole rupees, never a fraction ─────────────────────────── */

for (const km of [5.01, 5.5, 7.77, 9.99, 11.111]) {
  const v = rs(km);
  assert.equal(v, Math.round(v), `${km} km produced a fractional rupee: ${v}`);
  assert.equal(v % 100, 0, `${km} km should land on a whole hundred: ${v}`);
}

/* ── THE protection: unknown distance yields nothing ────────── */

assert.equal(distanceBenchmarkPaise(0, P), 0, "unmeasured stop → no benchmark");
assert.equal(distanceBenchmarkPaise(-3, P), 0, "junk distance → no benchmark");
assert.equal(
  distanceBenchmarkPaise(Number.NaN, P),
  0,
  "NaN distance → no benchmark, not NaN rupees",
);

/* ── the shortfall arithmetic ───────────────────────────────── */

const shortfall = (km: number, chargedRs: number) => {
  const b = distanceBenchmarkPaise(km, P);
  return b > 0 ? Math.max(0, b - chargedRs * 100) / 100 : 0;
};

// The school's stated case: 5 km at ₹500 is square.
assert.equal(shortfall(4.2, 500), 0);
assert.equal(shortfall(5, 500), 0);

// Beyond 5 km on a ₹500 fee, the gap shows.
assert.equal(shortfall(5.4, 500), 100);
assert.equal(shortfall(9.1, 500), 500);
assert.equal(shortfall(12, 500), 700);

// Paying ABOVE the benchmark is not a negative shortfall — that would read as
// a refund owed to the family.
assert.equal(shortfall(3, 700), 0);
assert.equal(shortfall(9.1, 1500), 0);

// A rider on an unmeasured stop never shows a gap, whatever they pay.
assert.equal(shortfall(0, 0), 0);
assert.equal(shortfall(0, 500), 0);

/* ── the policy's own numbers are honoured, not hard-coded ──── */

const cheaper = {
  formula: { basePaise: 30000, baseCoversKm: 3, perKmPaise: 5000 },
};
assert.equal(distanceBenchmarkPaise(3, cheaper) / 100, 300);
assert.equal(distanceBenchmarkPaise(5, cheaper) / 100, 400);
assert.equal(distanceBenchmarkPaise(5.5, cheaper) / 100, 450);

// No policy passed falls back to the school's current rule.
assert.equal(distanceBenchmarkPaise(5.4) / 100, 600);

console.log("  ok");
