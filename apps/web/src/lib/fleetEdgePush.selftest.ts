/**
 * Self-test: telling Fleet Edge's push streams apart on one endpoint.
 * Run: npx tsx apps/web/src/lib/fleetEdgePush.selftest.ts
 *
 * Every fixture below is a real payload this fleet received, copied from
 * fleet_edge_events, not written from the vendor's example PDF — the two
 * have already disagreed once (the doc's "DriverSOSAlert" is "PanicSosEvent"
 * in live traffic, and 159 panic presses went unrecognised because of it).
 */

import assert from "node:assert/strict";

import { classifyFleetEdgePush, FUEL_FIELDS, pickNumber } from "./fleetEdgePush";

console.log("fleetEdgePush.selftest.ts");

/* ── the four real shapes ───────────────────────────────────── */

// A driver panic press, 7 Sep 2026, UP65MT0849. The most expensive payload
// in the system to misfile: this is what starts the WhatsApp escalation.
const sos = {
  alertName: "PanicSosEvent",
  timestamp: "2026-09-07T08:36:39.965424666",
  vehicleId: "MAT557029PUA00368",
  eventDetails: {
    latitude: 25.4354736,
    longitude: 82.9443328,
    location: "Aura Vedi Puari Khurd Road, Baniapur, Sadar, Varanasi District",
  },
  eventDateTime: "2026-09-07T08:36:35.000000123",
  subscriptionId: "e3f33fa2-8e6e-4d31-a50e-21eb88be39d8",
  registrationNumber: "UP65MT0849",
};

// A periodic summary, the last one that arrived before the endpoint switch.
const details = {
  from: "2026-09-08T04:00:00",
  to: "2026-09-08T04:30:00",
  subscriptionId: "e3f33fa2-8e6e-4d31-a50e-21eb88be39d8",
  timestamp: "2026-09-08T04:30:00",
  vehicleId: "MAT558017RVE22810",
  registrationNumber: "UP65PT3540",
  vehicleSafety: { harshBraking: 0 },
  vehiclePerformance: { distance: 12.4 },
  vehicleEfficiency: { mileage: 5.1 },
};

// A Basic Push snapshot, 10 Sep 2026 — parked at the school, ignition off.
const telemetry = {
  imei: "869128069282951",
  speed: 0,
  gpsFix: true,
  crankOn: false,
  odometer: 25261,
  vehicleId: "MAT558017RVE22810",
  ignitionOn: false,
  gpsLatitude: 25.4354656,
  gpsLongitude: 82.94432,
  eventDateTime: "2026-09-10T12:09:39.000000921",
  vehicleStatus: "Stopped",
  registrationNumber: "UP65PT3540",
};

// The undocumented ping: identity and nothing else, once a minute since
// 14 August. 4,834 of these were counted as periodic summaries.
const heartbeat = {
  vehicleId: "MAT558053TVG40149",
  registrationNumber: "NA",
};

assert.equal(classifyFleetEdgePush(sos), "alert");
assert.equal(classifyFleetEdgePush(details), "details");
assert.equal(classifyFleetEdgePush(telemetry), "telemetry");
assert.equal(classifyFleetEdgePush(heartbeat), "heartbeat");

/* ── the streams must not bleed into each other ─────────────── */

// An alert carries a position too, nested under eventDetails as
// latitude/longitude. If that ever counted as telemetry, an SOS would be
// filed as a GPS ping and nobody would be called.
assert.equal(
  classifyFleetEdgePush({ ...sos, eventDetails: { latitude: 1, longitude: 2 } }),
  "alert",
  "a located alert is still an alert",
);

// Alerts and summaries share subscriptionId/timestamp/vehicleId. Neither may
// collapse into the ping shape.
assert.notEqual(classifyFleetEdgePush(sos), "heartbeat");
assert.notEqual(classifyFleetEdgePush(details), "heartbeat");

// A summary whose four blocks are all absent is still a summary — it says
// which window it covers, which a ping never does.
assert.equal(
  classifyFleetEdgePush({
    from: "2026-09-08T04:00:00",
    to: "2026-09-08T04:30:00",
    vehicleId: "V1",
  }),
  "details",
  "an empty window is a window",
);

// A vehicle reporting position with the engine off must not read as a ping
// just because its other fields are zero or false.
assert.equal(
  classifyFleetEdgePush({ vehicleId: "V1", ignitionOn: false, gpsFix: false }),
  "telemetry",
);

/* ── nothing is guessed ─────────────────────────────────────── */

// Rejected outright: not an object at all.
for (const bad of [null, undefined, "", "{}", 7, [], [{ vehicleId: "V1" }]]) {
  assert.equal(classifyFleetEdgePush(bad), null, `${JSON.stringify(bad)} is not a push`);
}

// Recognised as nothing, which is not the same as rejected. A shape the
// vendor adds later must be storable and countable-as-nothing, never forced
// into whichever stream happens to look closest.
assert.equal(
  classifyFleetEdgePush({ vehicleId: "V1", driverBehaviourScore: 82 }),
  "unknown",
);
assert.equal(classifyFleetEdgePush({}), "unknown", "an empty object is not a ping");

// A blank alertName is a malformed alert, not an alert — but it is not a
// ping either, and calling it one would DISCARD it. "unknown" keeps it: the
// row is stored, counted as nothing, and visible to whoever goes looking.
assert.equal(classifyFleetEdgePush({ alertName: "   ", vehicleId: "V1" }), "unknown");

/* ── fuel levels, whichever way Tata spell them ─────────────── */

// What the wire actually sends today (Tata's own test vehicle, the only
// thing on this fleet that has ever reported a tank).
const wire = {
  noOfFuelTanks: 1,
  primaryFuelLevel: 0,
  primaryFuelTankCapacity: 365,
  secondaryFuelLevel1: 1500,
  secondaryFuelTankCapacity1: 55555,
};
assert.equal(pickNumber(wire, FUEL_FIELDS.primaryLevel), 0);
assert.equal(pickNumber(wire, FUEL_FIELDS.primaryCapacity), 365);
assert.equal(pickNumber(wire, FUEL_FIELDS.secondaryLevel), 1500);
assert.equal(pickNumber(wire, FUEL_FIELDS.secondaryCapacity), 55555);

// What the spec PDF says: PrimaryFuelLevel and SecondaryFuelLevel1
// capitalised, their capacity twins not. If Tata ever conform to their own
// document, the tank must keep reading.
const perSpec = {
  PrimaryFuelLevel: 42,
  primaryFuelTankCapacity: 365,
  SecondaryFuelLevel1: 1500,
  secondaryFuelTankCapacity1: 55555,
};
assert.equal(pickNumber(perSpec, FUEL_FIELDS.primaryLevel), 42);
assert.equal(pickNumber(perSpec, FUEL_FIELDS.secondaryLevel), 1500);

// Any casing at all, since the doc and the wire already disagree.
assert.equal(pickNumber({ PRIMARYFUELLEVEL: 7 }, FUEL_FIELDS.primaryLevel), 7);
assert.equal(pickNumber({ secondaryfuellevel1: 9 }, FUEL_FIELDS.secondaryLevel), 9);

// Zero is a fuel level. A tank read as empty must not come back as "absent"
// — an empty CNG cylinder is the reading that matters most.
assert.equal(pickNumber({ primaryFuelLevel: 0 }, FUEL_FIELDS.primaryLevel), 0);

// Absent stays absent, and a non-number is not a reading.
assert.equal(pickNumber({}, FUEL_FIELDS.primaryLevel), null);
assert.equal(pickNumber({ primaryFuelLevel: "45" }, FUEL_FIELDS.primaryLevel), null);
assert.equal(pickNumber({ primaryFuelLevel: NaN }, FUEL_FIELDS.primaryLevel), null);

// Never reaches across to a different field just because it looks similar.
assert.equal(
  pickNumber({ primaryFuelTankCapacity: 365 }, FUEL_FIELDS.primaryLevel),
  null,
  "capacity is not a level",
);
assert.equal(
  pickNumber({ secondaryFuelLevel1: 1500 }, FUEL_FIELDS.primaryLevel),
  null,
  "tank 2 is not tank 1",
);

// The wire spelling wins when a payload somehow carries both.
assert.equal(
  pickNumber({ primaryFuelLevel: 1, PrimaryFuelLevel: 2 }, FUEL_FIELDS.primaryLevel),
  1,
);

console.log("  ok");
