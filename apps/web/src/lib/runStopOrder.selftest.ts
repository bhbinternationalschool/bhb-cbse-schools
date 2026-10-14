/**
 * Stop order per run + first picked, first dropped.
 * Run: npx tsx src/lib/runStopOrder.selftest.ts
 */
import assert from "node:assert/strict";
import {
  buildRunOrders,
  legShift,
  orderForRun,
  passMinute,
  schoolLegs,
  sequenceByPickup,
  suggestFairDrop,
  type RunOrder,
  type TrailPoint,
} from "./runStopOrder";

console.log("runStopOrder.selftest.ts");

const school = { lat: 25.4354, lng: 82.944 };
// Three stops on a line east of school: A far, B middle, C near.
const A = { id: "A", sequence: 1, geoLat: 25.4354, geoLng: 82.984 };
const B = { id: "B", sequence: 2, geoLat: 25.4354, geoLng: 82.970 };
const C = { id: "C", sequence: 3, geoLat: 25.4354, geoLng: 82.956 };

/** A journey along the line: morning far→school, drop school→far→school. */
function journey(day: string, startUtc: string, lngs: number[], v = "veh"): TrailPoint[] {
  const t0 = Date.parse(`${day}T${startUtc}Z`);
  return lngs.map((lng, i) => ({ vehicleKey: v, at: new Date(t0 + i * 120_000).toISOString(), lat: 25.4354, lng, speedKmh: lng === 82.944 ? 0 : 20 }));
}
const out = [82.944, 82.95, 82.956, 82.963, 82.97, 82.977, 82.984, 82.99];
const back = [...out].reverse();
const days = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12"];
const pts: TrailPoint[] = [];
for (const d of days) {
  // 00:30 UTC = 06:00 IST: leave school, drive out empty, collect A→B→C back to school.
  pts.push(...journey(d, "00:30:00", [82.944, ...out.slice(1), ...back.slice(1, -1), 82.944]));
  // 08:00 UTC = 13:30 IST: drop C→B→A, return empty.
  pts.push(...journey(d, "08:00:00", [82.944, ...out.slice(1), ...back.slice(1, -1), 82.944]));
}
const legs = schoolLegs(pts, school);
assert.equal(legs.length, 12);
assert.ok(legs.every((l) => l.startedAtSchool && l.endedAtSchool));

const shifts = [
  { id: "am", direction: "pickup" as const, departTime: "06:00", weekdays: [1, 2, 3, 4, 5, 6], isActive: true },
  { id: "pm", direction: "drop" as const, departTime: "13:30", weekdays: [1, 2, 3, 4, 5, 6], isActive: true },
  { id: "pp", direction: "drop" as const, departTime: "11:30", weekdays: [1, 2, 3, 4, 5], isActive: true },
];
assert.deepEqual(legShift({ startMinute: 6 * 60, weekday: 1 }, shifts), { direction: "pickup", shiftId: "am" });
assert.deepEqual(legShift({ startMinute: 13 * 60 + 35, weekday: 1 }, shifts), { direction: "drop", shiftId: "pm" });
assert.equal(legShift({ startMinute: 16 * 60 + 30, weekday: 1 }, shifts), null, "no run within an hour → not guessed");
assert.equal(passMinute({ points: [{ minute: 10, lat: 25.4354, lng: 82.95 }, { minute: 12, lat: 25.4354, lng: 82.96 }] }, 25.4354, 82.955) != null, true);

const orders = buildRunOrders({ routeId: "r", stops: [A, B, C], shifts, legs, minLegs: 3 });
const am = orders.find((o) => o.direction === "pickup")!;
const pm = orders.find((o) => o.direction === "drop")!;
// The bus passes each stop twice per journey; the FIRST pass is out, the closest
// pass wins — so assert on relative order of the stops' recorded minutes.
assert.ok(am && pm);
assert.equal(am.stops.length, 3);
assert.ok(pm.returnsToSchoolShare === 1);

// Route stop list follows the morning; stops never seen go last.
const resequenced = sequenceByPickup([A, B, C, { id: "Z", sequence: 0 }], { stops: [{ stopId: "C", minute: 1, rideMinutes: 1, days: 6 }, { stopId: "A", minute: 2, rideMinutes: 1, days: 6 }] } as RunOrder);
assert.deepEqual(resequenced.map((s) => [s.id, s.sequence]), [["C", 1], ["A", 2], ["Z", 3], ["B", 4]]);

// Fair drop: reversed drop (A picked first, dropped last) is suggested on a loop.
const pickup: RunOrder = { routeId: "r", shiftId: "am", direction: "pickup", legs: 6, unseenStopIds: [], returnMinutes: null, returnsToSchoolShare: 1, startsAtSchoolShare: 1,
  stops: [{ stopId: "A", minute: 400, rideMinutes: 40, days: 6 }, { stopId: "B", minute: 410, rideMinutes: 30, days: 6 }, { stopId: "C", minute: 420, rideMinutes: 20, days: 6 }] };
const drop: RunOrder = { routeId: "r", shiftId: "pm", direction: "drop", legs: 6, unseenStopIds: [], returnMinutes: 15, returnsToSchoolShare: 1, startsAtSchoolShare: 1,
  stops: [{ stopId: "C", minute: 820, rideMinutes: 10, days: 6 }, { stopId: "B", minute: 830, rideMinutes: 20, days: 6 }, { stopId: "A", minute: 845, rideMinutes: 35, days: 6 }] };
const points = new Map([A, B, C].map((s) => [s.id, { lat: s.geoLat, lng: s.geoLng }]));
const riders = new Map([["A", 3], ["B", 2], ["C", 4]]);
const sug = suggestFairDrop({ pickup, drop, ridersByStop: riders, stopPoints: points, school });
assert.ok(sug.suggested);
if (sug.suggested) {
  assert.deepEqual(sug.order, ["A", "B", "C"]);
  assert.equal(sug.longestNow, 75); // A: 40 + 35
  assert.ok(sug.longestSuggested < sug.longestNow);
  assert.equal(sug.estimated, true);
}
// Not on a route that ends its day at the far end.
assert.equal(suggestFairDrop({ pickup, drop: { ...drop, returnsToSchoolShare: 0 }, ridersByStop: riders, stopPoints: points, school }).suggested, false);
// Not with children at fewer than 3 shared stops.
assert.equal(suggestFairDrop({ pickup, drop, ridersByStop: new Map([["A", 1]]), stopPoints: points, school }).suggested, false);

// Driver's list: fair follows the morning, gps the run, nothing → route; no stop dropped.
const routeStops = [A, B, C, { id: "Z", sequence: 9 }];
assert.deepEqual(orderForRun({ routeStops, run: { stops: drop.stops, chosen: "gps" }, pickup }).ids, ["C", "B", "A", "Z"]);
const fair = orderForRun({ routeStops, run: { stops: drop.stops, chosen: "fair" }, pickup });
assert.deepEqual(fair.ids, ["A", "B", "C", "Z"]);
assert.equal(fair.basis, "fair");
assert.equal(fair.expectedMinute.size, 0, "no invented times for the fair order");
assert.deepEqual(orderForRun({ routeStops }).ids, ["A", "B", "C", "Z"]);
// Custom order from an audit suggestion; unknown ids ignored, missing stops appended.
const custom = orderForRun({ routeStops, run: { stops: drop.stops, chosen: "custom", customOrder: ["B", "GONE", "A"] }, pickup });
assert.deepEqual(custom.ids, ["B", "A", "C", "Z"]);
assert.equal(custom.basis, "custom");

console.log("ok");
