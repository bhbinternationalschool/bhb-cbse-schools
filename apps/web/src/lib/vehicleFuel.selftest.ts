/**
 * Self-test: what a vehicle can be filled with.
 *
 * Four of this fleet run on CNG with a petrol tank. One fuel value could not
 * say that, so they were recorded as whichever fuel came to mind and a petrol
 * fill on a CNG bus had nowhere to go. The unit matters as much: CNG is sold
 * by the kilogram, and production had a CNG bus recorded in litres — which
 * would have priced a fill per litre and skewed every mileage figure after.
 */

import assert from "node:assert/strict";

import { vehicleFuelOptions, normalizeVehicle } from "./transport";
import type { FleetVehicle } from "./transport";

console.log("vehicleFuel.selftest.ts");

/* A single-fuel vehicle offers one fuel, in its own unit. */
{
  const opts = vehicleFuelOptions({ fuelType: "diesel", secondaryFuelType: "" });
  assert.deepEqual(opts, [{ fuelType: "diesel", unit: "liter" }]);
}

/* CNG is kilograms, never litres. */
{
  assert.deepEqual(vehicleFuelOptions({ fuelType: "cng", secondaryFuelType: "" }), [
    { fuelType: "cng", unit: "kg" },
  ]);
}

/* Bi-fuel offers both — and the units DIFFER, which is the point. */
{
  const opts = vehicleFuelOptions({ fuelType: "cng", secondaryFuelType: "petrol" });
  assert.deepEqual(opts, [
    { fuelType: "cng", unit: "kg" },
    { fuelType: "petrol", unit: "liter" },
  ]);
  assert.notEqual(opts[0]!.unit, opts[1]!.unit, "kg of CNG and litres of petrol");
}

/* A secondary that repeats the primary says nothing and is dropped. */
{
  assert.deepEqual(vehicleFuelOptions({ fuelType: "cng", secondaryFuelType: "cng" }), [
    { fuelType: "cng", unit: "kg" },
  ]);
}

/* Normalising corrects a stored unit that contradicts its fuel. */
{
  const rows = (
    [
      // Exactly what production held: a CNG bus recorded in litres.
      { id: "v1", registrationNo: "UP65RT9825", fuelType: "cng", fuelUnit: "liter" },
      { id: "v2", registrationNo: "UP65QT4657", fuelType: "diesel", fuelUnit: "liter" },
      { id: "v3", registrationNo: "DUAL1", fuelType: "cng", secondaryFuelType: "petrol" },
    ] as Partial<FleetVehicle>[]
  ).map(normalizeVehicle);

  const by = (reg: string) => rows.find((v) => v.registrationNo === reg)!;
  assert.equal(by("UP65RT9825").fuelUnit, "kg", "the CNG bus is corrected to kilograms");
  assert.equal(by("UP65QT4657").fuelUnit, "liter", "diesel is left in litres");
  assert.equal(by("DUAL1").secondaryFuelType, "petrol", "the second fuel survives normalising");
  assert.deepEqual(
    vehicleFuelOptions(by("DUAL1")),
    [{ fuelType: "cng", unit: "kg" }, { fuelType: "petrol", unit: "liter" }],
    "and a normalised bi-fuel vehicle offers both fuels",
  );
}

console.log("  ok — bi-fuel offers both, CNG is kilograms, a wrong unit is corrected");
