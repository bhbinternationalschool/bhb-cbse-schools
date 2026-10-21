/**
 * Bus routes live — progress along the stops, arrival times, stale fixes,
 * which run is on. Run: npx tsx src/lib/busRouteEta.selftest.ts
 */
import assert from "node:assert/strict";
import {
  AVG_SPEED_KMH,
  SPEED_CAP_KMH,
  SPEED_FLOOR_KMH,
  activeRun,
  computeRouteEtas,
  firstLegSpeed,
  fixIsStale,
  runWindowMinutes,
  stopsInRunOrder,
  type EtaStopInput,
} from "./busRouteEta";

console.log("busRouteEta.selftest.ts");

const T0 = Date.parse("2026-10-20T01:30:00.000Z"); // 07:00 IST
const ago = (min: number) => new Date(T0 - min * 60_000).toISOString();

// Four stops ~1.1 km apart due north, school beyond the last.
const lat0 = 25.4;
const step = 0.01; // ≈ 1.11 km
const stops: EtaStopInput[] = [
  { id: "st_a", name: "A", sequence: 1, lat: lat0, lng: 82.9 },
  { id: "st_b", name: "B", sequence: 2, lat: lat0 + step, lng: 82.9 },
  { id: "st_c", name: "C", sequence: 3, lat: lat0 + 2 * step, lng: 82.9 },
  { id: "st_d", name: "D", sequence: 4, lat: lat0 + 3 * step, lng: 82.9 },
];
const school = { lat: lat0 + 4 * step, lng: 82.9 };

// ── speed floor and cap ──
assert.equal(firstLegSpeed(0), SPEED_FLOOR_KMH, "a bus standing at a stop is floored, not infinite");
assert.equal(firstLegSpeed(null), AVG_SPEED_KMH);
assert.equal(firstLegSpeed(90), SPEED_CAP_KMH);
assert.equal(firstLegSpeed(30), 30);

// ── stale ──
assert.equal(fixIsStale(ago(2), T0), false);
assert.equal(fixIsStale(ago(11), T0), true);
assert.equal(fixIsStale("not a date", T0), true, "an unreadable time is not fresh");

// ── progress along the stops: passed A and B, now halfway B→C ──
{
  const r = computeRouteEtas({
    stops,
    fix: { lat: lat0 + 1.5 * step, lng: 82.9, speedKmh: 30, recordedAt: ago(1) },
    trail: [
      { at: ago(8), lat: lat0 + 0.0005, lng: 82.9 },
      { at: ago(4), lat: lat0 + step, lng: 82.9 },
    ],
    nowMs: T0,
    school,
  });
  assert.equal(r.fixState, "live");
  assert.deepEqual(r.stops.map((s) => s.state), ["passed", "passed", "upcoming", "upcoming"]);
  assert.equal(r.stops[0]!.passedAt, ago(8), "passed at the time the bus was nearest");
  assert.equal(r.stops[1]!.passedAt, ago(4));
  assert.equal(r.stops[0]!.etaMinutes, null, "a passed stop has no arrival time");
  // 0.555 km × 1.3 at 30 km/h ≈ 1.44 → 1 min; then 1.11 × 1.3 at 22 + 1 dwell ≈ 4.9 → total ≈ 6
  const c = r.stops[2]!;
  const d = r.stops[3]!;
  assert.ok(c.etaMinutes! >= 1 && c.etaMinutes! <= 2, `C eta ${c.etaMinutes}`);
  assert.ok(d.etaMinutes! > c.etaMinutes!, "later stops arrive later");
  assert.ok(d.etaMinutes! >= 5 && d.etaMinutes! <= 7, `D eta ${d.etaMinutes}`);
  assert.equal(c.etaAt, new Date(T0 + c.etaMinutes! * 60_000).toISOString());
  assert.ok(r.schoolEta && r.schoolEta.etaMinutes > d.etaMinutes!, "school after the last stop");
}

// ── a stationary bus still gets a finite time (speed floor) ──
{
  const r = computeRouteEtas({
    stops,
    fix: { lat: lat0 - step, lng: 82.9, speedKmh: 0, recordedAt: ago(0) },
    trail: [],
    nowMs: T0,
  });
  const a = r.stops[0]!;
  // 1.11 km × 1.3 at the 15 km/h floor ≈ 5.8 → 6
  assert.equal(a.etaMinutes, 6);
  assert.equal(r.schoolEta, null, "no school given, no school time");
}

// ── a stale fix: no arrival time anywhere, passing history still stands ──
{
  const r = computeRouteEtas({
    stops,
    fix: { lat: lat0 + 1.5 * step, lng: 82.9, speedKmh: 30, recordedAt: ago(25) },
    trail: [{ at: ago(30), lat: lat0, lng: 82.9 }],
    nowMs: T0,
    school,
  });
  assert.equal(r.fixState, "stale");
  assert.equal(r.stops[0]!.state, "passed");
  assert.ok(r.stops.slice(1).every((s) => s.etaMinutes === null && s.etaAt === null), "stale → no ETA");
  assert.equal(r.schoolEta, null);
}

// ── no fix at all ──
{
  const r = computeRouteEtas({ stops, fix: null, trail: [], nowMs: T0, school });
  assert.equal(r.fixState, "no_fix");
  assert.ok(r.stops.every((s) => s.state === "upcoming" && s.etaMinutes === null));
}

// ── a skipped stop is "not seen", not "passed" ──
{
  const r = computeRouteEtas({
    stops,
    fix: { lat: lat0 + 2 * step, lng: 82.9, speedKmh: 20, recordedAt: ago(0) },
    trail: [{ at: ago(10), lat: lat0, lng: 82.9 }],
    nowMs: T0,
  });
  assert.deepEqual(r.stops.map((s) => s.state), ["passed", "not_seen", "passed", "upcoming"]);
  assert.equal(r.stops[1]!.passedAt, null);
}

// ── an unpinned stop gets no time and does not break the chain ──
{
  const withHole = stops.map((s) => (s.id === "st_c" ? { ...s, lat: null, lng: null } : s));
  const r = computeRouteEtas({
    stops: withHole,
    fix: { lat: lat0 + step, lng: 82.9, speedKmh: 25, recordedAt: ago(0) },
    trail: [],
    nowMs: T0,
  });
  assert.equal(r.stops[2]!.state, "unpinned");
  assert.equal(r.stops[2]!.etaMinutes, null);
  assert.ok(r.stops[3]!.etaMinutes != null);
}

// ── a near-miss outside the radius is not a visit ──
{
  const r = computeRouteEtas({
    stops,
    fix: null,
    trail: [{ at: ago(5), lat: lat0 + 0.003, lng: 82.9 }], // ≈ 330 m
    nowMs: T0,
  });
  assert.equal(r.stops[0]!.state, "upcoming");
}

// ── run order: drop runs go the other way ──
assert.deepEqual(stopsInRunOrder([{ sequence: 2 }, { sequence: 1 }, { sequence: 3 }], "AM").map((s) => s.sequence), [1, 2, 3]);
assert.deepEqual(stopsInRunOrder([{ sequence: 2 }, { sequence: 1 }, { sequence: 3 }], "PM").map((s) => s.sequence), [3, 2, 1]);

// ── which run is on ──
assert.equal(runWindowMinutes(0), 90);
assert.equal(runWindowMinutes(118), 177);
assert.equal(runWindowMinutes(500), 180);
const runs = [
  { shiftId: "am", name: "Morning", trip: "AM" as const, departTime: "06:00" },
  { shiftId: "early", name: "Early drop", trip: "PM" as const, departTime: "11:30" },
  { shiftId: "main", name: "Main drop", trip: "PM" as const, departTime: "13:30" },
];
const m = (h: number, mm: number) => h * 60 + mm;
assert.equal(activeRun(runs, m(5, 45), 57), null, "before the morning run: off-shift");
assert.equal(activeRun(runs, m(5, 55), 57)?.shiftId, "am", "ten minutes early counts");
assert.equal(activeRun(runs, m(7, 20), 57)?.shiftId, "am");
assert.equal(activeRun(runs, m(9, 0), 57), null, "between runs: off-shift");
assert.equal(activeRun(runs, m(12, 0), 57)?.shiftId, "early");
assert.equal(activeRun(runs, m(13, 25), 118)?.shiftId, "main", "overlap → the later run");
assert.equal(activeRun(runs, m(17, 0), 57), null, "evening: off-shift");
const untimed = [
  { shiftId: "", name: "Morning pick-up", trip: "AM" as const, departTime: "" },
  { shiftId: "", name: "Afternoon drop", trip: "PM" as const, departTime: "" },
];
assert.equal(activeRun(untimed, m(7, 0), 0)?.trip, "AM");
assert.equal(activeRun(untimed, m(14, 0), 0)?.trip, "PM");
assert.equal(activeRun(untimed, m(20, 0), 0), null);
assert.equal(activeRun([{ shiftId: "x", name: "?", trip: "AM", departTime: "7 am" }], m(7, 0), 0), null, "an unreadable time is not guessed");

console.log("busRouteEta.selftest.ts: all passed");
