/**
 * Self-test: afternoon dismissal waves and vehicle sharing.
 * Run: npx tsx apps/web/src/lib/transportAfternoonWaves.selftest.ts
 *
 * The rule this exists to protect: a route whose round trip has never been
 * measured returns `unknown-round-trip`, never a verdict. Guessing here is how
 * you tell a school one vehicle is enough and leave five-year-olds at the gate.
 */

import assert from "node:assert/strict";

import {
  planAfternoonWaves,
  suggestVehicleSharing,
} from "./transportAfternoonWaves";
import type { MastersState } from "./masters";
import type { SisState } from "./sis";
import type { TransportState } from "./transport";

console.log("transportAfternoonWaves.selftest.ts");

const AY = "2026-27";

const classes = [
  { id: "c_nur", name: "Nursery", isActive: true },
  { id: "c_i", name: "I", isActive: true },
  { id: "c_ix", name: "IX", isActive: true },
];

function masters(overrides: { groupCode: string; endTime: string }[]): MastersState {
  return {
    classes,
    sections: [],
    schoolTiming: {
      default: {
        startTime: "08:00",
        endTime: "14:00",
        workingWeekdays: [1, 2, 3, 4, 5, 6],
        sundayExceptional: false,
        sundayStartTime: "",
        sundayEndTime: "",
      },
      groupOverrides: overrides.map((o, i) => ({
        id: `go_${i}`,
        groupCode: o.groupCode,
        timing: {
          startTime: "08:00",
          endTime: o.endTime,
          workingWeekdays: [1, 2, 3, 4, 5, 6],
          sundayExceptional: false,
          sundayStartTime: "",
          sundayEndTime: "",
        },
      })),
      classOverrides: [],
    },
  } as unknown as MastersState;
}

function sis(students: { id: string; classId: string }[]): SisState {
  return {
    students: students.map((s) => ({
      ...s,
      fullName: s.id,
      status: "active",
      academicYearCode: AY,
    })),
    households: [],
  } as unknown as SisState;
}

function state(
  routes: { id: string; bus: string; rtMin?: number }[],
  assignments: { student: string; route: string }[],
): TransportState {
  return {
    routes: routes.map((r) => ({
      id: r.id,
      code: r.id.toUpperCase(),
      name: r.bus,
      busNo: r.bus,
      vehicleReg: "",
      vehicleId: "",
      monthlyFeePaise: 0,
      isActive: true,
      stops: [],
      ...(r.rtMin ? { roundTripMinutes: r.rtMin } : {}),
    })),
    assignments: assignments.map((a, i) => ({
      id: `a${i}`,
      studentId: a.student,
      householdId: "",
      routeId: a.route,
      stopId: "",
      academicYearCode: AY,
      effectiveFrom: "2026-04-01",
      effectiveTo: null,
      monthlyFeePaise: 0,
      feeOverrideReason: "",
      boardingSuspended: false,
      createdAt: "",
    })),
  } as unknown as TransportState;
}

/* ── one dismissal time → one trip ──────────────────────────── */

const m1 = masters([]);
const s1 = sis([{ id: "s1", classId: "c_i" }, { id: "s2", classId: "c_ix" }]);
const p1 = planAfternoonWaves(
  state([{ id: "r1", bus: "BUS A", rtMin: 40 }], [
    { student: "s1", route: "r1" },
    { student: "s2", route: "r1" },
  ]),
  s1,
  m1,
  AY,
);
assert.equal(p1[0].verdict, "single-wave");
assert.equal(p1[0].waves.length, 1);
assert.equal(p1[0].riders, 2);

/* ── two dismissals, wide gap → one vehicle does both ───────── */

// Pre-primary out at 12:00, everyone else at 14:00 — a two-hour gap.
const m2 = masters([{ groupCode: "PRE_PRIMARY", endTime: "12:00" }]);
const s2 = sis([
  { id: "tiny", classId: "c_nur" },
  { id: "big", classId: "c_ix" },
]);
const p2 = planAfternoonWaves(
  state([{ id: "r1", bus: "BUS A", rtMin: 40 }], [
    { student: "tiny", route: "r1" },
    { student: "big", route: "r1" },
  ]),
  s2,
  m2,
  AY,
);
assert.equal(p2[0].verdict, "one-vehicle-two-trips");
assert.equal(p2[0].gapMinutes, 120);
assert.equal(p2[0].waves.length, 2);
assert.equal(p2[0].waves[0].endTime, "12:00", "waves sort earliest first");
assert.equal(p2[0].waves[1].endTime, "14:00");

/* ── same gap, slower route → needs a second vehicle ────────── */

const p3 = planAfternoonWaves(
  state([{ id: "r1", bus: "BUS A", rtMin: 115 }], [
    { student: "tiny", route: "r1" },
    { student: "big", route: "r1" },
  ]),
  s2,
  m2,
  AY,
);
assert.equal(p3[0].verdict, "needs-second-vehicle");
assert.ok(
  /waits 5 min/.test(p3[0].detail),
  `should quantify the wait, got: ${p3[0].detail}`,
);

// Exactly on the boundary counts as feasible: 120 gap, 110 round trip + 10.
const p4 = planAfternoonWaves(
  state([{ id: "r1", bus: "BUS A", rtMin: 110 }], [
    { student: "tiny", route: "r1" },
    { student: "big", route: "r1" },
  ]),
  s2,
  m2,
  AY,
);
assert.equal(p4[0].verdict, "one-vehicle-two-trips");

/* ── THE protection: never measured → never a verdict ───────── */

const p5 = planAfternoonWaves(
  state([{ id: "r1", bus: "BUS A" }], [
    { student: "tiny", route: "r1" },
    { student: "big", route: "r1" },
  ]),
  s2,
  m2,
  AY,
);
assert.equal(p5[0].verdict, "unknown-round-trip");
assert.equal(p5[0].roundTripMinutes, null);
assert.ok(/never been measured/.test(p5[0].detail));
// It still reports the gap, which is knowable without measuring.
assert.equal(p5[0].gapMinutes, 120);

/* ── empty bus is not a planning problem ────────────────────── */

const p6 = planAfternoonWaves(
  state([{ id: "r1", bus: "BUS A", rtMin: 40 }], []),
  s2,
  m2,
  AY,
);
assert.equal(p6[0].verdict, "no-riders");

/* ── no roster loaded → nothing claimed at all ──────────────── */

assert.deepEqual(
  planAfternoonWaves(state([{ id: "r1", bus: "BUS A" }], []), null, m2, AY),
  [],
);

/* ── vehicle sharing ────────────────────────────────────────── */

// Bus A carries only pre-primary (out 12:00, 40 min trip); Bus B only seniors
// (out 14:00). One vehicle could do both.
const shareState = state(
  [
    { id: "ra", bus: "BUS A", rtMin: 40 },
    { id: "rb", bus: "BUS B", rtMin: 45 },
  ],
  [
    { student: "tiny", route: "ra" },
    { student: "big", route: "rb" },
  ],
);
const plans = planAfternoonWaves(shareState, s2, m2, AY);
const shares = suggestVehicleSharing(plans);
assert.equal(shares.length, 1);
assert.equal(shares[0].earlyRouteLabel, "BUS A");
assert.equal(shares[0].lateRouteLabel, "BUS B");
assert.equal(shares[0].gapMinutes, 120);

// Reverse pairing is never suggested — a vehicle cannot serve the later route
// first and then go back in time.
assert.equal(
  shares.some((x) => x.earlyRouteLabel === "BUS B"),
  false,
);

// An unmeasured route is never offered for sharing.
const unmeasured = planAfternoonWaves(
  state(
    [
      { id: "ra", bus: "BUS A" },
      { id: "rb", bus: "BUS B", rtMin: 45 },
    ],
    [
      { student: "tiny", route: "ra" },
      { student: "big", route: "rb" },
    ],
  ),
  s2,
  m2,
  AY,
);
assert.deepEqual(suggestVehicleSharing(unmeasured), []);

console.log("  ok");
