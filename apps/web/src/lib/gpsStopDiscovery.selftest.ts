/**
 * GPS stop discovery — the rules that decide what becomes a stop.
 * Run: npx tsx src/lib/gpsStopDiscovery.selftest.ts
 */
import assert from "node:assert/strict";
import {
  clusterRunHalts,
  findRunHalts,
  gpsStopNote,
  insertAfterNearest,
  isVehicleErrandPlace,
  proposeGpsStops,
  runDaysByVehicle,
  type GpsPosition,
} from "./gpsStopDiscovery";
import { stopOrigin } from "./transportStopOrigin";

console.log("gpsStopDiscovery.selftest.ts");

const school = { lat: 25.4354, lng: 82.944 };
const HOUSE = { lat: 25.4500, lng: 82.9700 }; // ~3 km from school
const LIGHT = { lat: 25.4400, lng: 82.9600 };

/** One morning: drive, one-ping halt at HOUSE (UTC 01:10 = 06:40 IST), drive on. */
function morning(day: string, opts: { at?: { lat: number; lng: number }; utc?: string; pings?: number } = {}): GpsPosition[] {
  const at = opts.at ?? HOUSE;
  const t0 = Date.parse(`${day}T${opts.utc ?? "01:08:00"}Z`);
  const p = (min: number, lat: number, lng: number, speed: number): GpsPosition => ({
    vehicleKey: "veh_m1",
    at: new Date(t0 + min * 60_000).toISOString(),
    lat,
    lng,
    speedKmh: speed,
  });
  const out = [p(0, at.lat - 0.004, at.lng, 25), p(1, at.lat - 0.002, at.lng, 25)];
  const stopped = opts.pings ?? 1;
  for (let k = 0; k < stopped; k++) out.push(p(2 + k, at.lat, at.lng, 0));
  out.push(p(2 + stopped, at.lat + 0.002, at.lng, 22), p(3 + stopped, at.lat + 0.004, at.lng, 25));
  return out;
}

const days = Array.from({ length: 12 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);

// A one-ping pickup is a halt (lasts until the next moving ping, ~60 s).
const one = findRunHalts(morning(days[0]!), school);
assert.equal(one.length, 1);
assert.equal(one[0]!.seconds, 60);
assert.equal(one[0]!.minuteIst, 6 * 60 + 40);

// Outside school-run hours (UTC 18:00 = 23:30 IST) nothing counts.
assert.equal(findRunHalts(morning(days[0]!, { utc: "18:00:00" }), school).length, 0);
// Unbounded (trail starts stopped) is the depot, not a stop.
assert.equal(findRunHalts(morning(days[0]!).slice(2), school).length, 0);
// At the school is the school.
assert.equal(findRunHalts(morning(days[0]!, { at: school }), school).length, 0);

// 12 run days; the house every day, a red light on 3 days.
const pts: GpsPosition[] = [];
days.forEach((d, i) => {
  pts.push(...morning(d));
  if (i < 3) pts.push(...morning(d, { at: LIGHT, utc: "02:30:00" }));
});
const run = runDaysByVehicle(pts);
assert.equal(run.get("veh_m1")!.size, 12);
const clusters = clusterRunHalts(findRunHalts(pts, school));
const proposed = proposeGpsStops({ clusters, vehicleKey: "veh_m1", runDays: 12, existing: [], everAdded: [] });
assert.equal(proposed.length, 1, "the red light seen 3 days is not a stop");
assert.equal(proposed[0]!.daysSeen, 12);
assert.equal(proposed[0]!.morningMinute, 6 * 60 + 40);

// Already a stop within 150 m → nothing new.
assert.equal(
  proposeGpsStops({ clusters, vehicleKey: "veh_m1", runDays: 12, existing: [{ lat: HOUSE.lat + 0.0005, lng: HOUSE.lng }], everAdded: [] }).length,
  0,
);
// Added once before and deleted by the office → never again.
assert.equal(
  proposeGpsStops({ clusters, vehicleKey: "veh_m1", runDays: 12, existing: [], everAdded: [HOUSE] }).length,
  0,
);
// Share rule: 12 sightings out of 40 run days is under 40% → not yet.
assert.equal(proposeGpsStops({ clusters, vehicleKey: "veh_m1", runDays: 40, existing: [], everAdded: [] }).length, 0);
// Long waits are parking: 15 stationary pings a day.
const parked: GpsPosition[] = days.flatMap((d) => morning(d, { pings: 15 }));
assert.equal(
  proposeGpsStops({ clusters: clusterRunHalts(findRunHalts(parked, school)), vehicleKey: "veh_m1", runDays: 12, existing: [], everAdded: [] }).length,
  0,
);

// Errands are not boarding points.
assert.ok(isVehicleErrandPlace("HP Petrol Pump Ahirauli"));
assert.ok(isVehicleErrandPlace("Dk Puc Centre"));
assert.ok(isVehicleErrandPlace("Anything", ["gas_station"]));
assert.ok(!isVehicleErrandPlace("Krishna Medical Stores", ["pharmacy"]));

// The note marks the stop "Actual · GPS".
const note = gpsStopNote(proposed[0]!, "Magic-1", 12, "2026-10-14", "Sulemapur");
assert.equal(stopOrigin({ geoAddress: note }), "gps");
assert.match(note, /12 of 12 school days/);
assert.match(note, /06:40 in the morning/);

// Inserted after the nearest stop, renumbered.
const stops = [
  { id: "a", sequence: 1, geoLat: 25.44, geoLng: 82.96 },
  { id: "b", sequence: 2, geoLat: 25.46, geoLng: 82.98 },
  { id: "c", sequence: 3 },
];
const next = insertAfterNearest(stops, { id: "n", sequence: 99, geoLat: 25.441, geoLng: 82.961 });
assert.deepEqual(next.map((s) => [s.id, s.sequence]), [["a", 1], ["n", 2], ["b", 3], ["c", 4]]);

console.log("ok");
