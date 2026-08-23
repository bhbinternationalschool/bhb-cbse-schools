/**
 * Self-test: staff riding the school bus.
 * Run: npx tsx apps/web/src/lib/transportStaffRiders.selftest.ts
 *
 * The rule this exists to hold: "free" is a decision somebody recorded, never
 * something inferred from a blank amount. Those two look identical once they
 * are both zero, and that is precisely how riders billed nothing stayed
 * invisible on this module for months.
 *
 * The mutation itself needs localStorage, so what is tested here is the
 * normaliser — the layer every saved and reloaded record passes through, and
 * the one that decides what a half-filled row means.
 */

import assert from "node:assert/strict";

import { normalizeStaffRider, type TransportStaffRider } from "./transport";

console.log("transportStaffRiders.selftest.ts");

function riders(rows: unknown[]): TransportStaffRider[] {
  return rows.map((r) => normalizeStaffRider(r as Partial<TransportStaffRider>));
}

/* ── a charged ride keeps its amount ────────────────────────── */

const [charged] = riders([
  {
    id: "sr1",
    staffId: "stf_1",
    routeId: "r1",
    stopId: "st1",
    academicYearCode: "2026-27",
    effectiveFrom: "2026-04-01",
    costMode: "charged",
    monthlyFeePaise: 50000,
    note: "agreed at joining",
  },
]);
assert.equal(charged.costMode, "charged");
assert.equal(charged.monthlyFeePaise, 50000);
assert.equal(charged.serviceMode, "both", "missing service mode means both");
assert.equal(charged.effectiveTo, null);

/* ── a free ride carries no amount, whatever was stored ─────── */

const [free] = riders([
  {
    id: "sr2",
    staffId: "stf_2",
    costMode: "free",
    monthlyFeePaise: 50000,
    note: "part of appointment terms",
  },
]);
assert.equal(free.costMode, "free");
assert.equal(
  free.monthlyFeePaise,
  0,
  "a free ride cannot carry a charge — the two together are a contradiction",
);
assert.equal(free.note, "part of appointment terms");

/* ── THE protection: an unfinished charge is not a free ride ── */

// A row that says "charged" with no amount is an unfinished charge. Reading
// it as free would waive money nobody agreed to waive.
const [halfDone] = riders([
  { id: "sr3", staffId: "stf_3", costMode: "charged" },
]);
assert.equal(halfDone.costMode, "charged", "stays charged, not silently free");
assert.equal(halfDone.monthlyFeePaise, 0, "and shows as an incomplete charge");

// Anything that is not the word "charged" is free — including a missing
// field. That default is safe only because assignStaffToTransport refuses to
// SAVE a free ride without a reason, so a blank one cannot be created here.
const [noMode] = riders([{ id: "sr4", staffId: "stf_4" }]);
assert.equal(noMode.costMode, "free");
assert.equal(noMode.monthlyFeePaise, 0);

/* ── junk never becomes money ───────────────────────────────── */

const [junk] = riders([
  { id: "sr5", staffId: "stf_5", costMode: "charged", monthlyFeePaise: "abc" },
]);
assert.equal(junk.monthlyFeePaise, 0, "an unparseable amount is not a charge");

const [negative] = riders([
  { id: "sr6", staffId: "stf_6", costMode: "charged", monthlyFeePaise: -50000 },
]);
assert.equal(negative.monthlyFeePaise, 0, "a negative fee is not a refund");

/* ── service mode is honoured but never invented ────────────── */

const modes = riders([
  { id: "a", staffId: "s", costMode: "free", serviceMode: "pickup" },
  { id: "b", staffId: "s", costMode: "free", serviceMode: "drop" },
  { id: "c", staffId: "s", costMode: "free", serviceMode: "nonsense" },
]);
assert.equal(modes[0].serviceMode, "pickup");
assert.equal(modes[1].serviceMode, "drop");
assert.equal(modes[2].serviceMode, "both", "an unknown mode falls back to both");

/* ── an ended ride keeps its end date ───────────────────────── */

const [ended] = riders([
  { id: "sr7", staffId: "stf_7", costMode: "free", effectiveTo: "2026-07-31" },
]);
assert.equal(ended.effectiveTo, "2026-07-31");

console.log("  ok");
