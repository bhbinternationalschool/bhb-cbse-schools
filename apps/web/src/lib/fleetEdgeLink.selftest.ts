/**
 * Self-test: matching Fleet Edge vehicles to the transport desk.
 * Run: npx tsx apps/web/src/lib/fleetEdgeLink.selftest.ts
 *
 * The real fleet, on 2026-08-23. Fleet Edge had 4 198 events for six vehicles
 * and the Fleet and Live tabs showed nothing, because the desk keys vehicles
 * by registration and Fleet Edge keys them by VIN — and two desk rows had a
 * VIN typed into the registration field. Matching on registration alone
 * dropped a third of the fleet silently: the data arrived, was stored, and
 * appeared against no vehicle anyone could see.
 */

import assert from "node:assert/strict";

import {
  isPlaceholderVehicle,
  linkFleetEdgeToDesk,
  normalizeVehicleKey,
  telemetryFreshness,
  fleetRecordMatchesKeys,
  vehicleFleetKeys,
  type FleetEdgeVehicleStatus,
} from "./fleetEdgeLink";
import { chassisNoWarning, normalizeVehicle } from "./transport";

console.log("fleetEdgeLink.selftest.ts");

const status = (
  vin: string,
  reg: string | null,
  extra: Partial<FleetEdgeVehicleStatus> = {},
): FleetEdgeVehicleStatus => ({
  vin,
  registrationNumber: reg,
  lastSeenAt: "2026-08-23T05:00:00.000Z",
  lastEventType: "details",
  detailCount: 600,
  alertCount: 60,
  telemetryCount: 0,
  lastTelemetryAt: null,
  ...extra,
});

// Exactly what Fleet Edge holds for this school.
const edge = [
  status("MAT558053TVG40149", "NA"),
  status("MAT557029PUA00368", "UP65MT0849"),
  status("MAT558017RVE22810", "UP65PT3540"),
  status("MAT805022SFB02913", "UP65QT4657"),
  status("MAT558053TVE29204", "UP65RT9825"),
];

// ...and what the desk holds. Two rows carry a VIN, one is a hired van.
const desk = [
  { registrationNo: "UP65QT4657" },
  { registrationNo: "UP65MT0849" },
  { registrationNo: "UP65PT3540" },
  { registrationNo: "MAT558053TVE29204" },
  { registrationNo: "MAT558053TVG40149" },
  { registrationNo: "RAJESH VAN" },
];

const report = linkFleetEdgeToDesk(desk, (v) => v.registrationNo, edge);

/* ── THE fix: all five Tata vehicles match ──────────────────── */

assert.equal(report.matched.length, 5, "five of six desk vehicles match");
const on = new Map(
  report.matched.map((m) => [m.vehicle.registrationNo, m.matchedOn]),
);
assert.equal(on.get("UP65QT4657"), "registration");
assert.equal(on.get("MAT558053TVE29204"), "vin", "a mis-keyed VIN still matches");
assert.equal(on.get("MAT558053TVG40149"), "vin", "even with no registration at all");

// The right telemetry reaches the right vehicle — not just any match.
const rescued = report.matched.find(
  (m) => m.vehicle.registrationNo === "MAT558053TVE29204",
)!;
assert.equal(rescued.status.registrationNumber, "UP65RT9825");

/* ── the hired van is desk-only, and stays visible as such ──── */

assert.deepEqual(
  report.deskOnly.map((v) => v.registrationNo),
  ["RAJESH VAN"],
  "a vehicle Fleet Edge has never heard of is reported, not dropped",
);
assert.equal(report.edgeOnly.length, 0, "nothing reporting is left unaccounted for");

/* ── a vehicle reporting but absent from the desk is surfaced ─ */

const partial = linkFleetEdgeToDesk(
  [{ registrationNo: "UP65QT4657" }],
  (v) => v.registrationNo,
  edge,
);
assert.equal(partial.matched.length, 1);
assert.equal(partial.edgeOnly.length, 4, "four vehicles report but are not on the desk");

/* ── "NA" is not a registration ─────────────────────────────── */

assert.equal(normalizeVehicleKey("NA"), "");
assert.equal(normalizeVehicleKey(""), "");
assert.equal(normalizeVehicleKey(null), "");
assert.equal(normalizeVehicleKey("up65 qt-4657"), "UP65QT4657", "plates get typed loosely");

// Two unregistered vehicles must not match each other through "NA".
const twoBlank = linkFleetEdgeToDesk(
  [{ registrationNo: "NA" }],
  (v) => v.registrationNo,
  [status("VIN_A", "NA"), status("VIN_B", "NA")],
);
assert.equal(twoBlank.matched.length, 0, "a blank key matches nothing");
assert.equal(twoBlank.deskOnly.length, 1);

/* ── one Fleet Edge vehicle is not claimed twice ────────────── */

const duplicated = linkFleetEdgeToDesk(
  [{ registrationNo: "UP65RT9825" }, { registrationNo: "MAT558053TVE29204" }],
  (v) => v.registrationNo,
  [status("MAT558053TVE29204", "UP65RT9825")],
);
assert.equal(duplicated.matched.length, 2, "both desk rows resolve to it");
assert.equal(
  duplicated.edgeOnly.length,
  0,
  "and it is not then reported as unaccounted for",
);

/* ── chassis no.: the plate field can hold the plate ────────── */

// Magic-3: Fleet Edge sends plate "NA" and the VIN; the RC says UP65ST1373.
assert.deepEqual(
  vehicleFleetKeys({ registrationNo: "UP65ST1373", chassisNo: "MAT558053TVG40149" }),
  ["UP65ST1373", "MAT558053TVG40149"],
  "registration first, then chassis",
);
assert.deepEqual(vehicleFleetKeys({ registrationNo: "MAT558053TVG40149", chassisNo: "" }), ["MAT558053TVG40149"]);
assert.deepEqual(
  vehicleFleetKeys({ registrationNo: "mat558053 tvg40149", chassisNo: "MAT558053TVG40149" }),
  ["MAT558053TVG40149"],
  "the same key twice is one key",
);
assert.deepEqual(vehicleFleetKeys({ registrationNo: "NA", chassisNo: "" }), [], "NA is no key");
assert.deepEqual(vehicleFleetKeys({ registrationNo: "UP65QT4657", chassisNo: "MATXXXXXXXX" }), ["UP65QT4657"], "a placeholder VIN is never a key");
assert.deepEqual(vehicleFleetKeys(null), []);

assert.equal(fleetRecordMatchesKeys(["UP65ST1373", "MAT558053TVG40149"], "NA", "MAT558053TVG40149"), true);
assert.equal(fleetRecordMatchesKeys(["MAT558053TVG40149"], "NA", "MAT558053TVG40149"), true, "old shape still matches");
assert.equal(fleetRecordMatchesKeys(["UP65QT4657"], "UP65QT4657", "MAT805022SFB02913"), true, "plate-only unchanged");
assert.equal(fleetRecordMatchesKeys(["UP65QT4657"], "NA", "MAT558053TVG40149"), false);
assert.equal(fleetRecordMatchesKeys([], "NA", ""), false, "no keys match nothing");

// The full fleet after the lead's data update: every Tata vehicle carries its
// plate in Registration and its VIN in Chassis no.
const deskAfter = [
  { registrationNo: "UP65QT4657", chassisNo: "MAT805022SFB02913" },
  { registrationNo: "UP65MT0849", chassisNo: "MAT557029PUA00368" },
  { registrationNo: "UP65PT3540", chassisNo: "MAT558017RVE22810" },
  { registrationNo: "UP65RT9825", chassisNo: "MAT558053TVE29204" },
  { registrationNo: "UP65ST1373", chassisNo: "MAT558053TVG40149" },
  { registrationNo: "RAJESH VAN", chassisNo: "" },
];
const after = linkFleetEdgeToDesk(deskAfter, (v) => v, edge);
assert.equal(after.matched.length, 5, "all five Tata vehicles still match");
assert.equal(after.edgeOnly.length, 0);
assert.deepEqual(after.deskOnly.map((v) => v.registrationNo), ["RAJESH VAN"]);
const afterOn = new Map(after.matched.map((m) => [m.vehicle.registrationNo, m]));
assert.equal(afterOn.get("UP65ST1373")?.matchedOn, "chassis", "Magic-3 links through its chassis no.");
assert.equal(afterOn.get("UP65ST1373")?.status.vin, "MAT558053TVG40149");
assert.equal(afterOn.get("UP65RT9825")?.matchedOn, "registration", "registration first, even with a chassis no.");
assert.equal(afterOn.get("UP65QT4657")?.status.vin, "MAT805022SFB02913");

// Old shape (VIN in registration, no chassis) is unchanged.
const oldShape = linkFleetEdgeToDesk([{ registrationNo: "MAT558053TVG40149", chassisNo: "" }], (v) => v, edge);
assert.equal(oldShape.matched.length, 1);
assert.equal(oldShape.matched[0]!.matchedOn, "vin");

// No vehicle claims two Fleet Edge units: a plate pointing at one unit and a
// chassis no. pointing at another resolves to the plate's unit, once.
const split = linkFleetEdgeToDesk(
  [{ registrationNo: "UP65MT0849", chassisNo: "MAT558053TVG40149" }],
  (v) => v,
  edge,
);
assert.equal(split.matched.length, 1, "one vehicle, one unit");
assert.equal(split.matched[0]!.status.vin, "MAT557029PUA00368", "registration wins");
assert.ok(split.edgeOnly.some((s) => s.vin === "MAT558053TVG40149"), "the other unit stays unaccounted for, visibly");

// A placeholder chassis never claims Tata's test vehicle.
const dummy = linkFleetEdgeToDesk(
  [{ registrationNo: "TEMP1", chassisNo: "MATXXXXXXXX" }],
  (v) => v,
  [status("MATXXXXXXXX", "HRXXXXXX")],
);
assert.equal(dummy.matched.length, 0);

// The desk keeps the field: normalised uppercase, "" by default.
assert.equal(normalizeVehicle({ id: "v", registrationNo: "x" }).chassisNo, "");
assert.equal(normalizeVehicle({ id: "v", registrationNo: "x", chassisNo: " mat558053-tvg40149 " }).chassisNo, "MAT558053TVG40149");
const roundTrip = JSON.parse(JSON.stringify(normalizeVehicle({ id: "v", registrationNo: "UP65ST1373", chassisNo: "MAT558053TVG40149" })));
assert.equal(normalizeVehicle(roundTrip).chassisNo, "MAT558053TVG40149", "survives a save and reload");

assert.equal(chassisNoWarning(""), "");
assert.equal(chassisNoWarning("MAT558053TVG40149"), "");
assert.ok(/17 characters/.test(chassisNoWarning("MAT55805")), "short number warned");
assert.ok(/I, O or Q/.test(chassisNoWarning("MAT558053TVG4014O")), "letter O warned");

/* ── telemetry freshness is stated, never assumed ───────────── */

const NOW = Date.parse("2026-08-23T06:00:00.000Z");

const never = telemetryFreshness(edge, NOW);
assert.equal(never.live, false);
assert.equal(never.vehiclesReporting, 0);
assert.equal(never.newestAt, null);
assert.ok(/Basic Push/.test(never.reason), "names the feed that must be switched on");

// The real state: four rows, none since 14 August.
const stale = telemetryFreshness(
  [status("V1", "R1", { telemetryCount: 4, lastTelemetryAt: "2026-08-14T20:17:31.000Z" })],
  NOW,
);
assert.equal(stale.live, false, "eight days old is not live");
assert.ok(/8 days ago/.test(stale.reason), `should quantify: ${stale.reason}`);
assert.equal(stale.newestAt, "2026-08-14T20:17:31.000Z");

// And what a working feed looks like.
const fresh = telemetryFreshness(
  [status("V1", "R1", { telemetryCount: 900, lastTelemetryAt: "2026-08-23T05:55:00.000Z" })],
  NOW,
);
assert.equal(fresh.live, true);
assert.equal(fresh.vehiclesReporting, 1);
assert.equal(fresh.reason, "", "nothing to explain when it works");

/* ── Tata's own test vehicle is not a bus ───────────────────── */

// Pushed when the Basic Push subscription was activated, 10 Sep 2026.
assert.equal(
  isPlaceholderVehicle(status("MATXXXXXXXX", "HRXXXXXX")),
  true,
  "the activation dummy is recognised",
);
assert.equal(
  isPlaceholderVehicle(status("MATXXXXXXXX", null)),
  true,
  "VIN alone is enough",
);

// Every real vehicle on this fleet must survive it — misfiring here would
// hide a bus from the office, which is worse than showing a fake one.
for (const s of edge) {
  assert.equal(
    isPlaceholderVehicle(s),
    false,
    `${s.vin} / ${s.registrationNumber} is a real vehicle`,
  );
}

console.log("  ok");
