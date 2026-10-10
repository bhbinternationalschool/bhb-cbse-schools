/**
 * Self-test: every month in the range gets a row.
 * Run: npx tsx apps/web/src/lib/ledgerMonthlyCash.selftest.ts
 *
 * Reported 2026-09-16: "money in / money out only shows April". The database
 * had all six months; the reply did not. The dashboard pulled every cash
 * movement of the year through `ledger_cash_movements` — one row per voucher
 * PER HEAD, 3,147 of them — and PostgREST caps a reply at 1,000. All 1,000
 * fell inside April. Nothing errored; the chart simply had one bar.
 *
 * The arithmetic now happens in `ledger_monthly_cash` (migration
 * 20260916120000), which returns one row per month — six rows, no cap. What
 * is left here is the part that still has to be right in TypeScript: every
 * month in the range gets a row, in order, whether or not money moved.
 *
 * The SQL's own two rules (one voucher counted once; reversals and
 * `void_redate` corrections excluded) were verified against production the
 * day it was written — April ₹10,59,254 in / ₹11,52,460 out, September
 * ₹5,60,568 in / ₹50,000 out, against gross figures of ₹22.29 lakh and
 * ₹7.73 lakh.
 */

import assert from "node:assert/strict";

import { monthlyCashRows, monthLabel } from "./ledger/reports";

console.log("ledgerMonthlyCash.selftest.ts");

/* ── A quiet month still gets a row ─────────────────────────────────── */

const withGap = monthlyCashRows({
  from: "2026-04-01",
  to: "2026-09-16",
  totals: [
    { month: "2026-04", inPaise: 1059254_32, outPaise: 1152459_84 },
    { month: "2026-09", inPaise: 560568_00, outPaise: 50000_00 },
  ],
});

assert.deepEqual(
  withGap.map((r) => r.month),
  ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"],
  "all six months — this is the assertion the production bug would fail",
);
assert.equal(withGap[1]!.inPaise, 0, "May saw nothing and says so");
assert.equal(withGap[1]!.netPaise, 0);
assert.equal(withGap[0]!.inPaise, 1059254_32);
assert.equal(
  withGap[0]!.netPaise,
  1059254_32 - 1152459_84,
  "net is in minus out, and may be negative",
);
assert.equal(withGap[5]!.netPaise, 560568_00 - 50000_00);

/* ── Months the database did not mention are zero, not missing ──────── */

const empty = monthlyCashRows({ from: "2026-04-01", to: "2026-06-30", totals: [] });
assert.equal(empty.length, 3, "a book with no cash still shows its months");
assert.ok(empty.every((r) => r.inPaise === 0 && r.outPaise === 0));

/* ── A single month range is one row, not none ──────────────────────── */

const one = monthlyCashRows({
  from: "2026-09-01",
  to: "2026-09-30",
  totals: [{ month: "2026-09", inPaise: 100, outPaise: 0 }],
});
assert.equal(one.length, 1);
assert.equal(one[0]!.month, "2026-09");

/* ── A month outside the range is ignored, never appended ───────────── */

const outside = monthlyCashRows({
  from: "2026-08-01",
  to: "2026-09-16",
  totals: [
    { month: "2026-03", inPaise: 999999, outPaise: 0 },
    { month: "2026-09", inPaise: 100, outPaise: 50 },
  ],
});
assert.deepEqual(outside.map((r) => r.month), ["2026-08", "2026-09"]);
assert.equal(
  outside.reduce((s, r) => s + r.inPaise, 0),
  100,
  "March's money must not leak into a range that does not include it",
);

/* ── The label is what the office reads ─────────────────────────────── */

assert.ok(monthLabel("2026-04").startsWith("Apr"), monthLabel("2026-04"));
assert.ok(monthLabel("2026-09").includes("2026"));

console.log("  ok — every month in the range gets a row, in order");
