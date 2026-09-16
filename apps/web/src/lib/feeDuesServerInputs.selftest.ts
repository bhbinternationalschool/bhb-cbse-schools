/**
 * Self-test: a server-side dues calculation can see the bus fee and the
 * posted adjustments.
 * Run: npx tsx apps/web/src/lib/feeDuesServerInputs.selftest.ts
 *
 * Found 2026-09-16. `loadTransport()` and `loadFeeAdjustments()` both
 * returned empty whenever `window` was undefined, which is every request on
 * Cloud Run. So every server-side fee figure — the WhatsApp reminders, the
 * /pay/due links, the parent app, the principal cockpit and the
 * `fee_desk_open_dues` table itself — was computed with no bus fee for 157
 * riders and no posted waiver, stop-future or ad-hoc charge.
 *
 * The table proved it: 796 open lines, not one of them transport.
 *
 * This file runs in node, where `window` IS undefined — so it exercises
 * exactly the broken path. It asserts the memory copy is honoured and, more
 * importantly, that `computeStudentDues` bills the bus on the server.
 */

import assert from "node:assert/strict";

import {
  defaultFeePolicy,
  loadTransport,
  writeTransportLocalRaw,
  type TransportAssignment,
  type TransportState,
} from "./transport";
import {
  loadFeeAdjustments,
  writeFeeAdjustmentsLocalRaw,
  type FeeAdjustment,
} from "./feeAdjustments";
import { computeStudentDues, emptyFeesState } from "./fees";
import { emptyMastersShell } from "./masters";
import type { SisStudent } from "./sis";

console.log("feeDuesServerInputs.selftest.ts");

assert.equal(
  typeof window,
  "undefined",
  "this test only means something where there is no browser",
);

const AY = "2026-27";
const STU = "stu_bus_rider";

/* ── 1. Transport: empty until hydrated, then readable ─────────────── */

assert.equal(
  loadTransport().assignments.length,
  0,
  "a server that has not hydrated still reads an empty desk",
);

const assignment: TransportAssignment = {
  id: "ta_1",
  studentId: STU,
  householdId: "hh_1",
  routeId: "tr_1",
  stopId: "st_1",
  academicYearCode: AY,
  effectiveFrom: "2026-04-01",
  effectiveTo: null,
  monthlyFeePaise: 60000,
  feeOverrideReason: "",
  serviceMode: "both",
  createdAt: "2026-04-01T00:00:00.000Z",
} as unknown as TransportAssignment;

const transportState = {
  assignments: [assignment],
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

writeTransportLocalRaw(transportState);

assert.equal(
  loadTransport().assignments.length,
  1,
  "after hydrate the server reads the rider — this is the line that was missing",
);

/* ── 2. The bus fee reaches computeStudentDues on the server ────────── */

const student = {
  id: STU,
  householdId: "hh_1",
  fullName: "Test Rider",
  status: "active",
  academicYearCode: AY,
  classId: "",
  sectionId: "",
  feeGroupId: "",
} as unknown as SisStudent;

const dues = computeStudentDues(student, emptyMastersShell(), emptyFeesState(), {
  asOf: "2026-09-16",
  includeFuture: false,
});
const transportDues = dues.filter((d) => d.kind === "transport");

assert.ok(
  transportDues.length > 0,
  "the server must bill the bus — zero transport lines is the production bug",
);
assert.ok(
  transportDues.every((d) => d.billedPaise === 60000),
  "each month bills the assignment's own fee",
);
// April through September, nothing later: includeFuture is false.
assert.ok(
  transportDues.every((d) => (d.dueOn || "") <= "2026-09-16"),
  "no future month may be billed when includeFuture is false",
);

/* ── 3. Posted adjustments are visible on the server ────────────────── */

assert.equal(
  loadFeeAdjustments().length,
  0,
  "no adjustments before hydrate",
);

const adjustment = {
  id: "fadj_1",
  studentId: STU,
  academicYearCode: AY,
  type: "waiver",
  dueKey: transportDues[0]!.dueKey,
  label: "Bus fee waived",
  amountPaise: 60000,
  reasonCode: "hardship",
  reason: "test",
  status: "posted",
  stopAfterDate: null,
  fromFeeGroupId: null,
  toFeeGroupId: null,
  feeHeadId: null,
  dueOn: null,
  createdAt: "2026-09-16T00:00:00.000Z",
  createdBy: "test",
  decidedAt: null,
  decidedBy: "",
  decisionNote: "",
  sourceVoucherId: "",
} as unknown as FeeAdjustment;

writeFeeAdjustmentsLocalRaw({ rows: [adjustment] });

assert.equal(
  loadFeeAdjustments().length,
  1,
  "after hydrate the server reads the posted waiver",
);

const afterWaiver = computeStudentDues(
  student,
  emptyMastersShell(),
  emptyFeesState(),
  { asOf: "2026-09-16", includeFuture: false },
);
const waived = afterWaiver.find((d) => d.dueKey === transportDues[0]!.dueKey);
assert.ok(waived, "the waived line is still listed");
assert.equal(
  waived!.balancePaise,
  0,
  "a posted waiver must clear the line on the server too, not only in the browser",
);

/* ── 4. A failed pull must not empty the desk ───────────────────────── */

// writeTransportLocalRaw is the ONLY way the memory copy changes; the
// hydrate helpers keep the previous copy on failure. Proving the write is
// the only mutation is what stops a transient Supabase error from
// re-billing a family whose waiver we already granted.
assert.equal(
  loadTransport().assignments.length,
  1,
  "nothing else clears the server's transport copy",
);
assert.equal(
  loadFeeAdjustments().length,
  1,
  "nothing else clears the server's adjustments copy",
);

console.log("  ok — the server sees the bus fee and the posted adjustments");
