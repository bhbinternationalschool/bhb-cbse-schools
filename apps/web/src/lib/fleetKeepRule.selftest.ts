/**
 * Self-test: bus positions are kept 6:00 AM–3:30 PM IST, and after that only
 * while moving (or when the engine is started / switched off).
 * Run: npx tsx src/lib/fleetKeepRule.selftest.ts
 */

import assert from "node:assert/strict";

import { inTransportDay, istMinuteOfDay, shouldKeepTelemetry } from "./fleetKeepRule";

console.log("fleetKeepRule.selftest.ts");

const ist = (hhmm: string) => new Date(`2026-09-15T${hhmm}:00+05:30`);

assert.equal(istMinuteOfDay(ist("06:00")), 360);
assert.equal(inTransportDay(ist("05:59")), false);
assert.equal(inTransportDay(ist("06:00")), true);
assert.equal(inTransportDay(ist("15:29")), true);
assert.equal(inTransportDay(ist("15:30")), false, "3:30 PM is the end");
assert.equal(inTransportDay(ist("23:00")), false);

// Transport day: everything, parked or not.
assert.deepEqual(shouldKeepTelemetry({ at: ist("09:00"), speedKmh: 0, ignitionOn: false }), { keep: true, reason: "transport_day" });

// After hours: parked is dropped, moving is kept.
assert.equal(shouldKeepTelemetry({ at: ist("02:00"), speedKmh: 0, ignitionOn: false }).keep, false);
assert.equal(shouldKeepTelemetry({ at: ist("17:00"), speedKmh: 2, ignitionOn: true, lastIgnitionOn: true }).keep, false, "GPS drift / idling is not moving");
assert.deepEqual(shouldKeepTelemetry({ at: ist("22:40"), speedKmh: 34, ignitionOn: true }), { keep: true, reason: "moving" });

// The engine starting or stopping at night is on record.
assert.deepEqual(shouldKeepTelemetry({ at: ist("01:10"), speedKmh: 0, ignitionOn: true, lastIgnitionOn: false }), { keep: true, reason: "ignition_changed" });
assert.deepEqual(shouldKeepTelemetry({ at: ist("23:55"), speedKmh: 0, ignitionOn: false, lastIgnitionOn: true }), { keep: true, reason: "ignition_changed" });
// Unknown previous state (fresh server) is not treated as a change.
assert.equal(shouldKeepTelemetry({ at: ist("01:10"), speedKmh: 0, ignitionOn: true }).keep, false);

console.log("  ok");
