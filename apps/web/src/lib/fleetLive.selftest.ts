/**
 * Live buses — freshness, ETA, trip phase, linking and the owner-alert rules.
 * Run: npx tsx src/lib/fleetLive.selftest.ts
 */
import assert from "node:assert/strict";
import {
  ageSeconds,
  estimateEtaMinutes,
  evaluateFleetAlerts,
  haversineKm,
  istClock,
  positionForVehicle,
  positionFreshness,
  renderFleetAlertText,
  tripPhase,
  type LivePosition,
} from "./fleetLive";

console.log("fleetLive.selftest.ts");

const T0 = Date.parse("2026-09-10T12:00:00.000Z"); // 17:30 IST, Thursday
const at = (minsAgo: number) => new Date(T0 - minsAgo * 60_000).toISOString();

assert.equal(positionFreshness(at(1), T0), "live");
assert.equal(positionFreshness(at(10), T0), "recent");
assert.equal(positionFreshness(at(40), T0), "stale");
assert.equal(positionFreshness(at(-2), T0), "recent", "a clock slightly ahead is not stale");
assert.equal(ageSeconds(at(2), T0), 120);

// School to Ayar is about 1.5 km as the crow flies.
const school = { lat: 25.4354328, lng: 82.9439863 };
const ayar = { lat: 25.4320249, lng: 82.9582213 };
const d = haversineKm(school, ayar);
assert.ok(d > 1.3 && d < 1.6, `distance ${d}`);
assert.equal(estimateEtaMinutes(d), 5, "1.5 km ≈ 5 min at village speed");
assert.equal(estimateEtaMinutes(0.05), 1, "never under a minute");
assert.ok(estimateEtaMinutes(10, 40) < estimateEtaMinutes(10), "a bus already moving fast arrives sooner");

const win = { start: "06:00", end: "17:30", workingDays: [1, 2, 3, 4, 5, 6] };
assert.equal(tripPhase("07:10", 4, win), "morning");
assert.equal(tripPhase("13:40", 4, win), "afternoon");
assert.equal(tripPhase("19:00", 4, win), "off");
assert.equal(tripPhase("08:00", 0, win), "off", "Sunday is off");
assert.deepEqual(istClock(T0), { hhmm: "17:30", weekday: 4, dateIso: "2026-09-10" });

const positions: LivePosition[] = [
  { vehicleRef: "MAT558053TVE29204", registrationNumber: "UP65RT9825", recordedAt: at(1), lat: 25.44, lng: 82.96, speedKmh: 32, courseDeg: 90, ignitionOn: true, fuelPercent: 15, odometerKm: 41250 },
  { vehicleRef: "MAT557029PUA00368", registrationNumber: null, recordedAt: at(2), lat: 25.43, lng: 82.95, speedKmh: 0, courseDeg: null, ignitionOn: false, fuelPercent: 60, odometerKm: 12000 },
];
const vehicles = [
  { id: "veh_a", registrationNo: "UP65RT9825", name: "Magic-2", isActive: true, status: "active", odometerKm: 0, serviceSchedule: [{ task: "Engine oil", nextDueOn: null, nextDueOdo: 41500 }], compliance: [{ certType: "Insurance", expiryDate: "2026-09-20" }] },
  { id: "veh_b", registrationNo: "MAT557029PUA00368", name: "Bus — registration pending", isActive: true, status: "active", serviceSchedule: [], compliance: [] },
  { id: "veh_c", registrationNo: "RAJESH VAN", name: "Rajesh Van", isActive: true, status: "active", serviceSchedule: [{ task: "Brakes", nextDueOn: "2026-09-12" }], compliance: [] },
];

// Linking: plate first, VIN second, untracked stays untracked.
assert.equal(positionForVehicle(vehicles[0]!, positions)?.vehicleRef, "MAT558053TVE29204", "by plate");
assert.equal(positionForVehicle(vehicles[1]!, positions)?.vehicleRef, "MAT557029PUA00368", "by VIN when the desk holds a VIN as the plate");
assert.equal(positionForVehicle(vehicles[2]!, positions), null, "Rajesh's van has no tracker");

// 17:30 IST is inside the window: no out-of-hours alert, but low fuel + service + paper.
{
  const alerts = evaluateFleetAlerts({ vehicles, positions, nowMs: T0, lastSent: {} });
  const keys = alerts.map((a) => a.key).sort();
  assert.deepEqual(keys, ["compliance_due:veh_a", "low_fuel:veh_a", "service_due:veh_a", "service_due:veh_c"]);
  const fuel = alerts.find((a) => a.kind === "low_fuel")!;
  assert.match(fuel.detail, /15%/);
  assert.deepEqual(fuel.at, { lat: 25.44, lng: 82.96 });
  const svc = alerts.find((a) => a.key === "service_due:veh_a")!;
  assert.match(svc.detail, /Engine oil .*41500 km, now 41250 km/);
  assert.match(alerts.find((a) => a.key === "service_due:veh_c")!.detail, /Brakes by 2026-09-12/, "an untracked van still gets service alerts");
  assert.match(alerts.find((a) => a.kind === "compliance_due")!.detail, /Insurance expires 2026-09-20/);
}

// 21:40 IST: the moving bus is out of hours; the parked one is not.
{
  const night = Date.parse("2026-09-10T16:10:00.000Z");
  const nightPositions = positions.map((p) => ({ ...p, recordedAt: new Date(night - 60_000).toISOString() }));
  const alerts = evaluateFleetAlerts({ vehicles, positions: nightPositions, nowMs: night, lastSent: {} });
  const ooh = alerts.filter((a) => a.kind === "out_of_hours");
  assert.equal(ooh.length, 1);
  assert.equal(ooh[0]!.vehicleId, "veh_a");
  assert.match(ooh[0]!.detail, /32 km\/h at 21:40 IST/);
  // A stale position never raises a movement alert — the bus may have parked long ago.
  const stale = evaluateFleetAlerts({ vehicles, positions: positions.map((p) => ({ ...p, recordedAt: new Date(night - 40 * 60_000).toISOString() })), nowMs: night, lastSent: {} });
  assert.equal(stale.filter((a) => a.kind === "out_of_hours").length, 0);
  // Sunday morning at school speed is still out of hours.
  const sunday = Date.parse("2026-09-13T02:30:00.000Z"); // 08:00 IST Sunday
  const sun = evaluateFleetAlerts({ vehicles, positions: positions.map((p) => ({ ...p, recordedAt: new Date(sunday - 60_000).toISOString() })), nowMs: sunday, lastSent: {} });
  assert.equal(sun.filter((a) => a.kind === "out_of_hours").length, 1);
}

// Cooldown: an alert sent recently is not repeated; an old one is.
{
  const recent = { "low_fuel:veh_a": at(30), "service_due:veh_a": at(23 * 60), "compliance_due:veh_a": at(25 * 60), "service_due:veh_c": at(10) };
  const alerts = evaluateFleetAlerts({ vehicles, positions, nowMs: T0, lastSent: recent });
  assert.deepEqual(alerts.map((a) => a.key), ["compliance_due:veh_a"], "only the one past its 24 h cooldown");
}

// A Fleet Edge FuelDrain alert is relayed to the owner for the matching desk vehicle only.
{
  const alerts = evaluateFleetAlerts({
    vehicles,
    positions,
    nowMs: T0,
    lastSent: { "low_fuel:veh_a": at(1), "service_due:veh_a": at(1), "compliance_due:veh_a": at(1), "service_due:veh_c": at(1) },
    fuelDrains: [{ vehicleRef: "MAT558053TVE29204", registrationNumber: "UP65RT9825", at: at(5), detail: "drop 12 L · tank 40%", lat: 25.44, lng: 82.96 }, { vehicleRef: "MATUNKNOWN", registrationNumber: "UP00AA0000", at: at(5), detail: "" }],
  });
  assert.deepEqual(alerts.map((a) => a.key), ["fuel_drain:veh_a"]);
  assert.match(alerts[0]!.detail, /drop 12 L/);
}

const text = renderFleetAlertText({ key: "x", kind: "out_of_hours", vehicleId: "v", vehicleLabel: "Magic-2", title: "Bus moving outside school hours", detail: "Moving at 32 km/h.", at: { lat: 25.44, lng: 82.96 } }, "BHB", "2026-09-10 21:40 IST");
assert.match(text, /\*Bus moving outside school hours\*/);
assert.match(text, /https:\/\/maps\.google\.com\/\?q=25\.440000,82\.960000/);

console.log("  ok");
