/**
 * Transport audit rules: who to move, road alerts, fuel cost.
 * Run: npx tsx src/lib/transportAudit.selftest.ts
 */
import assert from "node:assert/strict";
import { detectRoadAlerts, fuelRupeesPerKm, suggestMoves, type AuditRider, type AuditRoute } from "./transportAudit";
import type { SchoolLeg } from "./runStopOrder";

console.log("transportAudit.selftest.ts");

const routes: AuditRoute[] = [
  {
    id: "r1",
    name: "Magic-1",
    vehicleName: "Magic-1",
    stops: [
      { id: "far", name: "Far stop", geoLat: 25.40, geoLng: 82.97 }, // never reached
      { id: "gps1", name: "GPS halt", geoLat: 25.4300, geoLng: 82.9770 }, // reached
    ],
  },
  {
    id: "r2",
    name: "Winger",
    vehicleName: "Winger",
    stops: [{ id: "w1", name: "Winger halt", geoLat: 25.4410, geoLng: 82.9360 }],
  },
];
const pickupOrders = new Map([
  ["r1", { stops: [{ stopId: "gps1", minute: 400, rideMinutes: 30, days: 20 }] }],
  ["r2", { stops: [{ stopId: "w1", minute: 410, rideMinutes: 20, days: 20 }] }],
]);
const rider = (over: Partial<AuditRider>): AuditRider => ({
  assignmentId: "a1",
  studentId: "s1",
  studentName: "Child One",
  householdId: "h1",
  routeId: "r1",
  stopId: "far",
  feePaise: 50000,
  ...over,
});

// Own bus never reaches "far"; a reached stop on the same bus is 100 m from home → same-bus move.
let moves = suggestMoves({ routes, riders: [rider({})], pickupOrders, pins: new Map([["s1", { lat: 25.4309, lng: 82.9770 }]]) });
assert.equal(moves.length, 1);
assert.equal(moves[0]!.toStopId, "gps1");
assert.equal(moves[0]!.sameBus, true);
assert.equal(moves[0]!.feePaise, 50000);
assert.equal(moves[0]!.id, "sug:move:a1:gps1", "stable id, so a dismissal sticks");

// Home is by the Winger's halt → switch vehicle; a sibling already on the Winger outranks distance.
moves = suggestMoves({
  routes,
  riders: [rider({}), rider({ assignmentId: "a2", studentId: "s2", routeId: "r2", stopId: "w1" })],
  pickupOrders,
  pins: new Map([["s1", { lat: 25.4412, lng: 82.9360 }]]),
});
assert.equal(moves.length, 1);
assert.equal(moves[0]!.toRouteId, "r2");
assert.equal(moves[0]!.siblingOnBus, true);

// No home pin → no move (we know the stop, not the child).
assert.equal(suggestMoves({ routes, riders: [rider({})], pickupOrders, pins: new Map() }).length, 0);
// Already boarding at a reached stop near home → nothing.
assert.equal(
  suggestMoves({ routes, riders: [rider({ stopId: "gps1" })], pickupOrders, pins: new Map([["s1", { lat: 25.4305, lng: 82.9770 }]]) }).length,
  0,
);
// Nothing reached within 300 m → nothing (no guessing).
assert.equal(suggestMoves({ routes, riders: [rider({})], pickupOrders, pins: new Map([["s1", { lat: 25.47, lng: 82.99 }]]) }).length, 0);
// Fee unknown is carried as null (the server shows the suggestion without a button).
assert.equal(
  suggestMoves({ routes, riders: [rider({ feePaise: null })], pickupOrders, pins: new Map([["s1", { lat: 25.4309, lng: 82.9770 }]]) })[0]!.feePaise,
  null,
);

// Road alerts: a stop reached on 10 earlier days and none of the last 3.
const stop = { id: "st", name: "Kurauli", geoLat: 25.43, geoLng: 82.97 };
const shifts = [{ id: "am", direction: "pickup" as const, departTime: "06:00", weekdays: [0, 1, 2, 3, 4, 5, 6], isActive: true }];
const days = Array.from({ length: 13 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
const leg = (day: string, passes: boolean, minutes = 60): SchoolLeg => ({
  vehicleKey: "v",
  day,
  weekday: new Date(`${day}T00:00:00Z`).getUTCDay(),
  startMinute: 6 * 60,
  endMinute: 6 * 60 + minutes,
  startedAtSchool: true,
  endedAtSchool: true,
  points: passes
    ? [{ minute: 380, lat: 25.43, lng: 82.965 }, { minute: 381, lat: 25.43, lng: 82.975 }]
    : [{ minute: 380, lat: 25.45, lng: 82.965 }, { minute: 381, lat: 25.45, lng: 82.975 }],
});
const legs = days.map((d, i) => leg(d, i < 10));
const alerts = detectRoadAlerts({ routeId: "r1", stops: [stop], stopsWithRiders: new Set(["st"]), shifts, legs });
assert.equal(alerts.length, 1);
assert.equal(alerts[0]!.kind, "stop_dropped");
assert.equal(alerts[0]!.since, "2026-10-11");
// No children at the stop → not checked.
assert.equal(detectRoadAlerts({ routeId: "r1", stops: [stop], stopsWithRiders: new Set(), shifts, legs }).length, 0);
// Back to normal → no alert.
assert.equal(detectRoadAlerts({ routeId: "r1", stops: [stop], stopsWithRiders: new Set(["st"]), shifts, legs: days.map((d) => leg(d, true)) }).length, 0);
// Slower: 60 min → 80 min on the last 3 days.
const slow = detectRoadAlerts({ routeId: "r1", stops: [stop], stopsWithRiders: new Set(["st"]), shifts, legs: days.map((d, i) => leg(d, true, i < 10 ? 60 : 80)) });
assert.deepEqual(slow.map((a) => a.kind), ["run_slower"]);
// A 5-minute wobble is not an alert.
assert.equal(detectRoadAlerts({ routeId: "r1", stops: [stop], stopsWithRiders: new Set(["st"]), shifts, legs: days.map((d, i) => leg(d, true, i < 10 ? 60 : 65)) }).length, 0);

assert.ok(Math.abs(fuelRupeesPerKm("cng").perKm - 3.875) < 0.01);
assert.ok(fuelRupeesPerKm("diesel").perKm > fuelRupeesPerKm("cng").perKm);

console.log("ok");
