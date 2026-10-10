/**
 * Self-test: which staff the fleet form offers as a driver.
 * Run: npx tsx apps/web/src/lib/transportCrew.selftest.ts
 *
 * The school types its own designation names — this roster really does spell
 * one of them "Transport Attendent" — so matching on a fixed id list or an
 * exact string would quietly drop real crew. It matches on the name, loosely.
 *
 * The rule that matters most: no masters loaded returns an EMPTY LIST, and the
 * caller must not render that as "nobody on the payroll drives". A missing
 * roster and a roster with no drivers are different facts.
 */

import assert from "node:assert/strict";

import { listTransportCrew } from "./transportPlanner";
import type { MastersState } from "./masters";

console.log("transportCrew.selftest.ts");

const designations = [
  { id: "d_drv", code: "DRV", name: "Driver", departmentId: null, isActive: true },
  { id: "d_att", code: "ATT", name: "Transport Attendent", departmentId: null, isActive: true },
  { id: "d_tch", code: "TCH", name: "Teacher", departmentId: null, isActive: true },
  { id: "d_swp", code: "SWP", name: "Sweeper", departmentId: null, isActive: true },
  { id: "d_vp", code: "VP", name: "VEHICLE PROVIDER", departmentId: null, isActive: true },
];

const staff = [
  { id: "s1", fullName: "RAM LAL", designationId: "d_drv", mobile: "9876543210", status: "active" },
  { id: "s2", fullName: "SHYAM", designationId: "d_drv", mobile: "", status: "active" },
  { id: "s3", fullName: "GEETA", designationId: "d_att", mobile: "9000000001", status: "active" },
  { id: "s4", fullName: "MEERA", designationId: "d_tch", mobile: "9000000002", status: "active" },
  { id: "s5", fullName: "OLD DRIVER", designationId: "d_drv", mobile: "9000000003", status: "inactive" },
  { id: "s6", fullName: "SWEEPER JI", designationId: "d_swp", mobile: "9000000004", status: "active" },
];

const masters = { designations, staff } as unknown as MastersState;
const crew = listTransportCrew(masters);
const names = crew.map((c) => c.fullName);

/* ── who is offered ─────────────────────────────────────────── */

assert.ok(names.includes("RAM LAL"), "a Driver is offered");
assert.ok(names.includes("GEETA"), "the school's own spelling 'Attendent' still matches");
assert.ok(names.includes("SHYAM"), "a driver with no mobile is still offered");

/* ── who is not ─────────────────────────────────────────────── */

assert.equal(names.includes("MEERA"), false, "a teacher is not a driver");
assert.equal(names.includes("SWEEPER JI"), false, "a sweeper is not a driver");
assert.equal(
  names.includes("OLD DRIVER"),
  false,
  "someone who has left must not be assignable to a bus",
);

/* ── can they actually sign in ──────────────────────────────── */

// Surfaced, never used to filter. A driver with no mobile is still the right
// person to record against the vehicle — they just cannot open the app, and
// the office needs to see which of the two things is missing.
assert.equal(crew.find((c) => c.fullName === "RAM LAL")!.canSignIn, true);
assert.equal(crew.find((c) => c.fullName === "SHYAM")!.canSignIn, false);
assert.equal(crew.find((c) => c.fullName === "SHYAM")!.mobile, "");

// A short or junk number is not a login either.
const short = listTransportCrew({
  designations,
  staff: [{ id: "sx", fullName: "X", designationId: "d_drv", mobile: "12345", status: "active" }],
} as unknown as MastersState);
assert.equal(short[0].canSignIn, false, "a 5-digit number cannot receive an OTP");

/* ── THE protection: no roster is not "no drivers" ──────────── */

assert.deepEqual(listTransportCrew(null), [], "null masters yields nothing");
assert.deepEqual(
  listTransportCrew({ designations: [], staff: [] } as unknown as MastersState),
  [],
);
// Both return []. The form must therefore distinguish "masters not loaded"
// from "loaded, and nobody has a driver designation" — it cannot learn that
// from this list, which is exactly why the caller checks `masters` itself.

/* ── stable order for a dropdown ────────────────────────────── */

const ordered = listTransportCrew(masters).map((c) => `${c.designation}/${c.fullName}`);
assert.deepEqual(
  ordered,
  ["Driver/RAM LAL", "Driver/SHYAM", "Transport Attendent/GEETA"],
  "grouped by designation, then by name",
);

console.log("  ok");
