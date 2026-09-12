/**
 * Self-test: how full a bus is, and refusing to pretend when nobody knows.
 * Run: npx tsx apps/web/src/lib/transportSeats.selftest.ts
 *
 * The rule this exists to protect: a vehicle whose seat capacity nobody has
 * recorded reads as `known: false`, never as "full" and never as forty seats.
 * On 2026-09-12 every vehicle in the fleet stored exactly 40 — the old
 * normalizer default — while the buses are a Tata Magic (about 7), a Winger
 * (about 13) and a van. Either reading of that number does real harm: "full"
 * refuses a child a seat that exists, and "40" seats a child on a van that is
 * already overloaded.
 */

import assert from "node:assert/strict";

import { rankStopsNearPoint } from "./transportPlanner";
import {
  describeRouteSeats,
  normalizeVehicle,
  seatsOnRoute,
  type FleetVehicle,
  type TransportAssignment,
  type TransportRoute,
  type TransportState,
} from "./transport";

console.log("transportSeats.selftest.ts");

function asg(studentId: string, routeId: string, ay = "2026-27"): TransportAssignment {
  return {
    id: `a_${studentId}`,
    studentId,
    householdId: "",
    routeId,
    stopId: "st1",
    academicYearCode: ay,
    effectiveFrom: "2026-04-01",
    effectiveTo: null,
    monthlyFeePaise: 0,
    feeOverrideReason: "",
    boardingSuspended: false,
    createdAt: "2026-04-01T00:00:00.000Z",
  };
}

function pinnedStop() {
  return {
    id: "st1",
    name: "Ayar Mod",
    sequence: 1,
    distanceKm: 4,
    geoLat: 25.44,
    geoLng: 82.95,
    distanceSource: "google" as const,
  };
}

function state(
  vehicles: Partial<FleetVehicle>[],
  assignments: TransportAssignment[],
  routeVehicleId = "v1",
): TransportState {
  const route = {
    id: "r1",
    code: "R-01",
    name: "Ayar",
    busNo: "Winger",
    vehicleReg: "UP65 MT 0849",
    vehicleId: routeVehicleId,
    monthlyFeePaise: 0,
    isActive: true,
    stops: [],
    shifts: [],
  } as TransportRoute;
  return {
    version: 2,
    routes: [route],
    assignments,
    vehicles: vehicles.map((v) => normalizeVehicle(v)),
  } as unknown as TransportState;
}

/* ── The normalizer must not invent forty seats ── */
{
  assert.equal(
    normalizeVehicle({ id: "v1" }).seatCapacity,
    0,
    "a vehicle nobody measured has an unrecorded capacity, not a default one",
  );
  assert.equal(normalizeVehicle({ id: "v1", seatCapacity: 0 }).seatCapacity, 0);
  assert.equal(normalizeVehicle({ id: "v1", seatCapacity: 13 }).seatCapacity, 13);
  assert.equal(
    normalizeVehicle({ id: "v1", seatCapacity: -4 }).seatCapacity,
    0,
    "a negative capacity is nonsense, not a small bus",
  );
  assert.equal(normalizeVehicle({ id: "v1", seatCapacity: 12.6 }).seatCapacity, 13);
}

/* ── Unrecorded capacity is its own answer ── */
{
  const s = state([{ id: "v1" }], [asg("s1", "r1"), asg("s2", "r1")]);
  const seats = seatsOnRoute(s, "r1");
  assert.equal(seats.known, false);
  assert.equal(seats.used, 2);
  assert.equal(
    describeRouteSeats(seats),
    "2 riders · seats not recorded for this vehicle",
  );
  // The shape must not tempt a caller into arithmetic.
  assert.equal((seats as { left?: number }).left, undefined);
  assert.equal((seats as { full?: boolean }).full, undefined);
}

/* ── A recorded capacity answers properly ── */
{
  const s = state(
    [{ id: "v1", seatCapacity: 13 }],
    ["s1", "s2", "s3"].map((id) => asg(id, "r1")),
  );
  const seats = seatsOnRoute(s, "r1");
  assert.equal(seats.known, true);
  if (!seats.known) throw new Error("unreachable");
  assert.equal(seats.capacity, 13);
  assert.equal(seats.used, 3);
  assert.equal(seats.left, 10);
  assert.equal(seats.full, false);
  assert.equal(describeRouteSeats(seats), "10 of 13 seats free");
}

/* ── Full, and over-full, are both "full" and never negative ── */
{
  const riders = Array.from({ length: 14 }, (_, i) => asg(`s${i}`, "r1"));
  const seats = seatsOnRoute(state([{ id: "v1", seatCapacity: 13 }], riders), "r1");
  assert.equal(seats.known, true);
  if (!seats.known) throw new Error("unreachable");
  assert.equal(seats.full, true);
  assert.equal(seats.left, 0, "over capacity leaves zero seats, not minus one");
  assert.equal(describeRouteSeats(seats), "full — 14 of 13");
}

/* ── The child being moved must not count against their own seat ── */
{
  const riders = Array.from({ length: 13 }, (_, i) => asg(`s${i}`, "r1"));
  const s = state([{ id: "v1", seatCapacity: 13 }], riders);

  const withThem = seatsOnRoute(s, "r1");
  assert.equal(withThem.known && withThem.full, true, "the bus is full");

  // s0 is already aboard and is only changing stop. Counting them against
  // their own seat would refuse a move that frees nothing and takes nothing.
  const withoutThem = seatsOnRoute(s, "r1", { exceptStudentId: "s0" });
  assert.equal(withoutThem.known, true);
  if (!withoutThem.known) throw new Error("unreachable");
  assert.equal(withoutThem.used, 12);
  assert.equal(withoutThem.full, false);
  assert.equal(withoutThem.left, 1);

  // A child who is NOT on this bus does not free a seat on it.
  const stranger = seatsOnRoute(s, "r1", { exceptStudentId: "nobody" });
  assert.equal(stranger.known && stranger.full, true);
}

/* ── Who is aboard is a DATE WINDOW, not "effectiveTo is null" ── */
{
  const ON = "2026-09-12";
  const ended = { ...asg("gone", "r1"), effectiveTo: "2026-08-31" };
  // An amendment closes the old row with a FUTURE end date. That child is
  // still on the bus until then, and an "effectiveTo is null" rule loses them.
  const leavingLater = { ...asg("leaving", "r1"), effectiveTo: "2026-10-31" };
  // …and opens the new row with a future start. That row is not a seat yet.
  const joiningLater = { ...asg("joining", "r1"), effectiveFrom: "2026-11-01" };
  const otherYear = asg("lastyear", "r1", "2025-26");

  const s = state(
    [{ id: "v1", seatCapacity: 13 }],
    [asg("s1", "r1"), ended, leavingLater, joiningLater, otherYear],
  );

  const now = seatsOnRoute(s, "r1", { onDate: ON });
  assert.equal(
    now.used,
    3,
    "s1 + the child leaving in October + last year's row; the ended and the not-yet-started are not aboard",
  );

  const thisYear = seatsOnRoute(s, "r1", {
    onDate: ON,
    academicYearCode: "2026-27",
  });
  assert.equal(thisYear.used, 2);

  // In November the picture reverses: the leaver is gone, the joiner aboard.
  const later = seatsOnRoute(s, "r1", {
    onDate: "2026-11-15",
    academicYearCode: "2026-27",
  });
  assert.equal(later.used, 2, "s1 + the child who joined on 1 November");
}

/* ── Both surfaces of the move screen must agree ── */
{
  // The picker's rows and the seat line beneath them used to count riders by
  // different rules, so one screen showed two numbers for the same bus.
  const riders = Array.from({ length: 6 }, (_, i) => asg(`s${i}`, "r1"));
  const s = state([{ id: "v1", seatCapacity: 13 }], riders);
  const line = seatsOnRoute(s, "r1", { exceptStudentId: "s0" });
  const { ranked } = rankStopsNearPoint(
    { ...s, routes: [{ ...s.routes[0], stops: [pinnedStop()] }] },
    { lat: 25.43, lng: 82.94 },
    { exceptStudentId: "s0" },
  );
  assert.equal(line.known, true);
  if (!line.known) throw new Error("unreachable");
  assert.equal(ranked.length, 1);
  assert.equal(
    ranked[0].seatsLeft,
    line.left,
    "the ranked row and the seat line must report the same free seats",
  );
}

/* ── A route with no vehicle linked has no capacity, not forty ── */
{
  const s = state([{ id: "other", seatCapacity: 30 }], [asg("s1", "r1")], "");
  const seats = seatsOnRoute(s, "r1");
  assert.equal(
    seats.known,
    false,
    "an unlinked route must not borrow some other bus's seats",
  );
}

/* ── A vehicle claiming the route as its primary still counts ── */
{
  const s = state(
    [{ id: "v9", seatCapacity: 7, primaryRouteId: "r1" }],
    [asg("s1", "r1")],
    "",
  );
  const seats = seatsOnRoute(s, "r1");
  assert.equal(seats.known, true);
  if (!seats.known) throw new Error("unreachable");
  assert.equal(seats.capacity, 7);
}

console.log("  ✓ transport seats — unrecorded is its own answer, not full and not forty");
