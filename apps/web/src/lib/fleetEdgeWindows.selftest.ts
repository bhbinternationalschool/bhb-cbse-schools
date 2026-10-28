/**
 * Self-test: a re-sent Fleet Edge window or alert counts once, from the
 * latest copy received.
 * Run: npx tsx src/lib/fleetEdgeWindows.selftest.ts
 */

import assert from "node:assert/strict";

import { dedupeFleetEdgeEvents, fleetEdgeRepeatKey, type FleetEdgeDedupeInput } from "./fleetEdgeWindows";

console.log("fleetEdgeWindows.selftest.ts");

let seq = 0;
function ev(over: Partial<FleetEdgeDedupeInput> & { payload?: Record<string, unknown> }): FleetEdgeDedupeInput {
  seq += 1;
  return {
    id: `e${String(seq).padStart(3, "0")}`,
    event_type: "details",
    alert_name: null,
    vehicle_ref: "MAT558053TVG40149",
    registration_number: "NA",
    received_at: `2026-10-05T08:${String(seq).padStart(2, "0")}:00Z`,
    payload: {},
    ...over,
  };
}
const km = (e: FleetEdgeDedupeInput) => (e.payload?.vehiclePerformance as { distanceTravelled: number }).distanceTravelled;

// Four identical pushes of one window → one.
{
  const w = { from: "2026-10-05T07:30:00", to: "2026-10-05T08:00:00", vehiclePerformance: { distanceTravelled: 4 } };
  const list = [ev({ payload: w }), ev({ payload: w }), ev({ payload: w }), ev({ payload: w })];
  const r = dedupeFleetEdgeEvents(list);
  assert.equal(r.events.length, 1);
  assert.equal(r.dropped, 3);
  assert.equal(r.events[0], list[3], "the latest received copy is kept");
}

// A later push revises the window (3 → 4 km): the revision counts.
{
  const a = ev({ payload: { from: "2026-10-05T07:30:00", vehiclePerformance: { distanceTravelled: 3 } } });
  const b = ev({ payload: { from: "2026-10-05T07:30:00", vehiclePerformance: { distanceTravelled: 4 } } });
  // Fed out of order — received_at decides, not position.
  const r = dedupeFleetEdgeEvents([b, a]);
  assert.equal(r.events.length, 1);
  assert.equal(km(r.events[0]), 4);
}

// Same received_at → the higher id wins (deterministic).
{
  const a = ev({ id: "x1", received_at: "2026-10-05T09:00:00Z", payload: { from: "W", vehiclePerformance: { distanceTravelled: 1 } } });
  const b = ev({ id: "x2", received_at: "2026-10-05T09:00:00Z", payload: { from: "W", vehiclePerformance: { distanceTravelled: 2 } } });
  assert.equal(km(dedupeFleetEdgeEvents([b, a]).events[0]), 2);
}

// Different windows, different vehicles: all kept.
{
  const list = [
    ev({ payload: { from: "2026-10-05T07:00:00" } }),
    ev({ payload: { from: "2026-10-05T07:30:00" } }),
    ev({ vehicle_ref: "MAT557029PUA00368", payload: { from: "2026-10-05T07:30:00" } }),
  ];
  assert.equal(dedupeFleetEdgeEvents(list).events.length, 3);
}

// Plate only (no VIN) still keys by vehicle; case does not split a vehicle.
{
  const list = [
    ev({ vehicle_ref: null, registration_number: "UP65RT9825", payload: { from: "W1" } }),
    ev({ vehicle_ref: null, registration_number: "up65rt9825", payload: { from: "W1" } }),
  ];
  assert.equal(dedupeFleetEdgeEvents(list).events.length, 1);
}

// No window start → cannot be matched, never merged on a guess.
{
  const list = [ev({ payload: {} }), ev({ payload: {} }), ev({ payload: { from: "" } })];
  assert.equal(fleetEdgeRepeatKey(list[0]), null);
  assert.equal(dedupeFleetEdgeEvents(list).events.length, 3);
}

// Alerts: same vehicle + name + eventDateTime is a repeat; anything else is not.
{
  const sos = (at: string | undefined, name = "PanicSosEvent") =>
    ev({ event_type: "alert", alert_name: name, payload: at ? { eventDateTime: at } : {} });
  const list = [
    sos("2026-10-05T07:41:12"),
    sos("2026-10-05T07:41:12"),
    sos("2026-10-05T07:41:12", "OverSpeedEvent"),
    sos("2026-10-05T07:42:00"),
    sos(undefined),
    sos(undefined),
  ];
  const r = dedupeFleetEdgeEvents(list);
  assert.equal(r.events.length, 5, "only the exact repeat is dropped; undated alerts stay");
  assert.equal(r.events.includes(list[0]), false, "latest copy kept");
}

// Telemetry passes through untouched; survivors keep input order.
{
  const t1 = ev({ event_type: "telemetry", payload: { from: "W" } });
  const d1 = ev({ payload: { from: "W" } });
  const t2 = ev({ event_type: "telemetry", payload: { from: "W" } });
  const d2 = ev({ payload: { from: "W" } });
  const r = dedupeFleetEdgeEvents([t1, d1, t2, d2]);
  assert.deepEqual(r.events, [t1, t2, d2]);
}

// The 14 Oct 2026 shape: ~4 pushes per window → totals come back to one per window.
{
  const list: FleetEdgeDedupeInput[] = [];
  for (let w = 0; w < 10; w++) {
    for (let k = 0; k < 4; k++) list.push(ev({ payload: { from: `2026-09-01T0${w}:00:00`, vehiclePerformance: { distanceTravelled: 5 } } }));
  }
  const sum = (xs: FleetEdgeDedupeInput[]) => xs.reduce((a, e) => a + km(e), 0);
  assert.equal(sum(list), 200);
  assert.equal(sum(dedupeFleetEdgeEvents(list).events), 50);
}

console.log("  ok");
