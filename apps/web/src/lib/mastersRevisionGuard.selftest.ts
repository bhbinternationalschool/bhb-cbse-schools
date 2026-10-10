/**
 * Regression test for the lost-update half of the 2026-08-09 incident
 * class: two devices holding the same masters generation, where the
 * second push silently overwrote the first. A push must carry the desk
 * revision it hydrated at; a mismatched revision is refused as stale.
 *
 * Run: npx tsx src/lib/mastersRevisionGuard.selftest.ts
 */
import assert from "node:assert/strict";
import { guardMastersRevision } from "./mastersRevisionGuard";

// ── Bootstrap: nothing stored → nothing to protect, any base allowed ──
assert.deepEqual(guardMastersRevision(null, null), {
  allow: true,
  reason: "bootstrap",
});
assert.equal(guardMastersRevision("2026-08-10T05:00:00Z", "").reason, "bootstrap");
assert.equal(guardMastersRevision(null, "  ").reason, "bootstrap");

// ── Unversioned: legacy clients without a base must keep saving ───────
const stored = "2026-08-10T05:00:00.123Z";
assert.equal(guardMastersRevision(null, stored).reason, "unversioned");
assert.equal(guardMastersRevision("", stored).reason, "unversioned");
assert.equal(guardMastersRevision(undefined, stored).reason, "unversioned");

// ── Match: same instant, regardless of spelling ───────────────────────
// Identical string.
assert.equal(guardMastersRevision(stored, stored).reason, "match");
// JSON "Z" vs timestamptz "+00:00" round-trip of the same moment.
assert.equal(
  guardMastersRevision("2026-08-10T05:00:00.123Z", "2026-08-10T05:00:00.123+00:00")
    .reason,
  "match",
);
// Same instant expressed in a different zone offset.
assert.equal(
  guardMastersRevision("2026-08-10T10:30:00.123+05:30", "2026-08-10T05:00:00.123Z")
    .reason,
  "match",
);

// ── Stale: any real mismatch is refused, in both directions ───────────
const older = guardMastersRevision("2026-08-10T04:59:00Z", stored);
assert.equal(older.allow, false);
assert.equal(older.allow === false && older.reason, "stale");
assert.equal(older.allow === false && older.storedUpdatedAt, stored);

// A base NEWER than stored is equally anomalous — still refused.
const newer = guardMastersRevision("2026-08-10T05:01:00Z", stored);
assert.equal(newer.allow, false);

// One millisecond apart is a mismatch — the incident writes were seconds
// apart, but the contract is exact.
assert.equal(
  guardMastersRevision("2026-08-10T05:00:00.124Z", stored).allow,
  false,
);

// ── Unparseable input degrades to unversioned, never a lockout ────────
assert.equal(guardMastersRevision("not-a-date", stored).reason, "unversioned");
assert.equal(
  guardMastersRevision("2026-08-10T05:00:00Z", "garbage").reason,
  "unversioned",
);

console.log("mastersRevisionGuard.selftest: all assertions passed");
