/**
 * Self-test: one month, one transport charge.
 * Run: npx tsx apps/web/src/lib/transportOverlapBilling.selftest.ts
 *
 * Twelve riders were billed twice (two of them three times) for Apr-Aug 2026
 * because a re-assignment back-dated to before the row it replaced left that
 * row open, so both covered the same months. Billing must survive that data
 * shape, and assignTransport must stop producing it.
 */

import assert from "node:assert/strict";

import {
  computeTransportPeriodDues,
  overlappingAssignments,
} from "./transport";
import { defaultFeePolicy } from "./transport";
import type { TransportAssignment, TransportState } from "./transport";

console.log("transportOverlapBilling.selftest.ts");

const AY = "2026-27";
const STU = "stu_test";

function asg(p: Partial<TransportAssignment>): TransportAssignment {
  return {
    id: "ta_x",
    studentId: STU,
    householdId: "hh_1",
    routeId: "tr_1",
    stopId: "st_1",
    academicYearCode: AY,
    effectiveFrom: "2026-04-01",
    effectiveTo: null,
    monthlyFeePaise: 100000,
    feeOverrideReason: "",
    serviceMode: "both",
    createdAt: "2026-04-01T00:00:00.000Z",
    ...p,
  } as TransportAssignment;
}

function stateWith(assignments: TransportAssignment[]): TransportState {
  return {
    assignments,
    routes: [
      {
        id: "tr_1",
        code: "R1",
        name: "Route 1",
        isActive: true,
        busNo: "1",
        vehicleReg: "",
        vehicleId: "",
        stops: [{ id: "st_1", name: "Stop 1" }],
      },
    ],
    vehicles: [],
    feePolicy: defaultFeePolicy(AY),
  } as unknown as TransportState;
}

/* ── Shaurya Shrivastava's real shape: three rows, all from the same day ── */
const shaurya = stateWith([
  asg({ id: "ta_a", effectiveFrom: "2026-05-01", effectiveTo: "2026-08-22", createdAt: "2026-08-22T20:07:58.452Z" }),
  asg({ id: "ta_b", effectiveFrom: "2026-05-01", effectiveTo: "2026-08-29", createdAt: "2026-08-22T20:13:49.069Z" }),
  asg({ id: "ta_c", effectiveFrom: "2026-05-01", effectiveTo: null, monthlyFeePaise: 70000, createdAt: "2026-08-29T08:59:42.098Z" }),
]);

const dues = computeTransportPeriodDues(STU, { academicYearCode: AY, state: shaurya });
const byMonth = new Map<string, number>();
for (const d of dues) byMonth.set(d.periodKey, (byMonth.get(d.periodKey) ?? 0) + 1);
for (const [period, n] of byMonth) {
  assert.equal(n, 1, `${period} billed ${n} times — must be exactly once`);
}
assert.ok(dues.length > 0, "expected some transport dues");

// The newest assignment wins, so the corrected ₹700 fee is what bills.
const june = dues.find((d) => d.periodKey === "2026-06");
assert.ok(june, "June should bill");
assert.equal(june!.amountPaise, 70000, "newest assignment's fee should win");
assert.equal(june!.assignmentId, "ta_c");

// The fault is still reported for the office to correct.
assert.equal(
  overlappingAssignments(STU, { academicYearCode: AY, state: shaurya }).length,
  3,
  "three overlapping pairs should be surfaced",
);

/* ── A clean history bills once per month and is not flagged ── */
const clean = stateWith([
  asg({ id: "ta_1", effectiveFrom: "2026-04-01", effectiveTo: "2026-07-31", createdAt: "2026-04-01T00:00:00.000Z" }),
  asg({ id: "ta_2", effectiveFrom: "2026-08-01", effectiveTo: null, createdAt: "2026-08-01T00:00:00.000Z" }),
]);
const cleanDues = computeTransportPeriodDues(STU, { academicYearCode: AY, state: clean });
const cleanMonths = new Set(cleanDues.map((d) => d.periodKey));
assert.equal(cleanMonths.size, cleanDues.length, "no month billed twice");
assert.equal(
  overlappingAssignments(STU, { academicYearCode: AY, state: clean }).length,
  0,
  "consecutive assignments do not overlap",
);

/* ── A zero-length row (superseded by a back-dated re-assignment) bills nothing ── */
const superseded = stateWith([
  asg({ id: "ta_old", effectiveFrom: "2026-05-01", effectiveTo: "2026-05-01", createdAt: "2026-05-01T00:00:00.000Z" }),
]);
assert.equal(
  computeTransportPeriodDues(STU, { academicYearCode: AY, state: superseded }).length,
  0,
  "a zero-length assignment must bill nothing",
);

console.log("OK — transportOverlapBilling.selftest.ts");
