/**
 * Self-test: finding where the buses actually stop.
 * Run: npx tsx apps/web/src/lib/haltClustering.selftest.ts
 *
 * The trails are synthetic but the shapes are the real ones: a bus parked at
 * the depot all night reporting a stationary position every minute, a school
 * arrival every trip, and the difference between a place a bus stops once and
 * a place it stops every morning.
 */

import assert from "node:assert/strict";

import {
  candidateBoardingPoints,
  clusterHalts,
  findHalts,
  istDay,
  metresBetween,
  unvisitedStopsWithRiders,
  type KnownStop,
  type TrailPoint,
} from "./haltClustering";

console.log("haltClustering.selftest.ts");

const SCHOOL = { lat: 25.4354, lng: 82.9443 };

/** A point a fixed number of minutes after 06:00 IST on the given day. */
const p = (
  minute: number,
  lat: number,
  lng: number,
  speedKmh: number,
  day = "2026-09-11",
  vehicleRef = "V1",
): TrailPoint => ({
  vehicleRef,
  at: new Date(Date.parse(`${day}T00:30:00.000Z`) + minute * 60_000).toISOString(),
  lat,
  lng,
  speedKmh,
  ignitionOn: speedKmh > 0,
});

/* ── distance and day bucketing ─────────────────────────────── */

assert.ok(Math.abs(metresBetween(25.4354, 82.9443, 25.4354, 82.9443)) < 0.001);
assert.ok(
  Math.abs(metresBetween(25.4354, 82.9443, 25.4364, 82.9443) - 111) < 5,
  "a thousandth of a degree of latitude is about 111 m",
);
// 23:30 UTC is already the next morning in IST — the school day is the unit.
assert.equal(istDay("2026-09-10T19:00:00.000Z"), "2026-09-11");

/* ── a halt is bounded by movement ──────────────────────────── */

const VILLAGE = { lat: 25.4290, lng: 82.9490 };
const trail: TrailPoint[] = [
  p(0, 25.4200, 82.9600, 30),
  p(1, VILLAGE.lat, VILLAGE.lng, 0),
  p(2, VILLAGE.lat, VILLAGE.lng, 0),
  p(3, VILLAGE.lat, VILLAGE.lng, 0),
  p(4, 25.4320, 82.9450, 25),
];
const halts = findHalts(trail, SCHOOL);
assert.equal(halts.length, 1, "arrived, waited, left — that is a halt");
assert.equal(halts[0]!.seconds, 120);
assert.ok(metresBetween(halts[0]!.lat, halts[0]!.lng, VILLAGE.lat, VILLAGE.lng) < 20);

/* ── the depot is not a boarding point ──────────────────────── */

// A bus parked overnight reports a stationary position every minute until
// morning. Unbounded at the start of the trail, so it is where the vehicle
// already was — and it would otherwise dwarf every real stop in the data.
const overnight: TrailPoint[] = [
  ...Array.from({ length: 500 }, (_, i) => p(i, 25.4100, 82.9100, 0)),
  p(501, 25.4200, 82.9200, 20),
];
assert.equal(findHalts(overnight, SCHOOL).length, 0, "parked-at-the-start is the depot");

// And parked at the end of the window, likewise.
const parkedAtEnd: TrailPoint[] = [
  p(0, 25.4200, 82.9200, 20),
  ...Array.from({ length: 300 }, (_, i) => p(i + 1, 25.4100, 82.9100, 0)),
];
assert.equal(findHalts(parkedAtEnd, SCHOOL).length, 0);

/* ── the school is not a boarding point ─────────────────────── */

const atSchool: TrailPoint[] = [
  p(0, 25.4200, 82.9600, 30),
  p(1, SCHOOL.lat, SCHOOL.lng, 0),
  p(2, SCHOOL.lat, SCHOOL.lng, 0),
  p(3, SCHOOL.lat, SCHOOL.lng, 0),
  p(4, 25.4320, 82.9450, 25),
];
assert.equal(findHalts(atSchool, SCHOOL).length, 0, "the bus stops there every trip");

/* ── a pause too brief for anyone to board ──────────────────── */

const traffic: TrailPoint[] = [
  p(0, 25.4200, 82.9600, 30),
  { ...p(1, 25.4250, 82.9550, 0), at: new Date(Date.parse("2026-09-11T00:31:00Z")).toISOString() },
  { ...p(1, 25.4250, 82.9550, 0), at: new Date(Date.parse("2026-09-11T00:31:20Z")).toISOString() },
  p(2, 25.4320, 82.9450, 25),
];
assert.equal(findHalts(traffic, SCHOOL).length, 0, "20 seconds is a traffic light");

/* ── clustering, and what may be called a boarding point ────── */

const stops: KnownStop[] = [
  { stopId: "s1", stopName: "Kakalpur", routeId: "r1", routeLabel: "MAGIC-1",
    lat: VILLAGE.lat, lng: VILLAGE.lng, riders: 5 },
  { stopId: "s2", stopName: "Never used", routeId: "r1", routeLabel: "MAGIC-1",
    lat: 25.5000, lng: 83.1000, riders: 3 },
  { stopId: "s3", stopName: "No riders here", routeId: "r1", routeLabel: "MAGIC-1",
    lat: 25.4600, lng: 82.9000, riders: 0 },
];

// The same unlisted corner, three mornings running.
const CORNER = { lat: 25.4400, lng: 82.9700 };
const threeMornings = ["2026-09-09", "2026-09-10", "2026-09-11"].flatMap((d) => [
  p(0, 25.4200, 82.9600, 30, d),
  p(1, CORNER.lat, CORNER.lng, 0, d),
  p(2, CORNER.lat, CORNER.lng, 0, d),
  p(3, 25.4320, 82.9450, 25, d),
]);
const clusters = clusterHalts(findHalts(threeMornings, SCHOOL), stops);
assert.equal(clusters.length, 1);
assert.equal(clusters[0]!.daysSeen, 3, "three separate mornings");
assert.equal(clusters[0]!.matchedStopId, null, "no stop is anywhere near it");
assert.equal(candidateBoardingPoints(clusters).length, 1, "three days earns the name");

// One morning is an observation, not a boarding point — a puncture looks
// exactly like this.
const oneMorning = clusterHalts(
  findHalts(threeMornings.filter((x) => x.at.startsWith("2026-09-10")), SCHOOL),
  stops,
);
assert.equal(oneMorning[0]!.daysSeen, 1);
assert.equal(candidateBoardingPoints(oneMorning).length, 0, "seen once is not a finding");
assert.equal(candidateBoardingPoints(oneMorning, 1).length, 1, "unless the caller says so");

/* ── halts that sit on a known stop are that stop ───────────── */

const onStop = clusterHalts(findHalts(trail, SCHOOL), stops);
assert.equal(onStop[0]!.matchedStopId, "s1");
assert.ok((onStop[0]!.metresFromStop ?? 999) < 20);

/* ── stops with riders that the buses never go near ─────────── */

const unvisited = unvisitedStopsWithRiders(stops, onStop);
assert.equal(unvisited.length, 1, "only stops that have riders are chased");
assert.equal(unvisited[0]!.stopId, "s2");
assert.ok(
  (unvisited[0]!.nearestClusterMetres ?? 0) > 1000,
  "reported with its distance — a stop 80 m out is a bad pin, 8 km out is unused",
);

console.log("  ok");
