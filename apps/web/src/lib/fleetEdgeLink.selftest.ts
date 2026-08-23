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
  linkFleetEdgeToDesk,
  normalizeVehicleKey,
  telemetryFreshness,
  type FleetEdgeVehicleStatus,
} from "./fleetEdgeLink";

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

console.log("  ok");
