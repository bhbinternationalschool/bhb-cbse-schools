/**
 * Self-test: today's boarding marks as they reach the riders-by-bus roster.
 * Run: npx tsx apps/web/src/lib/transportBoarding.selftest.ts
 *
 * The rule this file exists to protect: a child with no mark reads as NOT
 * MARKED, never as absent and never as boarded. The office looks at this
 * column to answer "did my child get on the bus?", and a blank that renders
 * as an answer is how a family gets told the wrong thing about their child.
 *
 * The second rule: a mark carries a pin or it carries nothing. A mark whose
 * location is missing must show null coordinates, not 0,0 — a pin in the Gulf
 * of Guinea is worse than no pin, because it looks like evidence.
 */

import assert from "node:assert/strict";

import { buildFleetRosters, type StudentTransportProfile } from "./transportPlanner";
import type { TransportState } from "./transport";

console.log("transportBoarding.selftest.ts");

const AY = "2026-27";
const DAY = "2026-08-22";

type Mark = {
  studentId: string;
  date: string;
  trip: "AM" | "PM";
  status: string;
  boarded?: { lat: number; lng: number; km: number };
  noGeo?: boolean;
};

function state(marks: Mark[]): TransportState {
  return {
    routes: [
      {
        id: "r1",
        code: "R1",
        name: "MAGIC 1",
        busNo: "MAGIC 1",
        vehicleReg: "UP65 X 1234",
        vehicleId: "",
        monthlyFeePaise: 50000,
        isActive: true,
        stops: [
          { id: "st1", name: "Ayar Mod", sequence: 1, distanceKm: 4, monthlyFeePaise: 50000, distanceSource: "google" },
        ],
      },
    ],
    assignments: [],
    vehicles: [],
    boardingEvents: marks.map((m, i) => ({
      id: `brd_${i}`,
      date: m.date,
      routeId: "r1",
      trip: m.trip,
      studentId: m.studentId,
      status: m.status,
      note: "",
      createdAt: `${m.date}T07:4${i}:00.000Z`,
      boardedLocation: m.boarded
        ? {
            lat: m.boarded.lat,
            lng: m.boarded.lng,
            accuracyM: 12,
            at: `${m.date}T07:4${i}:00.000Z`,
            distanceFromSchoolKm: m.boarded.km,
          }
        : null,
      offboardedLocation: null,
    })),
  } as unknown as TransportState;
}

function profile(id: string, name: string): StudentTransportProfile {
  return {
    studentId: id,
    fullName: name,
    classLabel: "I",
    householdId: `hh_${id}`,
    hasAssignment: true,
    assignment: {
      id: `a_${id}`,
      studentId: id,
      householdId: `hh_${id}`,
      routeId: "r1",
      stopId: "st1",
      academicYearCode: AY,
      effectiveFrom: "2026-04-01",
      effectiveTo: null,
      monthlyFeePaise: 50000,
      feeOverrideReason: "",
      serviceMode: "both",
      boardingSuspended: false,
      createdAt: "",
    },
  } as unknown as StudentTransportProfile;
}

const kids = [profile("s1", "AARAV"), profile("s2", "BHUMI"), profile("s3", "CHETAN")];

const rowsOf = (st: TransportState) =>
  new Map(
    buildFleetRosters(st, kids, undefined, undefined, {
      boardingDate: DAY,
      trip: "AM",
    })[0].riders.map((r) => [r.studentId, r]),
  );

/* ── THE protection: no mark is not an answer ───────────────── */

const none = rowsOf(state([]));
assert.equal(none.get("s1")!.todayBoarding, null, "unmarked child -> null, not a status");
assert.equal(none.get("s2")!.todayBoarding, null);
assert.equal(none.get("s3")!.todayBoarding, null);

/* ── a real mark carries its pin through ────────────────────── */

const marked = rowsOf(
  state([
    {
      studentId: "s1",
      date: DAY,
      trip: "AM",
      status: "boarded",
      boarded: { lat: 25.41, lng: 82.99, km: 4.1 },
    },
  ]),
);
const t1 = marked.get("s1")!.todayBoarding!;
assert.equal(t1.status, "boarded");
assert.equal(t1.lat, 25.41);
assert.equal(t1.lng, 82.99);
assert.equal(t1.accuracyM, 12);
assert.equal(t1.distanceFromSchoolKm, 4.1);
assert.ok(t1.markedAt.startsWith(DAY), "the mark keeps its own timestamp");

// The others on the same bus are still unmarked — one child's mark says
// nothing about the child sitting next to them.
assert.equal(marked.get("s2")!.todayBoarding, null);

/* ── absent is a mark, and it has no pin ────────────────────── */

const absent = rowsOf(
  state([{ studentId: "s2", date: DAY, trip: "AM", status: "absent", noGeo: true }]),
);
const t2 = absent.get("s2")!.todayBoarding!;
assert.equal(t2.status, "absent");
assert.equal(t2.lat, null, "no pin must be null, never 0");
assert.equal(t2.lng, null);
assert.equal(t2.distanceFromSchoolKm, null);

/* ── yesterday is not today, and PM is not AM ───────────────── */

const stale = rowsOf(
  state([
    {
      studentId: "s1",
      date: "2026-08-21",
      trip: "AM",
      status: "boarded",
      boarded: { lat: 25.41, lng: 82.99, km: 4.1 },
    },
    {
      studentId: "s2",
      date: DAY,
      trip: "PM",
      status: "boarded",
      boarded: { lat: 25.42, lng: 82.98, km: 4.2 },
    },
  ]),
);
assert.equal(stale.get("s1")!.todayBoarding, null, "yesterday's mark is not today's");
assert.equal(stale.get("s2")!.todayBoarding, null, "the afternoon mark is not the morning's");

// ...and the afternoon roster sees the afternoon mark, not the morning one.
const pm = new Map(
  buildFleetRosters(
    state([
      {
        studentId: "s2",
        date: DAY,
        trip: "PM",
        status: "boarded",
        boarded: { lat: 25.42, lng: 82.98, km: 4.2 },
      },
    ]),
    kids,
    undefined,
    undefined,
    { boardingDate: DAY, trip: "PM" },
  )[0].riders.map((r) => [r.studentId, r]),
);
assert.equal(pm.get("s2")!.todayBoarding!.status, "boarded");
assert.equal(pm.get("s1")!.todayBoarding, null);

/* ── a re-mark wins, whichever order it is stored in ────────── */

// The attendant taps "बदलें" and marks again. The store merges a re-mark into
// the existing row, so a pair should never exist — but it PREPENDS new rows,
// so if one ever did, taking "the last one in the array" would show the child
// as absent after they were marked aboard. The newest mark wins by timestamp.
for (const order of ["newest-first", "oldest-first"] as const) {
  const older: Mark = {
    studentId: "s3",
    date: DAY,
    trip: "AM",
    status: "absent",
    noGeo: true,
  };
  const newer: Mark = {
    studentId: "s3",
    date: DAY,
    trip: "AM",
    status: "boarded",
    boarded: { lat: 25.43, lng: 82.97, km: 4.3 },
  };
  // `state()` stamps createdAt from the array index, so build the pair in the
  // order that makes `newer` genuinely later, then present it both ways round.
  const built = state([older, newer]).boardingEvents!;
  const pair = order === "newest-first" ? [built[1], built[0]] : built;
  const rows = new Map(
    buildFleetRosters(
      { ...state([]), boardingEvents: pair } as TransportState,
      kids,
      undefined,
      undefined,
      { boardingDate: DAY, trip: "AM" },
    )[0].riders.map((r) => [r.studentId, r]),
  );
  assert.equal(rows.get("s3")!.todayBoarding!.status, "boarded", order);
  assert.equal(rows.get("s3")!.todayBoarding!.lat, 25.43, order);
}

console.log("  ok");
