/**
 * Optimistic-locking plumbing test.
 *
 * The guard itself lives in SQL (sis_push_guarded), but it is only as good
 * as the version token reaching it. If `revisionAt` were ever dropped by a
 * normalizer, every record would push as "unversioned", the guard would
 * wave everything through, and concurrent edits would silently start
 * overwriting each other again — with no error anywhere. That regression
 * would be invisible in production, so it is pinned here.
 *
 * Run: npx tsx src/lib/sisRevision.selftest.ts
 */
import assert from "node:assert/strict";
import { normalizeHousehold, normalizeStudent } from "./sis";

console.log("sisRevision.selftest.ts");

const REV = "2026-08-08T10:15:30.123Z";

// --- Student round trip ----------------------------------------------
{
  const s = normalizeStudent({ id: "stu_1", fullName: "Aadvik Singh", revisionAt: REV });
  assert.equal(s.revisionAt, REV, "normalizeStudent must preserve revisionAt");

  // Re-normalizing (which happens on every load/merge) must not lose it.
  const again = normalizeStudent(s);
  assert.equal(again.revisionAt, REV, "re-normalizing must preserve revisionAt");

  // A spread-and-edit, the shape feature code uses when saving.
  const edited = normalizeStudent({ ...s, fullName: "Aadvik Singh Jr" });
  assert.equal(
    edited.revisionAt,
    REV,
    "editing a field must keep the base version the record was read at",
  );
  console.log("  ok  student revisionAt survives normalize, re-normalize, edit");
}

// --- Household round trip --------------------------------------------
{
  const h = normalizeHousehold({ id: "hh_1", guardianName: "Shivjatan", revisionAt: REV });
  assert.equal(h.revisionAt, REV, "normalizeHousehold must preserve revisionAt");
  assert.equal(
    normalizeHousehold({ ...h, city: "Varanasi" }).revisionAt,
    REV,
    "editing a household field must keep its base version",
  );
  console.log("  ok  household revisionAt survives normalize and edit");
}

// --- New records carry no version ------------------------------------
{
  const fresh = normalizeStudent({ id: "stu_new" });
  assert.equal(
    fresh.revisionAt,
    "",
    "a locally created student has no server version yet",
  );
  const freshHh = normalizeHousehold({ id: "hh_new" });
  assert.equal(freshHh.revisionAt, "", "a locally created household has no version yet");
  console.log("  ok  locally created records report no base version");
}

// --- Junk values are coerced, never leaked ----------------------------
{
  const s = normalizeStudent({
    id: "stu_2",
    // Feature code should never set this, but a bad merge or stale
    // localStorage payload must not produce a non-string token.
    revisionAt: 12345 as unknown as string,
  });
  assert.equal(s.revisionAt, "", "a non-string revisionAt must fall back to empty");
  console.log("  ok  malformed revisionAt coerced to empty (treated as unversioned)");
}

console.log("\nAll optimistic-locking plumbing checks passed.");
