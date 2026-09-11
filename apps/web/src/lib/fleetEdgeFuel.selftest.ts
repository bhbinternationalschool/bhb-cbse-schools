/**
 * Self-test: which tank is which, per vehicle.
 * Run: npx tsx apps/web/src/lib/fleetEdgeFuel.selftest.ts
 *
 * Fleet Edge reports "primary" and "secondary" and never names the fuel, so
 * the mapping lives in the ERP. It was wrong until 10 September 2026 — tank 2
 * was labelled CNG on a guess made in August, before a single tank reading
 * had ever arrived. The three bi-fuel buses actually run CNG as the primary
 * with petrol secondary, and Tata's own portal shows CNG as the headline
 * live figure. Under the old mapping the first real CNG reading would have
 * been displayed as petrol, correct number under the wrong heading, with
 * nothing to flag it.
 */

import assert from "node:assert/strict";

import { tankLabels, usesCng, FUEL_TYPE_LABEL } from "./fleetEdgeReport.types";

console.log("fleetEdgeFuel.selftest.ts");

/* ── this fleet, as it actually runs ────────────────────────── */

// UP65PT3540 / UP65RT9825 / MAT558053TVG40149 — CNG first, petrol reserve.
assert.deepEqual(tankLabels("petrol_cng"), { primary: "CNG", secondary: "petrol" });

// UP65MT0849 (Winger) and UP65QT4657 (city bus) — diesel, and a secondary
// that is DEF rather than a second fuel tank.
assert.deepEqual(tankLabels("diesel"), { primary: "diesel", secondary: "DEF" });

/* ── the specific inversion that was there before ───────────── */

assert.notEqual(
  tankLabels("petrol_cng").primary,
  "petrol",
  "CNG is the primary on a bi-fuel bus, not the reserve",
);
assert.notEqual(
  tankLabels("petrol_cng").secondary,
  "CNG",
  "labelling tank 2 as CNG is what put a petrol heading on a CNG reading",
);

/* ── a diesel secondary is never called a fuel tank ─────────── */

assert.equal(
  tankLabels("diesel").secondary,
  "DEF",
  "a low DEF level must not read as an empty fuel tank",
);

/* ── nothing is invented when the fuel type is unknown ───────── */

for (const unknown of [null, undefined]) {
  assert.deepEqual(
    tankLabels(unknown),
    { primary: "tank 1", secondary: "tank 2" },
    "an unrecorded fuel type names neither tank",
  );
}

/* ── every declared fuel type has an answer ─────────────────── */

for (const t of Object.keys(FUEL_TYPE_LABEL) as (keyof typeof FUEL_TYPE_LABEL)[]) {
  const { primary, secondary } = tankLabels(t);
  assert.ok(primary && secondary, `${t} must label both tanks`);
  // A CNG vehicle must say CNG somewhere, or the chip and the tank disagree.
  if (usesCng(t)) {
    assert.ok(
      primary === "CNG" || secondary === "CNG",
      `${t} is flagged as CNG but neither tank says so`,
    );
  }
}

console.log("  ok");
