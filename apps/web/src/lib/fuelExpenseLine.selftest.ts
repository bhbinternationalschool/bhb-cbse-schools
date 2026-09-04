/**
 * Fuel lines: the unit must follow the fuel, and the amount must be derived.
 */
import assert from "node:assert/strict";
import {
  buildFuelRefill,
  checkFuelLine,
  fuelAmountPaise,
  fuelNarration,
  isFuelAccount,
} from "@/lib/fuelExpenseLine";

const CNG_PETROL = [
  { fuelType: "CNG", unit: "kg" },
  { fuelType: "Petrol", unit: "litre" },
];

function run() {
  // Detection is on the name, because the office renames heads.
  assert.equal(isFuelAccount({ code: "5031", name: "Vehicle Fuel" }), true);
  assert.equal(isFuelAccount({ code: "5032", name: "CNG" }), true);
  assert.equal(isFuelAccount({ code: "5000", name: "Refreshment" }), false);
  // "Diesel Generator Repair" is not a fuel purchase, but it names diesel;
  // matching it costs an optional panel and nothing else.
  assert.equal(isFuelAccount({ name: "Stationery" }), false);

  // Amount is rate × quantity, to the paisa.
  // ₹100.50 × 33.33 kg = ₹3,349.665 — rounds up, and always the same way.
  assert.equal(fuelAmountPaise(10_050, 33.33), 334_967);
  assert.equal(fuelAmountPaise(9_500, 42.5), 403_750);
  assert.equal(fuelAmountPaise(-100, 5), 0, "a negative rate cannot bill");

  // A CNG+Petrol vehicle takes both, in their own units.
  const ok = checkFuelLine({
    pick: { vehicleId: "v1", fuelType: "CNG", unit: "kg", ratePaisePerUnit: 9_000, qty: 12, odometerKm: 50_100 },
    allowedFuels: CNG_PETROL,
    lastOdometerKm: 49_800,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.warnings.length, 0);

  // Diesel in a CNG+Petrol vehicle is refused, not quietly accepted.
  const wrongFuel = checkFuelLine({
    pick: { vehicleId: "v1", fuelType: "Diesel", unit: "litre", ratePaisePerUnit: 9_000, qty: 12, odometerKm: 1 },
    allowedFuels: CNG_PETROL,
  });
  assert.equal(wrongFuel.ok, false);
  assert.match(wrongFuel.problems.join(" "), /does not run on Diesel/);

  // kg entered as litres is refused: the quantity itself is now in doubt.
  const wrongUnit = checkFuelLine({
    pick: { vehicleId: "v1", fuelType: "CNG", unit: "litre", ratePaisePerUnit: 9_000, qty: 12, odometerKm: 1 },
    allowedFuels: CNG_PETROL,
  });
  assert.equal(wrongUnit.ok, false);
  assert.match(wrongUnit.problems.join(" "), /measured in kg/);

  // A backwards odometer warns but does not block — clusters do get replaced.
  const backwards = checkFuelLine({
    pick: { vehicleId: "v1", fuelType: "CNG", unit: "kg", ratePaisePerUnit: 9_000, qty: 12, odometerKm: 400 },
    allowedFuels: CNG_PETROL,
    lastOdometerKm: 49_800,
  });
  assert.equal(backwards.ok, true, "a replaced meter must still be recordable");
  assert.equal(backwards.warnings.length, 1);

  // No vehicle means no mileage, so it is a refusal.
  const noVehicle = checkFuelLine({
    pick: { vehicleId: "", fuelType: "CNG", unit: "kg", ratePaisePerUnit: 9_000, qty: 12, odometerKm: 1 },
    allowedFuels: CNG_PETROL,
  });
  assert.equal(noVehicle.ok, false);

  assert.match(
    fuelNarration({
      vehicleNo: "UP65QT4657",
      pick: { fuelType: "Diesel", unit: "litre", qty: 42.5, ratePaisePerUnit: 9_500, odometerKm: 50_100 },
    }),
    /Diesel 42.5 litre @ ₹95.00\/litre — UP65QT4657 \(50100 km\)/,
  );

  // An unpaid fill is on account, so Transport does not call it settled.
  const credit = buildFuelRefill({
    pick: { vehicleId: "v1", fuelType: "CNG", unit: "kg", ratePaisePerUnit: 9_000, qty: 12, odometerKm: 50_100 },
    vendorName: "Kisan Gas",
    billNo: "B-9",
    filledAt: "2026-09-02T10:00:00.000Z",
    paidInFull: false,
  });
  assert.equal(credit.paymentStatus, "on_account");
  assert.equal(credit.amountPaise, 108_000, "the refill carries the same money as the voucher line");
  assert.equal(credit.source, "dealer_pump");

  const cash = buildFuelRefill({
    pick: { vehicleId: "v1", fuelType: "CNG", unit: "kg", ratePaisePerUnit: 9_000, qty: 12, odometerKm: 50_100 },
    vendorName: "Kisan Gas",
    billNo: "",
    filledAt: "2026-09-02T10:00:00.000Z",
    paidInFull: true,
  });
  assert.equal(cash.paymentStatus, "paid_cash");

  console.log("fuelExpenseLine selftest: ok");
}

run();
