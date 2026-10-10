/**
 * Self-test: who may read the bus manifest and mark a child aboard.
 * Run: npx tsx apps/web/src/lib/transportCrewAccess.selftest.ts
 *
 * Why this exists. The manifest and boarding routes were first gated on
 * `persona !== "staff" && persona !== "field"`, which was wrong twice over:
 *
 *   - Every driver signs in through staff OTP, which mints persona "staff"
 *     exactly as it does for a teacher. Nothing in the codebase has ever
 *     minted "field", so the persona check could not tell a driver from
 *     anyone else on the payroll.
 *   - Which meant it let every teacher, accountant and gardener read the
 *     names, classes and pick-up points of every child on every bus.
 *
 * The line that actually separates them is the transport grant. This file
 * pins it: a teacher must never read the manifest, and a driver must always
 * be able to.
 */

import assert from "node:assert/strict";

import {
  defaultRbacState,
  hasPermission,
  normalizeRbacState,
  type RbacState,
  type SessionLike,
} from "./rbac";

console.log("transportCrewAccess.selftest.ts");

const session = (roleCode: string, persona: SessionLike["persona"] = "staff"): SessionLike =>
  ({ roleCode, persona, fullName: roleCode, staffId: "" }) as SessionLike;

const canRead = (roleCode: string, rbac: RbacState, persona?: SessionLike["persona"]) =>
  hasPermission(session(roleCode, persona), null, "transport", "view", rbac);

/* ── against the built-in roles ─────────────────────────────── */

const base = defaultRbacState();

// The people the feature is for.
assert.equal(canRead("driver", base), true, "a driver must reach their own manifest");
assert.equal(canRead("transport", base), true, "transport desk staff too");

// The people it must keep out. A teacher on the payroll is not entitled to
// the pick-up point of a child they do not teach.
assert.equal(canRead("teacher", base), false, "a teacher must NOT read the bus roster");
assert.equal(canRead("parent", base, "parent"), false, "a parent must NOT read it");

// Oversight roles legitimately see it.
for (const rc of ["owner", "principal", "admin", "office", "accounts"]) {
  assert.equal(canRead(rc, base), true, `${rc} should retain transport view`);
}

/* ── against production's persisted role set ────────────────── */

// Production stores its own roles; the driver role there is view-only, which
// is exactly why the boarding write is gated on `view` and not on `create`.
// If someone later tightens boarding to `create` without first granting it to
// the Driver role, this assertion is the thing that should stop them.
const persisted = normalizeRbacState({
  version: 1,
  roles: [
    { id: "role_driver", code: "driver", name: "Driver", isBuiltIn: true, isActive: true,
      makerChecker: false, note: "", permissions: [{ module: "transport", actions: ["view"] }] },
    { id: "role_teacher", code: "teacher", name: "Teacher", isBuiltIn: true, isActive: true,
      makerChecker: false, note: "", permissions: [{ module: "students", actions: ["view"] }] },
  ],
  assignments: [],
  audit: [],
} as Partial<RbacState>);

assert.equal(canRead("driver", persisted), true, "persisted driver keeps transport view");
assert.equal(
  hasPermission(session("driver"), null, "transport", "create", persisted),
  false,
  "persisted driver has NO transport.create — boarding must not require it",
);

// And the merge that produced that state does not quietly hand a teacher a
// transport grant just because the built-in default gained one.
assert.equal(canRead("teacher", persisted), false, "teacher stays out after normalize");

/* ── the persona that never existed ─────────────────────────── */

// Kept working for the password login path, which still reads a stored
// persona — but it must not be the only way in, because nothing mints it.
assert.equal(
  canRead("driver", base, "field"),
  true,
  "a field-persona driver still reads the manifest",
);

console.log("  ok");
