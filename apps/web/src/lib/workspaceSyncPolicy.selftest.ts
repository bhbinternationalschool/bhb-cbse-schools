/**
 * The idle-logout window is a standing policy, not a tunable.
 *
 * Director's instruction, 2026-09-06: thirty minutes, for every session, and
 * permanent. It had been five; each forced sign-in re-minted the session and
 * that day the session came back in the wrong academic year, so the office
 * saw the student list and the books appear and disappear all evening.
 *
 * This test fails the suite if anyone lowers it. Raising it is allowed.
 *
 * Run: npx tsx src/lib/workspaceSyncPolicy.selftest.ts
 */
import assert from "node:assert/strict";
import {
  WORKSPACE_INACTIVITY_MIN_MINUTES,
  WORKSPACE_INACTIVITY_MS,
} from "@/lib/workspaceSyncPolicy";

assert.ok(
  WORKSPACE_INACTIVITY_MIN_MINUTES >= 30,
  `idle logout floor is 30 minutes by standing policy; found ${WORKSPACE_INACTIVITY_MIN_MINUTES}`,
);
assert.equal(
  WORKSPACE_INACTIVITY_MS,
  WORKSPACE_INACTIVITY_MIN_MINUTES * 60 * 1000,
  "WORKSPACE_INACTIVITY_MS must be derived from the minutes constant, not typed separately",
);
assert.ok(
  WORKSPACE_INACTIVITY_MS >= 30 * 60 * 1000,
  "idle logout must be at least thirty minutes",
);

console.log(
  `workspaceSyncPolicy: idle logout ${WORKSPACE_INACTIVITY_MIN_MINUTES} min — ok`,
);
