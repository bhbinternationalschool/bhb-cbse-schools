/**
 * Self-test: the fuel register's pure rules.
 * Run: npx tsx apps/web/src/lib/transportFuelRegister.selftest.ts
 *
 * What this pins:
 *  1. Units: CNG is kg, diesel/petrol litres; quantities print with the unit.
 *  2. A bus is named by its plate; a VIN or "NA" falls back to the desk name
 *     with the VIN small (Magic-3 = MAT558053TVG40149).
 *  3. Km is never invented: between fills only when both odometers exist and
 *     the later is not lower; the month prefers the log book; ₹/km and km per
 *     unit are null without km, and km per unit is null on a mixed-unit month.
 *  4. The voucher: Dr 5031 tagged transport; Cr 1000 for cash, the chosen bank
 *     (with sub-ledger) for bank/UPI, 2000 against the named dealer on account;
 *     balanced; source key = the fill id (ledger_post posts it once).
 *  5. Import mapping: odometer 0 → null, IST date, stable id, payment mapping;
 *     linking to an existing Accounts line needs date + amount + plate and
 *     refuses ambiguity and reversed vouchers.
 *  6. Fleet Edge: a re-sent 30-minute window counts once; "NA" windows follow
 *     the tracker that reported the plate; no windows → no figure.
 *  7. The per-bus totals follow the period the fill list shows (21 Oct 2026):
 *     a fill before From or after To — even in the same month — is not in
 *     fills, quantity, ₹, km or km per unit; Fleet Edge counts the same dates.
 */

import assert from "node:assert/strict";

import {
  accountsStatus,
  buildFuelVoucher,
  busMonthTotals,
  busPeriodTotals,
  fleetEdgeMonthByVehicle,
  fleetEdgeRangeByVehicle,
  importedFillId,
  istDayOf,
  kmBetweenFills,
  looksLikePlate,
  mapDeskFuelLog,
  matchExistingFuelLine,
  quantityWithUnit,
  rateWarning,
  unitForFuel,
  vehicleLabel,
  type FuelVoucherLine,
  type TotalsFill,
} from "@/lib/transportFuelRegister";

/* 1. units */
assert.equal(unitForFuel("cng"), "kg");
assert.equal(unitForFuel("CNG"), "kg");
assert.equal(unitForFuel("diesel"), "litre");
assert.equal(unitForFuel("petrol"), "litre");
assert.equal(unitForFuel(""), "litre");
assert.equal(quantityWithUnit(7.55, "kg"), "7.55 kg");
assert.equal(quantityWithUnit(40, "litre"), "40 L");
assert.equal(rateWarning(7.55, 69966, "kg"), "");
assert.match(rateWarning(87.67, 70048, "kg"), /looks wrong/); // 13 May typo: 87.67 kg @ ₹7.99
assert.equal(rateWarning(0, 100, "kg"), "");

/* 2. labels */
assert.equal(looksLikePlate("UP65PT3540"), true);
assert.equal(looksLikePlate("UP 65 RT 9825"), true);
assert.equal(looksLikePlate("MAT558053TVG40149"), false);
assert.equal(looksLikePlate("NA"), false);
assert.equal(looksLikePlate("RAJESH VAN"), false);
assert.deepEqual(vehicleLabel({ name: "Magic-1", registrationNo: "UP65PT3540" }), { primary: "UP65PT3540", secondary: "Magic-1" });
assert.deepEqual(vehicleLabel({ name: "Magic-3", registrationNo: "MAT558053TVG40149" }), {
  primary: "Magic-3",
  secondary: "VIN MAT558053TVG40149",
});
assert.deepEqual(vehicleLabel({ name: "Rajesh Van", registrationNo: "RAJESH VAN" }), { primary: "Rajesh Van", secondary: "" });
assert.deepEqual(vehicleLabel({ name: "Spare", registrationNo: "NA" }), { primary: "Spare", secondary: "" });

/* 3. km */
const f = (id: string, vehicleId: string, fillDate: string, odometerKm: number | null, extra: Partial<TotalsFill> = {}): TotalsFill => ({
  id,
  vehicleId,
  fillDate,
  createdAt: `${fillDate}T06:00:00Z`,
  odometerKm,
  voided: false,
  quantity: 7,
  unit: "kg",
  amountPaise: 65_000,
  ...extra,
});
{
  const fills = [
    f("a1", "v1", "2026-09-28", 1000),
    f("a2", "v1", "2026-10-02", 1150),
    f("a3", "v1", "2026-10-05", null), // not read: breaks the chain
    f("a4", "v1", "2026-10-08", 1400), // previous fill has no reading → no km
    f("a5", "v1", "2026-10-10", 1390), // lower than before → typo, no km
    f("a6", "v1", "2026-10-12", 1500),
    f("a7", "v1", "2026-10-13", 1600, { voided: true }), // voided fills never count
  ];
  const km = kmBetweenFills(fills);
  assert.equal(km.get("a2"), 150);
  assert.equal(km.has("a3"), false);
  assert.equal(km.has("a4"), false);
  assert.equal(km.has("a5"), false);
  assert.equal(km.get("a6"), 110);
  assert.equal(km.has("a7"), false);

  const [t] = busMonthTotals({ month: "2026-10", vehicleIds: ["v1"], fills, dayLogKm: new Map(), fleetEdge: new Map() });
  assert.ok(t);
  assert.equal(t.fills, 5); // a2..a6, a7 voided, a1 in September
  assert.equal(t.kg, 35);
  assert.equal(t.amountPaise, 325_000);
  assert.equal(t.km, 260);
  assert.equal(t.kmSource, "fill_odometer");
  assert.equal(t.rupeesPerKm, 12.5);
  assert.equal(t.kmPerUnit, 7.43);
  assert.equal(t.kmPerUnitUnit, "kg");
  assert.equal(t.fleetEdgeKm, null);

  // The log book wins when it has complete days.
  const [t2] = busMonthTotals({
    month: "2026-10",
    vehicleIds: ["v1"],
    fills,
    dayLogKm: new Map([["v1", { km: 412.5, days: 9 }]]),
    fleetEdge: new Map([["v1", { km: 498.04, fuelUsed: 4.5 }]]),
  });
  assert.equal(t2!.km, 412.5);
  assert.equal(t2!.kmSource, "day_log");
  assert.equal(t2!.fleetEdgeKm, 498);
  assert.equal(t2!.fleetEdgeFuelUsed, 4.5);
}
{
  // No odometers at all (the imported Apr–Sep history): km unknown, every ratio null.
  const fills = [f("b1", "v2", "2026-08-05", null), f("b2", "v2", "2026-08-07", null)];
  const [t] = busMonthTotals({ month: "2026-08", vehicleIds: ["v2"], fills, dayLogKm: new Map(), fleetEdge: new Map() });
  assert.equal(t!.km, null);
  assert.equal(t!.rupeesPerKm, null);
  assert.equal(t!.kmPerUnit, null);
  assert.equal(t!.amountPaise, 130_000);
}
{
  // Mixed CNG + petrol month: ₹/km is fine, km per unit is meaningless.
  const fills = [f("c1", "v3", "2026-10-01", 100), f("c2", "v3", "2026-10-03", 300, { unit: "litre", quantity: 5 })];
  const [t] = busMonthTotals({ month: "2026-10", vehicleIds: ["v3"], fills, dayLogKm: new Map(), fleetEdge: new Map() });
  assert.equal(t!.km, 200);
  assert.ok(t!.rupeesPerKm != null);
  assert.equal(t!.kmPerUnit, null);
  assert.equal(t!.litres, 5);
  assert.equal(t!.kg, 7);
}
{
  // A bus with nothing this month: zero spend, unknown km.
  const [t] = busMonthTotals({ month: "2026-10", vehicleIds: ["none"], fills: [], dayLogKm: new Map(), fleetEdge: new Map() });
  assert.equal(t!.fills, 0);
  assert.equal(t!.km, null);
  assert.equal(t!.rupeesPerKm, null);
}

/* 4. the voucher */
const base = {
  fillId: "fuelw_abc12345",
  fillDate: "2026-10-12",
  vehicle: { name: "Magic-3", registrationNo: "MAT558053TVG40149" },
  fuelType: "cng" as const,
  quantity: 7.55,
  unit: "kg" as const,
  amountPaise: 69_966,
  odometerKm: 48_210,
  dealerName: "Shiv CNG",
  billNo: "1182",
};
{
  const r = buildFuelVoucher({ ...base, payment: { mode: "cash" } });
  assert.ok(r.ok);
  const v = r.voucher;
  assert.equal(v.voucherType, "payment");
  assert.equal(v.sourceType, "transport_fuel_fill");
  assert.equal(v.sourceId, "fuelw_abc12345");
  assert.equal(v.date, "2026-10-12");
  assert.equal(v.lines.length, 2);
  const dr = v.lines.find((l) => l.debitPaise > 0)!;
  assert.equal(dr.accountCode, "5031");
  assert.equal(dr.debitPaise, 69_966);
  assert.equal(dr.costCentreCode, "transport");
  assert.match(dr.narration ?? "", /Magic-3 \(VIN MAT558053TVG40149\)/);
  assert.match(dr.narration ?? "", /^cng 7\.55 kg @ ₹92\.67\/kg — /);
  assert.match(dr.narration ?? "", /48210 km · bill 1182$/);
  assert.equal(dr.party?.name, "Shiv CNG");
  const cr = v.lines.find((l) => l.creditPaise > 0)!;
  assert.equal(cr.accountCode, "1000"); // the cash box
  assert.equal(cr.creditPaise, 69_966);
}
{
  const r = buildFuelVoucher({ ...base, payment: { mode: "upi", bankAccountCode: "1012", bankAccountId: "bnk_5rx0puwl", ref: "UTR998" } });
  assert.ok(r.ok);
  const cr = r.voucher.lines.find((l) => l.creditPaise > 0)!;
  assert.equal(cr.accountCode, "1012");
  assert.equal(cr.subledgerKind, "bank_account");
  assert.equal(cr.subledgerId, "bnk_5rx0puwl");
  assert.equal(cr.instrument?.mode, "upi");
  assert.equal(cr.instrument?.ref, "UTR998");
}
{
  const r = buildFuelVoucher({ ...base, payment: { mode: "bank", bankAccountCode: "", bankAccountId: "bnk_x", ref: "" } });
  assert.ok(r.ok);
  assert.equal(r.voucher.lines.find((l) => l.creditPaise > 0)!.accountCode, "1010"); // generic bank fallback
}
{
  const r = buildFuelVoucher({ ...base, payment: { mode: "on_account" } });
  assert.ok(r.ok);
  assert.equal(r.voucher.voucherType, "journal");
  const cr = r.voucher.lines.find((l) => l.creditPaise > 0)!;
  assert.equal(cr.accountCode, "2000");
  assert.equal(cr.party?.kind, "vendor");
  assert.equal(cr.party?.externalId, "shiv cng");
  assert.equal(r.voucher.lines.some((l) => l.accountCode === "1000"), false);
}
assert.equal(buildFuelVoucher({ ...base, dealerName: " ", payment: { mode: "on_account" } }).ok, false);
assert.equal(buildFuelVoucher({ ...base, payment: { mode: "bank", bankAccountCode: "1012", bankAccountId: "", ref: "" } }).ok, false);
assert.equal(buildFuelVoucher({ ...base, amountPaise: 0, payment: { mode: "cash" } }).ok, false);
{
  const r = buildFuelVoucher({ ...base, odometerKm: null, billNo: "", dealerName: "", payment: { mode: "cash" } });
  assert.ok(r.ok);
  assert.equal(r.voucher.lines.find((l) => l.debitPaise > 0)!.party, undefined);
  assert.doesNotMatch(r.voucher.lines[0]!.narration ?? "", / km/);
}

/* status */
assert.equal(accountsStatus({ voided: false, voucherId: null, voucherNo: "", voucherOrigin: "", paymentMode: "", entrySource: "app" }).kind, "awaiting_office");
assert.equal(accountsStatus({ voided: false, voucherId: null, voucherNo: "", voucherOrigin: "", paymentMode: "", entrySource: "desk_import" }).kind, "not_in_accounts");
assert.equal(accountsStatus({ voided: false, voucherId: null, voucherNo: "", voucherOrigin: "", paymentMode: "cash", entrySource: "app" }).kind, "not_in_accounts");
{
  const s = accountsStatus({ voided: false, voucherId: "u1", voucherNo: "PY/FY2026-27/00574", voucherOrigin: "adopted", paymentMode: "cash", entrySource: "desk_import" });
  assert.equal(s.kind, "in_accounts");
  assert.match(s.label, /keyed in Accounts/);
}
assert.equal(accountsStatus({ voided: true, voucherId: "u1", voucherNo: "PY/1", voucherOrigin: "posted", paymentMode: "cash", entrySource: "web", reversalVoucherNo: "RV/1" }).label, "Voided · reversed RV/1");

/* 5. import mapping */
assert.equal(istDayOf("2026-04-07T12:00:00.000Z"), "2026-04-07");
assert.equal(istDayOf("2026-04-07T19:00:00.000Z"), "2026-04-08"); // after 18:30 UTC is the next IST day
assert.equal(importedFillId("fuel_ab.c/12"), "dk_fuel_abc12");
assert.match(importedFillId("x".repeat(100)), /^dk_x+$/);
assert.equal(importedFillId("x".repeat(100)).length, 64);
{
  const r = mapDeskFuelLog(
    {
      id: "fuel_k2j3",
      vehicleId: "veh_zrve78iq",
      filledAt: "2026-08-07T12:00:00.000Z",
      odometerKm: 0,
      qty: 7.55,
      amountPaise: 69_966,
      dealerId: "",
      billNo: "",
      filledBy: "",
      paymentStatus: "paid_cash",
    },
    { id: "veh_zrve78iq", fuelType: "cng" },
    new Map(),
  );
  assert.ok(r.ok);
  assert.equal(r.fill.id, "dk_fuel_k2j3");
  assert.equal(r.fill.deskEntryId, "fuel_k2j3");
  assert.equal(r.fill.fillDate, "2026-08-07");
  assert.equal(r.fill.odometerKm, null); // 0 was "nobody read it"
  assert.equal(r.fill.unit, "kg");
  assert.equal(r.fill.fuelType, "cng");
  assert.equal(r.fill.paymentMode, "cash");
  assert.equal(r.fill.amountPaise, 69_966);
}
{
  const r = mapDeskFuelLog(
    { id: "fuel_z", vehicleId: "v", filledAt: "2026-08-07T12:00:00Z", odometerKm: 48_000, qty: 40, amountPaise: 380_000, dealerId: "d1", paymentStatus: "on_account" },
    { id: "v", fuelType: "diesel" },
    new Map([["d1", "Bharat Petrol Pump"]]),
  );
  assert.ok(r.ok);
  assert.equal(r.fill.odometerKm, 48_000);
  assert.equal(r.fill.unit, "litre");
  assert.equal(r.fill.paymentMode, "on_account");
  assert.equal(r.fill.dealerName, "Bharat Petrol Pump");
}
assert.equal(mapDeskFuelLog({ id: "x1", vehicleId: "gone", filledAt: "2026-08-07T12:00:00Z", odometerKm: 0, qty: 5, amountPaise: 1 }, undefined, new Map()).ok, false);
assert.equal(mapDeskFuelLog({ id: "x2", vehicleId: "v", filledAt: "2026-08-07T12:00:00Z", odometerKm: 0, qty: 0, amountPaise: 1 }, { id: "v" }, new Map()).ok, false);
{
  const r = mapDeskFuelLog({ id: "x3", vehicleId: "v", filledAt: "2026-08-07T12:00:00Z", odometerKm: 0, qty: 5, amountPaise: 1, paymentStatus: "adjusted_from_stock" }, { id: "v" }, new Map());
  assert.ok(r.ok);
  assert.equal(r.fill.paymentMode, ""); // the office chooses
}

/* linking to the Accounts line already holding the fill */
const line = (lineId: string, narration: string, extra: Partial<FuelVoucherLine> = {}): FuelVoucherLine => ({
  lineId,
  voucherId: `v_${lineId}`,
  voucherNo: `PY/FY2026-27/${lineId}`,
  voucherDate: "2026-07-30",
  debitPaise: 69_966,
  narration,
  reversed: false,
  ...extra,
});
{
  // 30 Jul: one voucher, two buses, same amount — the plate decides.
  const lines = [line("L1", "cng 7.55 kg @ ₹92.67/kg — UP65PT3540"), line("L2", "cng 7.55 kg @ ₹92.67/kg — UP65RT9825")];
  const taken = new Set<string>();
  const fill = { fillDate: "2026-07-30", amountPaise: 69_966 };
  assert.equal(matchExistingFuelLine(fill, { registrationNo: "UP65RT9825" }, lines, taken)?.lineId, "L2");
  assert.equal(matchExistingFuelLine(fill, { registrationNo: "UP 65 PT 3540" }, lines, taken)?.lineId, "L1");
  // A taken line is not claimed twice.
  assert.equal(matchExistingFuelLine(fill, { registrationNo: "UP65RT9825" }, lines, new Set(["L2"])), null);
  // Wrong date / amount → no link.
  assert.equal(matchExistingFuelLine({ ...fill, fillDate: "2026-07-31" }, { registrationNo: "UP65RT9825" }, lines, taken), null);
  assert.equal(matchExistingFuelLine({ ...fill, amountPaise: 69_967 }, { registrationNo: "UP65RT9825" }, lines, taken), null);
  // A reversed voucher no longer holds the fill.
  assert.equal(matchExistingFuelLine(fill, { registrationNo: "UP65RT9825" }, [line("L3", "UP65RT9825", { reversed: true })], taken), null);
  // Ambiguous (two live lines naming the same bus) → refuse, never guess.
  assert.equal(matchExistingFuelLine(fill, { registrationNo: "UP65RT9825" }, [line("L4", "UP65RT9825"), line("L5", "UP65RT9825")], taken), null);
  // A VIN-named bus matches by VIN; a plate-less "NA" never matches.
  assert.equal(matchExistingFuelLine(fill, { registrationNo: "MAT558053TVG40149" }, [line("L6", "— MAT558053TVG40149")], taken)?.lineId, "L6");
  assert.equal(matchExistingFuelLine(fill, { registrationNo: "NA" }, [line("L7", "NA")], taken), null);
}

/* 6. Fleet Edge */
{
  const vehicles = [
    { id: "magic3", registrationNo: "MAT558053TVG40149" },
    { id: "magic2", registrationNo: "UP65RT9825" },
    { id: "idle", registrationNo: "UP65QT4657" },
  ];
  const ev = (ref: string, reg: string, from: string, km: number, fuel: number) => ({
    vehicleRef: ref,
    registrationNumber: reg,
    windowFrom: from,
    receivedAt: from,
    km,
    fuelUsed: fuel,
  });
  const rows = [
    // Magic-3 window sent four times.
    ev("MAT558053TVG40149", "NA", "2026-09-10T03:00:00Z", 12, 1),
    ev("MAT558053TVG40149", "NA", "2026-09-10T03:00:00Z", 12, 1),
    ev("MAT558053TVG40149", "NA", "2026-09-10T03:00:00Z", 12, 1),
    ev("MAT558053TVG40149", "NA", "2026-09-10T03:00:00Z", 12, 1),
    ev("MAT558053TVG40149", "NA", "2026-09-10T03:30:00Z", 8, 0.5),
    // Magic-2: tracker reported "NA" first, then its plate.
    ev("MAT558053TVE29204", "NA", "2026-09-02T03:00:00Z", 5, 0),
    ev("MAT558053TVE29204", "UP65RT9825", "2026-09-03T03:00:00Z", "7" as unknown as number, 0),
    // Outside the IST month (30 Sep 19:00 UTC = 1 Oct IST).
    ev("MAT558053TVE29204", "UP65RT9825", "2026-09-30T19:00:00Z", 100, 0),
    // Tata's placeholder vehicle is ignored.
    ev("MATXXXXXXXX", "UP65QT4657", "2026-09-05T03:00:00Z", 999, 9),
  ];
  const m = fleetEdgeMonthByVehicle({ month: "2026-09", vehicles, rows, ignoreRefs: new Set(["MATXXXXXXXX"]) });
  assert.deepEqual(m.get("magic3"), { km: 20, fuelUsed: 1.5, windows: 2 });
  assert.deepEqual(m.get("magic2"), { km: 12, fuelUsed: 0, windows: 2 });
  assert.equal(m.has("idle"), false); // nothing sent → no figure, not 0
}

// Chassis no.: Magic-3 keyed by plate + chassis still collects its "NA" windows.
{
  const rows = [
    { vehicleRef: "MAT558053TVG40149", registrationNumber: "NA", windowFrom: "2026-09-10T03:00:00Z", receivedAt: "2026-09-10T03:00:00Z", km: 12, fuelUsed: 1 },
    { vehicleRef: "MAT805022SFB02913", registrationNumber: "UP65QT4657", windowFrom: "2026-09-10T03:00:00Z", receivedAt: "2026-09-10T03:00:00Z", km: 4, fuelUsed: 0 },
  ];
  const m = fleetEdgeMonthByVehicle({
    month: "2026-09",
    vehicles: [
      { id: "magic3", registrationNo: "UP65ST1373", chassisNo: "MAT558053TVG40149" },
      { id: "city", registrationNo: "UP65QT4657" },
    ],
    rows,
  });
  assert.deepEqual(m.get("magic3"), { km: 12, fuelUsed: 1, windows: 1 });
  assert.deepEqual(m.get("city"), { km: 4, fuelUsed: 0, windows: 1 }, "plate-only unchanged");
  const fill = { fillDate: "2026-07-30", amountPaise: 69_966 };
  const lines = [line("L8", "Diesel — MAT558053TVG40149")];
  assert.equal(
    matchExistingFuelLine(fill, { registrationNo: "UP65ST1373", chassisNo: "MAT558053TVG40149" }, lines, new Set())?.lineId,
    "L8",
    "an old voucher naming the VIN still links once the plate is set",
  );
}

// A re-sent window is Fleet Edge revising it: the LATEST copy counts, once —
// the same rule as the Fleet Edge report (fleetEdgeWindows.ts). Real case,
// 14 Oct 2026: a window first sent with 3 km, later with 4 km.
{
  const w = "2026-10-13T03:00:00Z";
  const rows = [
    { vehicleRef: "MAT558053TVE29204", registrationNumber: "UP65RT9825", windowFrom: w, receivedAt: "2026-10-13T03:31:00Z", km: 3, fuelUsed: 0.2 },
    { vehicleRef: "MAT558053TVE29204", registrationNumber: "UP65RT9825", windowFrom: w, receivedAt: "2026-10-13T05:02:00Z", km: 4, fuelUsed: 0.3 },
    // An older copy arriving out of order must not win.
    { vehicleRef: "MAT558053TVE29204", registrationNumber: "UP65RT9825", windowFrom: w, receivedAt: "2026-10-13T04:00:00Z", km: 9, fuelUsed: 9 },
  ];
  const m = fleetEdgeMonthByVehicle({ month: "2026-10", vehicles: [{ id: "magic2", registrationNo: "UP65RT9825" }], rows });
  assert.deepEqual(m.get("magic2"), { km: 4, fuelUsed: 0.3, windows: 1 }, "latest copy of a revised window, counted once");
}

/* 7. the period, not the month */
{
  // One bus, October: fills on 2, 8, 15, 22 and 29 Oct (odometer every time),
  // one in late September. The screen shows 5–20 Oct.
  const fills = [
    f("p0", "bus", "2026-09-28", 1000, { quantity: 6, amountPaise: 50_000 }),
    f("p1", "bus", "2026-10-02", 1100, { quantity: 7, amountPaise: 60_000 }), // before From
    f("p2", "bus", "2026-10-08", 1250, { quantity: 8, amountPaise: 70_000 }), // in
    f("p3", "bus", "2026-10-15", 1450, { quantity: 9, amountPaise: 80_000 }), // in
    f("p4", "bus", "2026-10-16", 1500, { quantity: 1, amountPaise: 9_000, voided: true }), // in, voided
    f("p5", "bus", "2026-10-22", 1600, { quantity: 10, amountPaise: 90_000 }), // after To
    f("p6", "bus", "2026-10-29", 1700, { quantity: 11, amountPaise: 99_000 }), // after To
  ];
  const [t] = busPeriodTotals({
    from: "2026-10-05",
    to: "2026-10-20",
    vehicleIds: ["bus"],
    fills,
    dayLogKm: new Map(),
    fleetEdge: new Map(),
  });
  assert.ok(t);
  assert.equal(t.from, "2026-10-05");
  assert.equal(t.to, "2026-10-20");
  assert.equal(t.fills, 2, "only p2 and p3 — not the October fills either side of the range");
  assert.equal(t.kg, 17);
  assert.equal(t.amountPaise, 150_000);
  // Km since the previous fill, as the list row shows it: p2 150 (from p1,
  // which is before From — still the distance since the last fill), p3 200.
  assert.equal(t.km, 350);
  assert.equal(t.kmSource, "fill_odometer");
  assert.equal(t.kmPerUnit, 20.59);
  assert.equal(t.rupeesPerKm, 4.29);

  // Both ends included: a one-day period holds that day's fill.
  const [d] = busPeriodTotals({ from: "2026-10-15", to: "2026-10-15", vehicleIds: ["bus"], fills, dayLogKm: new Map(), fleetEdge: new Map() });
  assert.equal(d!.fills, 1);
  assert.equal(d!.amountPaise, 80_000);
  assert.equal(d!.km, 200);

  // A period across months counts both sides of the month end.
  const [x] = busPeriodTotals({ from: "2026-09-25", to: "2026-10-03", vehicleIds: ["bus"], fills, dayLogKm: new Map(), fleetEdge: new Map() });
  assert.equal(x!.fills, 2);
  assert.equal(x!.amountPaise, 110_000);

  // The whole month is the month (busMonthTotals is the same rule).
  const [m] = busMonthTotals({ month: "2026-10", vehicleIds: ["bus"], fills, dayLogKm: new Map(), fleetEdge: new Map() });
  assert.equal(m!.fills, 5);
  assert.equal(m!.amountPaise, 399_000);
  assert.equal(m!.from, "2026-10-01");
  assert.equal(m!.to, "2026-10-31");
  const [feb] = busMonthTotals({ month: "2028-02", vehicleIds: ["bus"], fills: [], dayLogKm: new Map(), fleetEdge: new Map() });
  assert.equal(feb!.to, "2028-02-29");

  // Fleet Edge windows: only those starting on the period's IST dates.
  const ev = (from: string, km: number) => ({ vehicleRef: "MATBUS1", registrationNumber: "UP65AB1234", windowFrom: from, receivedAt: from, km, fuelUsed: 1 });
  const rows = [
    ev("2026-10-04T18:29:00Z", 1), // 4 Oct 23:59 IST — out
    ev("2026-10-04T18:30:00Z", 2), // 5 Oct 00:00 IST — in
    ev("2026-10-12T03:00:00Z", 4), // in
    ev("2026-10-20T18:00:00Z", 8), // 20 Oct 23:30 IST — in
    ev("2026-10-20T18:30:00Z", 16), // 21 Oct IST — out
  ];
  const fe = fleetEdgeRangeByVehicle({ from: "2026-10-05", to: "2026-10-20", vehicles: [{ id: "bus", registrationNo: "UP65AB1234" }], rows });
  assert.deepEqual(fe.get("bus"), { km: 14, fuelUsed: 3, windows: 3 });
}

console.log("transportFuelRegister selftest: ok");
