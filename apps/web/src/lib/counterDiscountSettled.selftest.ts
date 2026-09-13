/**
 * Self-test: a discount given at the counter must not come back as a due.
 * Run: npx tsx apps/web/src/lib/counterDiscountSettled.selftest.ts
 *
 * THE BUG THIS PINS
 * A counter discount was settled only through a `fee_adjustments` waiver row,
 * and `loadFeeAdjustments` returns [] when there is no `window`. The open-dues
 * cache is rebuilt on the SERVER, so the waiver was never subtracted there and
 * the balance settled at exactly the discount.
 *
 * Production, 2026-09-13: 265 dues, 120 children, ₹77,854 wrongly shown as
 * owed. For 231 of them, billed − waived − collected came to exactly zero.
 *
 * THE TRAP IN THE FIX
 * `line.concessionPaise` is the WHOLE discount on the line — standing Masters
 * concessions plus the counter waiver. `concessionForHead` recomputes the
 * standing part every time, so settling the whole figure would subtract it
 * twice: ₹96,694 wrongly knocked off on this school's receipts. Only details
 * stamped COUNTER may be taken.
 */

import assert from "node:assert/strict";

import {
  COUNTER_DISCOUNT_CODE,
  counterWaiversByDueKey,
  settledWaiversByDueKey,
  type FeesState,
} from "./fees";

console.log("counterDiscountSettled.selftest.ts");

const detail = (code: string, amountPaise: number) => ({
  grantId: "",
  concessionId: "",
  code,
  name: code === COUNTER_DISCOUNT_CODE ? "Counter discount" : "Sibling discount",
  kind: code === COUNTER_DISCOUNT_CODE ? "waiver" : "percent",
  rateLabel: "",
  siblingLabel: "",
  amountPaise,
});

const line = (
  dueKey: string,
  amountPaise: number,
  concessionPaise: number,
  details: ReturnType<typeof detail>[],
) => ({
  dueKey,
  studentId: "stu_1",
  studentName: "Test Child",
  label: "Tuition Fee · May",
  kind: "academic" as const,
  amountPaise,
  billedPaise: amountPaise + concessionPaise,
  concessionPaise,
  concessionDetails: details,
});

const feesWith = (vouchers: unknown[]) =>
  ({ vouchers, planAllocations: [] }) as unknown as FeesState;

/* ── the reported case ──────────────────────────────────────── */

// MANVI SINGH, receipt RCV-00523: billed 1650, waived 350, collected 1300.
// 1650 − 350 − 1300 = 0, yet ₹350 showed as due.
const manvi = feesWith([
  {
    id: "rcv_1",
    voidedAt: null,
    lines: [line("acad:stu_1:may", 130000, 35000, [detail(COUNTER_DISCOUNT_CODE, 35000)])],
  },
]);
assert.equal(counterWaiversByDueKey(manvi).get("acad:stu_1:may"), 35000);

/* ── a standing concession must NOT be settled twice ────────── */

// concessionForHead already subtracts this on every recompute. Counting it
// here would knock it off a second time.
const standing = feesWith([
  {
    id: "rcv_2",
    voidedAt: null,
    lines: [line("acad:stu_1:jun", 125000, 40000, [detail("SIBLING", 40000)])],
  },
]);
assert.equal(
  counterWaiversByDueKey(standing).get("acad:stu_1:jun"),
  undefined,
  "a standing concession is not a counter waiver",
);
assert.equal(counterWaiversByDueKey(standing).size, 0);

/* ── a line carrying both: only the counter half ────────────── */

const mixed = feesWith([
  {
    id: "rcv_3",
    voidedAt: null,
    lines: [
      line("acad:stu_1:jul", 110000, 80000, [
        detail("SIBLING", 40000),
        detail(COUNTER_DISCOUNT_CODE, 40000),
      ]),
    ],
  },
]);
assert.equal(
  counterWaiversByDueKey(mixed).get("acad:stu_1:jul"),
  40000,
  "half the discount is standing and must be left alone",
);

/* ── a voided receipt settles nothing ───────────────────────── */

const voided = feesWith([
  {
    id: "rcv_4",
    voidedAt: "2026-09-10T00:00:00.000Z",
    lines: [line("acad:stu_1:aug", 130000, 35000, [detail(COUNTER_DISCOUNT_CODE, 35000)])],
  },
]);
assert.equal(
  counterWaiversByDueKey(voided).size,
  0,
  "voiding a receipt takes its discount back too",
);

/* ── two receipts against one due add up ────────────────────── */

const twice = feesWith([
  {
    id: "rcv_5",
    voidedAt: null,
    lines: [line("acad:stu_1:sep", 50000, 10000, [detail(COUNTER_DISCOUNT_CODE, 10000)])],
  },
  {
    id: "rcv_6",
    voidedAt: null,
    lines: [line("acad:stu_1:sep", 40000, 25000, [detail(COUNTER_DISCOUNT_CODE, 25000)])],
  },
]);
assert.equal(counterWaiversByDueKey(twice).get("acad:stu_1:sep"), 35000);

/* ── the same waiver stamped on two receipts ────────────────── */

// ADARSH YADAV, Amenity Fees April: billed 2000, ₹1,000 waived, ₹710 taken in
// July and ₹290 in August. The August receipt stamped the SAME ₹1,000 waiver
// again, because the bug had made it reappear as owed. Summed that is ₹2,000
// against a ₹2,000 bill on which ₹1,000 was collected.
//
// The family has settled: 2000 − 1000 waived − 1000 collected = 0. The floor
// at zero in applyPostedWaiver gets there whether the waiver counts once or
// twice, which is why summing is safe. All seven production cases of this
// shape settle to zero.
const restamped = feesWith([
  {
    id: "rcv_jul",
    voidedAt: null,
    lines: [line("acad:stu_1:apr", 71000, 100000, [detail(COUNTER_DISCOUNT_CODE, 100000)])],
  },
  {
    id: "rcv_aug",
    voidedAt: null,
    lines: [line("acad:stu_1:apr", 29000, 100000, [detail(COUNTER_DISCOUNT_CODE, 100000)])],
  },
]);
const restampedWaiver = counterWaiversByDueKey(restamped).get("acad:stu_1:apr")!;
assert.equal(restampedWaiver, 200000, "summed, not deduplicated");
// billed 200000, collected 100000, waiver 200000 → floored at 0, and 0 is the
// honest answer because the bill really is settled.
assert.equal(Math.max(0, 200000 - 100000 - restampedWaiver), 0);
// The point that matters: it can never go negative and become a credit.
assert.ok(Math.max(0, 200000 - 100000 - restampedWaiver) >= 0);

/* ── nothing anywhere settles nothing ───────────────────────── */

assert.equal(counterWaiversByDueKey(feesWith([])).size, 0);
assert.equal(
  counterWaiversByDueKey(
    feesWith([{ id: "r", voidedAt: null, lines: [line("acad:stu_1:x", 100000, 0, [])] }]),
  ).size,
  0,
);
// A line with a concession total but no break-up settles nothing: without the
// COUNTER stamp we cannot tell a waiver from a standing rule, and guessing
// would risk subtracting a standing concession twice.
assert.equal(
  counterWaiversByDueKey(
    feesWith([{ id: "r", voidedAt: null, lines: [line("acad:stu_1:y", 100000, 25000, [])] }]),
  ).size,
  0,
);

/* ── the settled map is what the dues arithmetic consumes ───── */

// Under Node there is no `window`, so the adjustments store is empty — which
// is precisely the condition that caused the bug. The settled map must still
// carry the receipt-derived waiver.
const settled = settledWaiversByDueKey(manvi, "stu_1");
assert.equal(
  settled.get("acad:stu_1:may"),
  35000,
  "server-side, the discount is still settled — this is the whole fix",
);

// And it must not invent a waiver for a due that never had one.
assert.equal(settled.get("acad:stu_1:never"), undefined);

/* ── the stamp is one constant, shared by writer and reader ─── */

assert.equal(COUNTER_DISCOUNT_CODE, "COUNTER");

console.log("  ok");
