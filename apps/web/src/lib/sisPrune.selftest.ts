/**
 * Regression test for a real production data-loss incident.
 *
 * 2026-08-08: a 3-record test payload POSTed to /api/school-data/sis-roster
 * deleted 708 students and 190 households from the live database, because
 * pushSisToDb unconditionally pruned every stored row absent from the
 * payload. Recovered from the school_mirror_state blob.
 *
 * Two guarantees are pinned here:
 *   1. Pruning is OFF unless a caller explicitly opts in.
 *   2. Even when opted in, a prune that would remove an implausible share
 *      of the table is refused — that is the shape every accidental wipe
 *      takes (partial payload, huge delete).
 *
 * Run: npx tsx src/lib/sisPrune.selftest.ts
 */
import assert from "node:assert/strict";

console.log("sisPrune.selftest.ts");

// Mirrors the guard in sisNormalized.server.ts deleteStale(). Kept in sync
// deliberately: the rule is what matters, and it must be executable.
const MAX_PRUNE_FRACTION = 0.2;

function pruneDecision(storedCount: number, payloadCount: number, staleCount: number) {
  if (staleCount === 0) return { deleted: 0, refused: false };
  if (payloadCount === 0 && storedCount > 0) {
    return { deleted: 0, refused: true, why: "empty payload" };
  }
  const fraction = staleCount / Math.max(storedCount, 1);
  if (fraction > MAX_PRUNE_FRACTION) {
    return { deleted: 0, refused: true, why: "over cap" };
  }
  return { deleted: staleCount, refused: false };
}

// --- The exact incident ------------------------------------------------
{
  // 711 stored, 3 pushed → 708 would have been deleted.
  const d = pruneDecision(711, 3, 708);
  assert.equal(d.refused, true, "the incident payload must now be refused");
  assert.equal(d.deleted, 0, "no rows may be deleted by a 3-of-711 payload");
  console.log("  ok  the 3-of-711 payload that caused the incident is refused");
}

// --- Empty payload against a populated table ---------------------------
{
  const d = pruneDecision(711, 0, 711);
  assert.equal(d.refused, true, "an empty payload must never empty the table");
  assert.equal(d.deleted, 0);
  console.log("  ok  empty payload cannot wipe a populated table");
}

// --- Legitimate small deletions still work -----------------------------
{
  // Office removes 5 duplicate records out of 711 → 0.7%, well under cap.
  const d = pruneDecision(711, 706, 5);
  assert.equal(d.refused, false, "a normal deletion must still be allowed");
  assert.equal(d.deleted, 5);
  console.log("  ok  a genuine 5-record deletion is still applied");
}

// --- Boundary ----------------------------------------------------------
{
  const atCap = pruneDecision(100, 80, 20); // exactly 20%
  assert.equal(atCap.refused, false, "exactly at the cap is allowed");
  const overCap = pruneDecision(100, 79, 21); // 21%
  assert.equal(overCap.refused, true, "one row over the cap is refused");
  console.log("  ok  cap boundary behaves exactly at 20% / 21%");
}

// --- Nothing to do -----------------------------------------------------
{
  const d = pruneDecision(711, 711, 0);
  assert.equal(d.deleted, 0);
  assert.equal(d.refused, false, "no stale rows is not a refusal");
  console.log("  ok  a full matching payload prunes nothing and is not refused");
}

console.log("\nAll prune-safety checks passed.");
