/**
 * Fuel two-way (14 Oct 2026): rate × qty rounds the same in the app, the
 * voucher and the table's check; the table's filters, mileage and totals;
 * the reconcile pairs the old desk refills exactly as the import will; and
 * the wiring that keeps Accounts and Transport → Fuel on one record.
 *
 * Run: npx tsx src/lib/fuelLog.selftest.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fuelAmountPaise } from "@/lib/fuelExpenseLine";
import { buildFuelVoucher, fuelLineNarration } from "@/lib/transportFuelRegister";
import {
  amountMatchesRate,
  filterFuelRows,
  fuelDatePresets,
  fuelTotals,
  inrPaise,
  mileageByFill,
  mileageTrend,
  parseFuelNarration,
  planFuelReconcile,
  qtyText,
  ratePaiseOf,
  singleMonthOf,
  type FuelTableRow,
  type ReconcileLine,
} from "@/lib/fuelLog";

console.log("fuelLog.selftest.ts");

/** The SQL rule exactly: round(rate_paise * quantity) on numeric, half away from zero. */
function sqlAmount(ratePaise: number, qty: number): number {
  const prod = BigInt(ratePaise) * BigInt(Math.round(qty * 100)); // paise × hundredths
  const hundred = BigInt(100);
  const whole = prod / hundred;
  return Number(prod % hundred >= BigInt(50) ? whole + BigInt(1) : whole);
}

/* ── 1. Rounding parity: app, SQL check, voucher line ── */
{
  // Production's own figures (PY/FY2026-27/00715, 00659, 00574, 00619).
  for (const [rate, qty, want] of [
    [9300, 7.53, 70029],
    [9267, 8.63, 79974],
    [8767, 8.9, 78026],
    [799, 87.67, 70048],
    [10050, 33.33, 334967], // ₹3,349.665 — the half paisa rounds up, always
  ] as const) {
    assert.equal(fuelAmountPaise(rate, qty), want, `app ${rate}×${qty}`);
    assert.equal(sqlAmount(rate, qty), want, `SQL ${rate}×${qty}`);
  }
  for (let rate = 7001; rate < 11000; rate += 37) {
    for (let c = 1; c < 6000; c += 53) {
      assert.equal(fuelAmountPaise(rate, c / 100), sqlAmount(rate, c / 100), `parity ${rate}×${c / 100}`);
    }
  }
  assert.equal(amountMatchesRate({ ratePaise: 9300, quantity: 7.53, amountPaise: 70029 }), true);
  assert.equal(amountMatchesRate({ ratePaise: 9300, quantity: 7.53, amountPaise: 70000 }), false, "₹700 against ₹700.29 is drift");
  assert.equal(amountMatchesRate({ ratePaise: null, quantity: 7.53, amountPaise: 70000 }), true, "no rate entered: nothing to check");
  assert.equal(ratePaiseOf({ ratePaise: null, quantity: 7.55, amountPaise: 69966 }), 9267);
  assert.equal(inrPaise(70029), "₹700.29");

  // The register's voucher carries the very amount the fill stores, and its
  // narration reads back into the same fill.
  const built = buildFuelVoucher({
    fillId: "fuela_1",
    fillDate: "2026-08-31",
    vehicle: { name: "Magic-2", registrationNo: "UP65RT9825" },
    fuelType: "cng",
    quantity: 7.53,
    unit: "kg",
    amountPaise: fuelAmountPaise(9300, 7.53),
    odometerKm: 41200,
    dealerName: "",
    billNo: "B-1",
    payment: { mode: "cash" },
  });
  assert.ok(built.ok);
  if (built.ok) {
    assert.equal(built.voucher.lines[0]!.accountCode, "5031");
    assert.equal(built.voucher.lines[0]!.debitPaise, 70029, "voucher line = rate × qty");
    assert.equal(built.voucher.sourceType, "transport_fuel_fill");
    const back = parseFuelNarration(built.voucher.lines[0]!.narration ?? "");
    assert.deepEqual(back && [back.fuelType, back.qty, back.ratePaise, back.plate], ["cng", 7.53, 9300, "UP65RT9825"]);
  }
  // The Accounts form's older narration style parses too.
  assert.deepEqual(parseFuelNarration("cng 8.63 kg @ ₹92.67/kg — UP65RT9825 (41200 km) · trip"), {
    fuelType: "cng",
    qty: 8.63,
    unit: "kg",
    ratePaise: 9267,
    plate: "UP65RT9825",
  });
  assert.equal(parseFuelNarration("C.N.G. Ramanand"), null);
  assert.ok(fuelLineNarration({ fuelType: "cng", quantity: 7.53, unit: "kg", amountPaise: 70029, odometerKm: null, billNo: "", vehicle: { name: "x", registrationNo: "UP65RT9825" } }).includes("@ ₹93.00/kg"));
}

/* ── 2. Mileage per vehicle AND fuel; filters; totals ── */
const row = (o: Partial<FuelTableRow>): FuelTableRow => ({
  id: "x",
  vehicleId: "veh_a",
  vehicleName: "UP65RT9825",
  fillDate: "2026-09-01",
  createdAt: "2026-09-01T10:00:00Z",
  fuelType: "cng",
  unit: "kg",
  quantity: 8,
  ratePaise: 9300,
  amountPaise: 74400,
  odometerKm: null,
  voided: false,
  statusKind: "in_accounts",
  ...o,
});
{
  const rows = [
    row({ id: "a1", fillDate: "2026-09-01", odometerKm: 1000 }),
    row({ id: "a2", fillDate: "2026-09-04", odometerKm: 1200 }),
    // Petrol in the same bi-fuel vehicle: its own chain.
    row({ id: "a3", fillDate: "2026-09-05", odometerKm: 1250, fuelType: "petrol", unit: "litre", quantity: 5 }),
    row({ id: "a4", fillDate: "2026-09-06", odometerKm: null }), // not read
    row({ id: "a5", fillDate: "2026-09-07", odometerKm: 1300, voided: true, statusKind: "voided" }),
    row({ id: "a6", fillDate: "2026-09-08", odometerKm: 1440, quantity: 12, statusKind: "not_in_accounts" }),
    row({ id: "a7", fillDate: "2026-09-09", odometerKm: 1400, quantity: 5 }), // dial went back
    row({ id: "b1", vehicleId: "veh_b", vehicleName: "UP65PT3540", fillDate: "2026-10-02", odometerKm: 500, quantity: 10, fuelType: "diesel", unit: "litre", amountPaise: 95500 }),
  ];
  const m = mileageByFill(rows);
  assert.deepEqual(m.get("a2"), { km: 200, kmPerUnit: 25 });
  assert.equal(m.get("a1"), undefined);
  assert.equal(m.get("a3"), undefined, "first petrol fill");
  assert.equal(m.get("a4"), undefined, "no reading");
  assert.deepEqual(m.get("a6"), { km: 240, kmPerUnit: 20 }, "void a5 skipped: 1200 → 1440");
  assert.equal(m.get("a7"), undefined, "a backwards dial gives no figure");
  const cng = mileageTrend(rows, m).find((t) => t.vehicleId === "veh_a" && t.fuelType === "cng")!;
  assert.equal(cng.points.length, 2);
  assert.equal(cng.average, 22);

  const f = (o: Partial<Parameters<typeof filterFuelRows>[1]>) =>
    filterFuelRows(rows, { vehicleId: "", from: "", to: "", fuelType: "", status: "", ...o }).map((r) => r.id);
  assert.deepEqual(f({ vehicleId: "veh_b" }), ["b1"]);
  assert.deepEqual(f({ from: "2026-09-04", to: "2026-09-06" }).sort(), ["a2", "a3", "a4"]);
  assert.deepEqual(f({ fuelType: "petrol" }), ["a3"]);
  assert.deepEqual(f({ status: "voided" }), ["a5"]);
  assert.deepEqual(f({ status: "not_in_accounts" }), ["a6"]);
  assert.equal(f({})[0], "b1", "newest first");

  const t = fuelTotals(rows);
  assert.equal(t.all.fills, 7, "a voided fill counts for nothing");
  assert.equal(t.all.kg, 41);
  assert.equal(t.all.litres, 15, "kg and litres never added together");
  assert.equal(qtyText(t.all), "41.00 kg · 15.00 L");
  assert.equal(t.byVehicle.find((v) => v.vehicleId === "veh_b")!.amountPaise, 95500);

  const p = fuelDatePresets("2026-10-14");
  assert.deepEqual(p.thisMonth, { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(p.lastMonth, { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(p.thisFy, { from: "2026-04-01", to: "2027-03-31" });
  assert.deepEqual(fuelDatePresets("2027-01-05").lastMonth, { from: "2026-12-01", to: "2026-12-31" });
  assert.equal(fuelDatePresets("2028-03-10").lastMonth.to, "2028-02-29", "leap February");
  assert.equal(singleMonthOf("2026-10-01", "2026-10-31"), "2026-10");
  assert.equal(singleMonthOf("2026-04-01", "2027-03-31"), "");
}

/* ── 3. Reconcile: the import's own pairing rule, read-only ── */
{
  const vehicles = [
    { id: "veh_a", registrationNo: "UP65RT9825" },
    { id: "veh_b", registrationNo: "UP65PT3540" },
    { id: "veh_c", registrationNo: "MAT558053TVG40149" },
  ];
  const line = (id: string, no: string, date: string, paise: number, narr: string, o: Partial<ReconcileLine> = {}): ReconcileLine => ({
    lineId: id,
    voucherId: no,
    voucherNo: no,
    voucherDate: date,
    debitPaise: paise,
    narration: narr,
    reversed: false,
    linked: false,
    ...o,
  });
  const n = (q: number, plate: string) => `cng ${q} kg @ ₹92.67/kg — ${plate}`;
  const lines = [
    line("L1", "PY/684", "2026-07-30", 69966, n(7.55, "UP65PT3540")),
    line("L2", "PY/684", "2026-07-30", 69966, n(7.55, "UP65RT9825")),
    line("L3", "PY/700", "2026-08-01", 69966, n(7.55, "UP65RT9825"), { reversed: true }), // cleared 13 Oct
    line("L4", "PY/701", "2026-08-02", 50000, "CNG-Magic 2026"), // no plate → never pairs
    line("L5", "PY/702", "2026-08-03", 69966, n(7.55, "MAT558053TVG40149"), { linked: true }), // already has a fill
  ];
  const refill = (id: string, veh: string, day: string, amt: number, imported = false) => ({ id, vehicleId: veh, fillDate: day, qty: 7.55, amountPaise: amt, imported });
  const plan = planFuelReconcile({
    vehicles,
    lines,
    refills: [
      refill("r1", "veh_a", "2026-07-30", 69966),
      refill("r2", "veh_b", "2026-07-30", 69966),
      refill("r3", "veh_a", "2026-08-01", 69966), // its voucher was reversed
      refill("r4", "veh_c", "2026-08-03", 69966), // its line already carries a fill
      refill("r5", "veh_a", "2026-07-30", 69967), // a paisa off: the import does not guess
      refill("r6", "veh_b", "2026-07-30", 69966, true), // imported before: not reported again
    ],
  });
  assert.deepEqual(
    Object.fromEntries(plan.matched.map((m) => [m.refill.id, m.line.lineId])),
    { r1: "L2", r2: "L1" },
  );
  assert.deepEqual(plan.refillOnly.map((r) => r.id).sort(), ["r3", "r4", "r5"]);
  assert.deepEqual(plan.lineOnly.map((l) => l.lineId), ["L4"], "reversed and linked lines are not 'missing a fill'");

  // Two identical candidate lines → no guess (the import's ambiguity rule).
  const twin = planFuelReconcile({
    vehicles,
    lines: [line("T1", "PY/9", "2026-09-01", 100, n(1, "UP65RT9825")), line("T2", "PY/10", "2026-09-01", 100, n(1, "UP65RT9825"))],
    refills: [refill("x", "veh_a", "2026-09-01", 100)],
  });
  assert.equal(twin.matched.length, 0);
  assert.equal(twin.refillOnly.length, 1);
}

/* ── 4. The wiring ── */
{
  const root = join(__dirname, "..");
  const sql = readFileSync(join(root, "../../../supabase/migrations/20261014150000_transport_fuel_two_way.sql"), "utf8");
  assert.match(sql, /amount_paise = round\(rate_paise \* quantity\)/, "the table enforces rate × qty");
  assert.match(sql, /v_result := public\.ledger_post\(p_tenant_id, v_payload\)/, "post writes the voucher inside the same function");
  assert.match(sql, /public\.ledger_reverse\(\s*p_tenant_id, v_row\.voucher_id/, "void reverses inside the same function");
  assert.match(sql, /after insert on public\.ledger_vouchers[\s\S]*reverses_voucher_id is not null/, "any reversal voids its fills");
  assert.match(sql, /void it, never delete it/, "no delete of a fill in the book");

  const reg = readFileSync(join(root, "lib/transportFuelRegister.server.ts"), "utf8");
  assert.match(reg, /rpc\("transport_fuel_fill_post"/, "the register posts through the one-transaction function");
  assert.match(reg, /rpc\("transport_fuel_fill_void"/, "and voids through it");
  assert.ok(!/await ledgerPost\(/.test(reg), "no two-step post-then-stamp left");

  const panels = readFileSync(join(root, "components/accounts/LedgerEntryPanels.tsx"), "utf8");
  assert.ok(!/new Set\(\["5031"/.test(panels), "Vehicle Fuel is offered in Accounts again");
  assert.match(panels, /fuelFills/, "multi-line sends its fuel rows with the voucher");
  assert.match(panels, /<FuelEntryForm /, "Quick expense takes fuel through the fill form");
  assert.ok(!/loadTransport\(/.test(panels), "the fleet comes from the server, not this browser");

  const ledger = readFileSync(join(root, "app/api/ledger/route.ts"), "utf8");
  assert.match(ledger, /refuseFuelVoucherChange/, "amend / re-head of a fuel voucher is refused");
  assert.match(ledger, /is a fuel head — enter fuel with its vehicle/, "a bare fuel-head post is refused");
}

console.log("fuelLog.selftest.ts: all passed");
