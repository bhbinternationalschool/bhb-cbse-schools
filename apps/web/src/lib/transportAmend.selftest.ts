/**
 * Self-test: changing a rider's stop / route / fee mid-session.
 * Run: npx tsx apps/web/src/lib/transportAmend.selftest.ts
 *
 * The invariant: a change never reaches back into a month the family has
 * already paid. Paid months keep the fee they were collected at; the change
 * applies from the first unpaid month onward.
 */

import assert from "node:assert/strict";

import {
  firstUnpaidTransportMonth,
  paidTransportMonths,
  planTransportAmendment,
} from "./transportAmend";
import type { FeeDueLine } from "./fees";

console.log("transportAmend.selftest.ts");

function due(
  month: string,
  opts: { kind?: string; billed?: number; paid?: number } = {},
): FeeDueLine {
  const billed = opts.billed ?? 50000;
  const paid = opts.paid ?? 0;
  return {
    dueKey: `${opts.kind ?? "transport"}:${month}`,
    kind: (opts.kind ?? "transport") as FeeDueLine["kind"],
    dueOn: `${month}-10`,
    billedPaise: billed,
    paidPaise: paid,
    balancePaise: billed - paid,
  } as unknown as FeeDueLine;
}

/* ── reading the ledger ─────────────────────────────────────── */

const ledger = [
  due("2026-04", { paid: 50000 }),
  due("2026-05", { paid: 50000 }),
  due("2026-06", { paid: 50000 }),
  due("2026-07"), // unpaid
  due("2026-08"), // unpaid
  // Academic dues must be ignored entirely — they are not transport.
  due("2026-04", { kind: "academic", paid: 0 }),
];

assert.deepEqual(paidTransportMonths(ledger), ["2026-04", "2026-05", "2026-06"]);
assert.equal(firstUnpaidTransportMonth(ledger), "2026-07");

// A part-paid month is NOT paid — the balance still stands.
assert.equal(
  firstUnpaidTransportMonth([due("2026-04", { billed: 50000, paid: 20000 })]),
  "2026-04",
);

// Nothing billed yet → null, meaning "no constraint", not "all paid".
assert.equal(firstUnpaidTransportMonth([]), null);
assert.deepEqual(paidTransportMonths([]), []);

/* ── the plan ───────────────────────────────────────────────── */

const plan = planTransportAmendment({
  dues: ledger,
  currentEffectiveFrom: "2026-04-01",
  currentMonth: "2026-08",
});
assert.equal(plan.ok, true);
if (plan.ok) {
  assert.equal(plan.plan.fromMonth, "2026-07", "starts at the first unpaid month");
  assert.equal(plan.plan.newEffectiveFrom, "2026-07-01");
  assert.equal(
    plan.plan.endCurrentOn,
    "2026-06-30",
    "old assignment closes the day before, keeping June priced as collected",
  );
  assert.deepEqual(plan.plan.paidMonths, ["2026-04", "2026-05", "2026-06"]);
  assert.deepEqual(plan.plan.repricedMonths, ["2026-07", "2026-08"]);
}

/* ── THE protection ─────────────────────────────────────────── */

// Backdating into a paid month is refused outright.
const backdated = planTransportAmendment({
  dues: ledger,
  requestedMonth: "2026-05",
  currentEffectiveFrom: "2026-04-01",
  currentMonth: "2026-08",
});
assert.equal(backdated.ok, false);
assert.ok(
  backdated.ok === false && /already paid/.test(backdated.error),
  "must say why, naming the paid boundary",
);

// Even the last paid month is out of reach.
assert.equal(
  planTransportAmendment({
    dues: ledger,
    requestedMonth: "2026-06",
    currentEffectiveFrom: "2026-04-01",
    currentMonth: "2026-08",
  }).ok,
  false,
);

/* ── pushing the change later is allowed ────────────────────── */

const later = planTransportAmendment({
  dues: ledger,
  requestedMonth: "2026-10",
  currentEffectiveFrom: "2026-04-01",
  currentMonth: "2026-08",
});
assert.equal(later.ok, true);
if (later.ok) {
  assert.equal(later.plan.fromMonth, "2026-10");
  assert.equal(later.plan.endCurrentOn, "2026-09-30");
}

// Year boundary: December → January closes on 31 Dec.
const acrossYear = planTransportAmendment({
  dues: ledger,
  requestedMonth: "2027-01",
  currentEffectiveFrom: "2026-04-01",
  currentMonth: "2026-08",
});
assert.equal(acrossYear.ok, true);
if (acrossYear.ok) {
  assert.equal(acrossYear.plan.endCurrentOn, "2026-12-31");
}

// Leap-year February is handled by the date maths, not a lookup table.
const marchLeap = planTransportAmendment({
  dues: [],
  requestedMonth: "2028-03",
  currentEffectiveFrom: "2027-04-01",
  currentMonth: "2028-01",
});
assert.equal(marchLeap.ok, true);
if (marchLeap.ok) assert.equal(marchLeap.plan.endCurrentOn, "2028-02-29");

/* ── nothing billed yet ─────────────────────────────────────── */

const fresh = planTransportAmendment({
  dues: [],
  currentEffectiveFrom: "2026-04-01",
  currentMonth: "2026-09",
});
assert.equal(fresh.ok, true);
if (fresh.ok) {
  assert.equal(fresh.plan.fromMonth, "2026-09", "falls back to the current month");
  assert.deepEqual(fresh.plan.paidMonths, []);
}

/* ── splitting at or before the start makes no sense ────────── */

const atStart = planTransportAmendment({
  dues: [],
  requestedMonth: "2026-04",
  currentEffectiveFrom: "2026-04-01",
  currentMonth: "2026-04",
});
assert.equal(atStart.ok, false);
assert.ok(
  atStart.ok === false && /Edit it directly/.test(atStart.error),
  "a split with nothing before it should be an edit, and should say so",
);

console.log("  ok");
