/**
 * Live vehicle positions.
 *
 * The rule under test is that a position is never worth more than its age.
 * A fix from twenty minutes ago is not "where the bus is", and the failure
 * being guarded against is a parent driving to where the bus used to be —
 * so every refusal carries a specific reason and nothing is ever inferred.
 *
 * The second rule is that a tracker which has lost its fix must produce no
 * position at all rather than a plausible one: 0,0 is the Gulf of Guinea, and
 * a school bus drawn there is worse than a blank map.
 *
 * Run: npx tsx src/lib/fleetLivePosition.selftest.ts
 */
import assert from "node:assert/strict";

import {
  FRESHNESS_LIVE_MS,
  FRESHNESS_RECENT_MS,
  inTripWindow,
  istMinutesOfDay,
  mapsLink,
  parentPositionVerdict,
  parseTelemetryPosition,
  positionAgeLabel,
  positionFreshness,
  vehicleMotion,
  type LivePosition,
} from "./fleetLivePosition";

console.log("fleetLivePosition.selftest.ts");

const AT = "2026-09-10T12:28:52.626Z";
const NOW = Date.parse(AT) + 30_000; // half a minute later

// A real ping, exactly as production sends it (values seen 2026-09-10).
{
  const pos = parseTelemetryPosition(
    { gpsLatitude: 25.435608, gpsLongitude: 82.9444224, speed: 0, ignitionOn: false },
    AT,
  );
  assert.ok(pos, "a well-formed ping parses");
  assert.equal(pos!.lat, 25.435608);
  assert.equal(pos!.lng, 82.9444224);
  assert.equal(pos!.ignitionOn, false);
  assert.equal(pos!.speed, 0);
}

// Numerics as strings: not seen in production, accepted anyway — the vendor
// publishes example payloads, not a schema.
{
  const pos = parseTelemetryPosition(
    { gpsLatitude: "25.4354928", gpsLongitude: "82.94432", speed: "18", ignitionOn: "true" },
    AT,
  );
  assert.ok(pos, "string numerics still parse");
  assert.equal(pos!.speed, 18);
  assert.equal(pos!.ignitionOn, true);
}

// A lost fix must produce nothing, not a plausible-looking point.
{
  assert.equal(parseTelemetryPosition({ gpsLatitude: 0, gpsLongitude: 0 }, AT), null, "null island is not a fix");
  assert.equal(parseTelemetryPosition({ gpsLatitude: 25.4, gpsLongitude: undefined }, AT), null);
  assert.equal(parseTelemetryPosition({ gpsLatitude: "abc", gpsLongitude: "82.9" }, AT), null);
  assert.equal(parseTelemetryPosition({ gpsLatitude: 95, gpsLongitude: 82.9 }, AT), null, "out of range");
  assert.equal(parseTelemetryPosition(null, AT), null);
  assert.equal(parseTelemetryPosition({ gpsLatitude: 25.4, gpsLongitude: 82.9 }, ""), null, "a fix with no time is not a fix");
}

// Age bands.
{
  const t = Date.parse(AT);
  assert.equal(positionFreshness(AT, t + 1000), "live");
  assert.equal(positionFreshness(AT, t + FRESHNESS_LIVE_MS + 1), "recent");
  assert.equal(positionFreshness(AT, t + FRESHNESS_RECENT_MS + 1), "stale");
  assert.equal(positionFreshness(AT, t + 3 * 60 * 60 * 1000), "cold");
  assert.equal(positionFreshness("not a date", t), "cold", "an unparseable time is cold, never live");
}

// Age reads as a human would say it.
{
  const t = Date.parse(AT);
  assert.equal(positionAgeLabel(AT, t + 5_000), "just now");
  assert.equal(positionAgeLabel(AT, t + 60_000), "1 min ago");
  assert.equal(positionAgeLabel(AT, t + 4 * 60_000), "4 min ago");
  assert.equal(positionAgeLabel(AT, t + 60 * 60_000), "1 h ago");
  assert.equal(positionAgeLabel(AT, t + 26 * 60 * 60_000), "1 day ago");
}

// Ignition, not speed, decides whether a run is still happening.
{
  const at = AT;
  assert.equal(vehicleMotion({ lat: 1, lng: 1, speed: 42, ignitionOn: true, at }), "moving");
  assert.equal(
    vehicleMotion({ lat: 1, lng: 1, speed: 0, ignitionOn: true, at }),
    "idling",
    "a bus waiting at a stop with the engine on has not finished its run",
  );
  assert.equal(vehicleMotion({ lat: 1, lng: 1, speed: 0, ignitionOn: false, at }), "parked");
  assert.equal(vehicleMotion({ lat: 1, lng: 1, speed: null, ignitionOn: null, at }), "unknown");
  assert.equal(vehicleMotion(null), "unknown");
  // GPS jitter while parked must not read as movement.
  assert.equal(vehicleMotion({ lat: 1, lng: 1, speed: 2, ignitionOn: false, at }), "parked");
}

// IST windows, computed without a timezone library.
{
  // 07:30 IST on a school morning = 02:00 UTC.
  const morning = Date.parse("2026-09-10T02:00:00Z");
  assert.equal(istMinutesOfDay(morning), 7 * 60 + 30);
  assert.equal(inTripWindow(morning), true);

  const afternoon = Date.parse("2026-09-10T08:30:00Z"); // 14:00 IST
  assert.equal(inTripWindow(afternoon), true);

  const midMorning = Date.parse("2026-09-10T05:00:00Z"); // 10:30 IST
  assert.equal(inTripWindow(midMorning), false, "between the runs is not a trip window");

  const night = Date.parse("2026-09-10T18:00:00Z"); // 23:30 IST
  assert.equal(inTripWindow(night), false);
}

// What a parent may be told.
{
  const onRun: LivePosition = { lat: 25.43, lng: 82.94, speed: 24, ignitionOn: true, at: AT };
  const good = parentPositionVerdict({ position: onRun, hasVehicle: true, nowMs: NOW });
  assert.equal(good.share, true, "a fresh fix with the engine running is shareable");

  // No vehicle allotted at all.
  assert.deepEqual(
    parentPositionVerdict({ position: null, hasVehicle: false, nowMs: NOW }),
    { share: false, reason: "no-vehicle" },
  );
  // Allotted, but that vehicle has no tracker — City Bus, Winger, Rajesh Van.
  assert.deepEqual(
    parentPositionVerdict({ position: null, hasVehicle: true, nowMs: NOW }),
    { share: false, reason: "no-feed" },
  );
  // Engine off, outside the run: this is a bus on the driver's drive.
  const parkedAtNight: LivePosition = {
    lat: 25.43, lng: 82.94, speed: 0, ignitionOn: false,
    at: "2026-09-10T18:00:00Z",
  };
  assert.deepEqual(
    parentPositionVerdict({
      position: parkedAtNight,
      hasVehicle: true,
      nowMs: Date.parse("2026-09-10T18:00:30Z"),
    }),
    { share: false, reason: "off-trip" },
  );
  // Stale wins over everything: never dress an old fix as a location.
  const stale: LivePosition = { lat: 25.43, lng: 82.94, speed: 30, ignitionOn: true, at: AT };
  assert.deepEqual(
    parentPositionVerdict({
      position: stale,
      hasVehicle: true,
      nowMs: Date.parse(AT) + 20 * 60 * 1000,
    }),
    { share: false, reason: "too-old" },
    "a 20-minute-old fix is not where the bus is",
  );
}

// Ignition on overrides the clock — a late run still answers.
{
  const lateRun: LivePosition = {
    lat: 25.43, lng: 82.94, speed: 30, ignitionOn: true,
    at: "2026-09-10T11:00:00Z", // 16:30 IST, past the afternoon window
  };
  const v = parentPositionVerdict({
    position: lateRun,
    hasVehicle: true,
    nowMs: Date.parse("2026-09-10T11:00:30Z"),
  });
  assert.equal(v.share, true, "a bus still running past the window is still running");
}

// The link is what a person actually wants from a coordinate pair.
{
  assert.equal(
    mapsLink({ lat: 25.435608, lng: 82.9444224 }),
    "https://www.google.com/maps?q=25.435608,82.944422",
  );
}

console.log("OK");
