import assert from "node:assert/strict";
import {
  judgeDeskShrink,
  SHRINK_MAX_SHARE_LOST,
  SHRINK_MIN_ROWS_LOST,
} from "./deskSliceShrinkGuard";

console.log("deskSliceShrinkGuard.selftest.ts");

// The incident: 2,178 rows on the desk, a browser that had never loaded it
// pushes the one paper it just created.
{
  const v = judgeDeskShrink(2178, 1);
  assert.equal(v.ok, false);
  assert.match(v.reason!, /leave 1 of 2178 rows/);
  assert.match(v.reason!, /deleting 2177 \(100%\)/);
  assert.match(v.reason!, /reload the page/);
  assert.match(v.reason!, /allowShrink/);
}

// Ordinary work is untouched: adding, editing, deleting a few.
assert.equal(judgeDeskShrink(2178, 2179).ok, true, "growing is always fine");
assert.equal(judgeDeskShrink(2178, 2178).ok, true, "unchanged is fine");
assert.equal(judgeDeskShrink(2178, 2170).ok, true, "deleting eight rows is ordinary");
assert.equal(judgeDeskShrink(100, 81).ok, true, "19 rows lost is below the floor");

// The floor matters most for small desks, where losing half is two rows.
assert.equal(judgeDeskShrink(4, 1).ok, true, "a four-row desk can be cleared");
assert.equal(
  judgeDeskShrink(SHRINK_MIN_ROWS_LOST + 1, 1).ok,
  false,
  "once the floor is passed, the share decides",
);

// The share matters most for large desks: losing 100 of 2,000 is normal work.
assert.equal(judgeDeskShrink(2000, 1900).ok, true);
assert.equal(judgeDeskShrink(2000, 1001).ok, true, "exactly half is allowed");
assert.equal(judgeDeskShrink(2000, 999).ok, false, "just past half is not");

// A first write has nothing to compare against — unknown is not a collapse.
assert.equal(judgeDeskShrink(0, 1).ok, true);
assert.equal(judgeDeskShrink(-1, 1).ok, true);
assert.equal(judgeDeskShrink(Number.NaN, 1).ok, true);

// Meaning it is always possible, and is the only way past.
assert.equal(judgeDeskShrink(2178, 1, true).ok, true);

// The thresholds are the contract, not an accident of the implementation.
assert.equal(SHRINK_MIN_ROWS_LOST, 20);
assert.equal(SHRINK_MAX_SHARE_LOST, 0.5);

console.log("OK — deskSliceShrinkGuard.selftest.ts");
