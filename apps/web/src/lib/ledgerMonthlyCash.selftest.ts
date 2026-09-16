/**
 * Self-test: month-by-month money in and money out.
 * Run: npx tsx apps/web/src/lib/ledgerMonthlyCash.selftest.ts
 *
 * Two rules decide whether the Accounts dashboard tells the truth, and the
 * obvious version of this code gets both wrong:
 *
 *  1. `ledger_cash_movements` returns one row per voucher PER HEAD, with the
 *     voucher's cash total repeated on each. Summing the rows counts a
 *     voucher once per expense head it touches.
 *  2. A reversal and the entry it cancels are one correction, not two
 *     movements of money. Counted gross, April 2026 read ₹22.29 lakh in and
 *     ₹22.99 lakh out; what actually moved was ₹10.59 lakh and ₹12.82 lakh.
 *     162 of that month's cash vouchers were reversals.
 */

import assert from "node:assert/strict";

import { summariseMonthlyCash, type CashLeg } from "./ledger/reports";

console.log("ledgerMonthlyCash.selftest.ts");

const leg = (
  voucherId: string,
  voucherDate: string,
  cashSignedPaise: number,
): CashLeg => ({ voucherId, voucherDate, cashSignedPaise });

/* ── One voucher across three heads is one movement ─────────────────── */

const split = summariseMonthlyCash({
  from: "2026-04-01",
  to: "2026-04-30",
  legs: [
    leg("v1", "2026-04-10", -300000),
    leg("v1", "2026-04-10", -300000),
    leg("v1", "2026-04-10", -300000),
  ],
  cancelledVoucherIds: new Set(),
});
assert.equal(split.length, 1);
assert.equal(
  split[0]!.outPaise,
  300000,
  "a payment split over three heads is ₹3,000 out, not ₹9,000",
);

/* ── A reversal and its original both drop out ──────────────────────── */

const withReversal = summariseMonthlyCash({
  from: "2026-04-01",
  to: "2026-04-30",
  legs: [
    leg("good", "2026-04-02", 500000),
    leg("wrong", "2026-04-03", 700000),
    leg("undo", "2026-04-04", -700000),
  ],
  cancelledVoucherIds: new Set(["wrong", "undo"]),
});
assert.equal(
  withReversal[0]!.inPaise,
  500000,
  "only the receipt that stood counts as money in",
);
assert.equal(
  withReversal[0]!.outPaise,
  0,
  "and its reversal is not an expense — that is the ₹11 lakh April error",
);

/* ── An April entry reversed in July drops out of April ─────────────── */

const laterReversal = summariseMonthlyCash({
  from: "2026-04-01",
  to: "2026-07-31",
  legs: [
    leg("apr", "2026-04-10", 900000),
    leg("jul", "2026-07-10", -900000),
  ],
  cancelledVoucherIds: new Set(["apr", "jul"]),
});
assert.equal(
  laterReversal.find((r) => r.month === "2026-04")!.inPaise,
  0,
  "a correction made in July also corrects April, which is the month the office reads",
);

/* ── Empty months are shown, not skipped ────────────────────────────── */

const withGap = summariseMonthlyCash({
  from: "2026-04-01",
  to: "2026-07-15",
  legs: [leg("v1", "2026-04-10", 100000), leg("v2", "2026-07-01", 200000)],
  cancelledVoucherIds: new Set(),
});
assert.deepEqual(
  withGap.map((r) => r.month),
  ["2026-04", "2026-05", "2026-06", "2026-07"],
  "May and June are shown as zero — a missing row would read as 'not entered yet'",
);
assert.equal(withGap[1]!.inPaise, 0);
assert.equal(withGap[1]!.netPaise, 0);

/* ── Net is in minus out, and labels are readable ───────────────────── */

const net = summariseMonthlyCash({
  from: "2026-09-01",
  to: "2026-09-30",
  legs: [leg("a", "2026-09-05", 785063_00), leg("b", "2026-09-07", -295195_00)],
  cancelledVoucherIds: new Set(),
});
assert.equal(net[0]!.netPaise, 785063_00 - 295195_00);
assert.ok(
  net[0]!.label.startsWith("Sep"),
  `month label should read like "Sep 2026", got ${net[0]!.label}`,
);

console.log("  ok — one voucher counted once, corrections cancelled, no month hidden");
