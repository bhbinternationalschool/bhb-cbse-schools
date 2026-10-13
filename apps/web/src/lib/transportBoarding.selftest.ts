/**
 * Self-test: today's bus register (v2) marks as they reach the riders-by-bus
 * roster.
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
 *
 * Marks come from bus register v2 (transport_boarding_marks); the old
 * state.boardingEvents slice must not leak into the column.
 */

import assert from "node:assert/strict";

import { buildFleetRosters, type StudentTransportProfile } from "./transportPlanner";
import { boardingDaySheetRows } from "./transportReportCatalog";
import type { TransportState } from "./transport";
import type { RegisterDayMark, RegisterStatus } from "./transportBoardingLog";

console.log("transportBoarding.selftest.ts");

const AY = "2026-27";
const DAY = "2026-08-22";

type Mark = {
  studentId: string;
  date: string;
  trip: "AM" | "PM";
  status: RegisterStatus;
  routeId?: string;
  boarded?: { lat: number; lng: number };
  noGeo?: boolean;
};

const ST: TransportState = {
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
  // The old boarding slice is no longer read: a mark left here must not show.
  boardingEvents: [
    { id: "old", date: DAY, routeId: "r1", trip: "AM", studentId: "s2", status: "boarded", note: "", createdAt: `${DAY}T07:00:00.000Z` },
  ],
} as unknown as TransportState;

/** Register v2 marks as the runs route returns them (?marks=1). */
function marks(list: Mark[]): RegisterDayMark[] {
  return list.map((m, i) => ({
    date: m.date,
    routeId: m.routeId ?? "r1",
    trip: m.trip,
    studentId: m.studentId,
    status: m.status,
    tappedAt: `${m.date}T07:4${i}:00.000Z`,
    markedByName: "Attendant",
    lat: m.boarded ? m.boarded.lat : null,
    lng: m.boarded ? m.boarded.lng : null,
    accuracyM: m.boarded ? 12 : null,
  }));
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

const rowsOf = (registerMarks: RegisterDayMark[], trip: "AM" | "PM" = "AM") =>
  new Map(
    buildFleetRosters(ST, kids, undefined, undefined, {
      boardingDate: DAY,
      trip,
      registerMarks,
    })[0].riders.map((r) => [r.studentId, r]),
  );

/* ── THE protection: no mark is not an answer ───────────────── */

const none = rowsOf(marks([]));
assert.equal(none.get("s1")!.todayBoarding, null, "unmarked child -> null, not a status");
assert.equal(none.get("s2")!.todayBoarding, null, "the old boarding slice is not read any more");
assert.equal(none.get("s3")!.todayBoarding, null);

/* ── a real mark carries its pin through ────────────────────── */

const marked = rowsOf(
  marks([{ studentId: "s1", date: DAY, trip: "AM", status: "boarded", boarded: { lat: 25.41, lng: 82.99 } }]),
);
const t1 = marked.get("s1")!.todayBoarding!;
assert.equal(t1.status, "boarded");
assert.equal(t1.lat, 25.41);
assert.equal(t1.lng, 82.99);
assert.equal(t1.accuracyM, 12);
assert.equal(t1.distanceFromSchoolKm, null, "the register does not record distance — never invented");
assert.equal(t1.markedByName, "Attendant");
assert.ok(t1.markedAt.startsWith(DAY), "the mark keeps its own timestamp");
assert.equal(marked.get("s2")!.todayBoarding, null, "one child's mark says nothing about the next");

/* ── not boarded is a mark, and it has no pin ───────────────── */

const nb = rowsOf(marks([{ studentId: "s2", date: DAY, trip: "AM", status: "not_boarded", noGeo: true }]));
const t2 = nb.get("s2")!.todayBoarding!;
assert.equal(t2.status, "not_boarded");
assert.equal(t2.lat, null, "no pin must be null, never 0");
assert.equal(t2.lng, null);

/* ── yesterday is not today, PM is not AM, another bus is not this one ── */

const stale = rowsOf(
  marks([
    { studentId: "s1", date: "2026-08-21", trip: "AM", status: "boarded" },
    { studentId: "s2", date: DAY, trip: "PM", status: "dropped" },
    { studentId: "s3", date: DAY, trip: "AM", status: "boarded", routeId: "r9" },
  ]),
);
assert.equal(stale.get("s1")!.todayBoarding, null, "yesterday's mark is not today's");
assert.equal(stale.get("s2")!.todayBoarding, null, "the afternoon mark is not the morning's");
assert.equal(stale.get("s3")!.todayBoarding, null, "a mark on another route is not this bus's");

const pm = rowsOf(marks([{ studentId: "s2", date: DAY, trip: "PM", status: "dropped" }]), "PM");
assert.equal(pm.get("s2")!.todayBoarding!.status, "dropped");
assert.equal(pm.get("s1")!.todayBoarding, null);

/* ── should two marks ever arrive, the later tap wins ───────── */

for (const order of ["newest-first", "oldest-first"] as const) {
  const pair = marks([
    { studentId: "s3", date: DAY, trip: "AM", status: "not_boarded", noGeo: true },
    { studentId: "s3", date: DAY, trip: "AM", status: "boarded", boarded: { lat: 25.43, lng: 82.97 } },
  ]);
  const rows = rowsOf(order === "newest-first" ? [pair[1]!, pair[0]!] : pair);
  assert.equal(rows.get("s3")!.todayBoarding!.status, "boarded", order);
  assert.equal(rows.get("s3")!.todayBoarding!.lat, 25.43, order);
}

/* ── the boarding day sheet reads the same register ─────────── */

{
  const st = {
    ...ST,
    assignments: [
      { id: "a1", studentId: "s1", householdId: "h1", routeId: "r1", stopId: "st1", stopName: "Ayar Mod", academicYearCode: AY, effectiveFrom: "2026-04-01", effectiveTo: null, monthlyFeePaise: 0, feeOverrideReason: "", serviceMode: "both", boardingSuspended: false, createdAt: "" },
      { id: "a2", studentId: "s2", householdId: "h2", routeId: "r1", stopId: "st1", stopName: "Ayar Mod", academicYearCode: AY, effectiveFrom: "2026-04-01", effectiveTo: null, monthlyFeePaise: 0, feeOverrideReason: "", serviceMode: "both", boardingSuspended: false, createdAt: "" },
    ],
  } as unknown as TransportState;
  const info = (sid: string) => ({ student: sid, admissionNo: "", className: "", section: "" });
  const rows = boardingDaySheetRows({
    transport: st,
    date: DAY,
    marks: marks([
      { studentId: "s1", date: DAY, trip: "AM", status: "boarded" },
      { studentId: "s1", date: DAY, trip: "PM", status: "dropped" },
      // Marked on the bus but not on its list — still on the sheet.
      { studentId: "s9", date: DAY, trip: "AM", status: "boarded" },
      // Another day's mark stays off this sheet.
      { studentId: "s2", date: "2026-08-21", trip: "AM", status: "not_boarded" },
    ]),
    studentInfo: info,
  });
  const by = new Map(rows.map((r) => [String(r.student), r]));
  assert.equal(by.get("s1")!.amStatus, "Boarded");
  assert.equal(by.get("s1")!.pmStatus, "Dropped");
  assert.match(String(by.get("s1")!.amBy), /^Attendant \d\d:\d\d$/, "who marked, and when in IST");
  assert.equal(by.get("s2")!.amStatus, "not marked", "no mark is 'not marked', never absent");
  assert.equal(by.get("s2")!.pmStatus, "not marked");
  assert.equal(by.get("s2")!.amBy, "");
  assert.equal(by.get("s9")!.amStatus, "Boarded");
  assert.equal(by.get("s9")!.stop, "not on this route's list");
  assert.equal(rows.length, 3, "the old boardingEvents slice adds no rows");
}

console.log("  ok");
