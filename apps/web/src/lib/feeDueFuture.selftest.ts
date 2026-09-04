/**
 * Self-test: current vs future dues for the parent app.
 * Run: npx tsx apps/web/src/lib/feeDueFuture.selftest.ts
 */
import assert from "node:assert/strict";
import { flagFutureDues, mergeCurrentAndFuture } from "@/lib/feeDueFuture";

// Session runs April→March: in September, October is ahead, March next year is ahead, June is not.
const asOf = "2026-09-04";
const flagged = flagFutureDues(
  [
    { dueKey: "jun", dueOn: "2026-06-10" },
    { dueKey: "sep", dueOn: "2026-09-10" },
    { dueKey: "oct", dueOn: "2026-10-10" },
    { dueKey: "mar", dueOn: "2027-03-10" },
    { dueKey: "nodate", dueOn: null },
  ],
  asOf,
);
assert.deepEqual(flagged.map((d) => [d.dueKey, d.future]), [
  ["jun", false], ["sep", false], ["oct", true], ["mar", true], ["nodate", false],
]);

// The merge: current list wins, the rest of the full list appears only if future.
const merged = mergeCurrentAndFuture(
  [{ dueKey: "sep", dueOn: "2026-09-10" }],
  [
    { dueKey: "sep", dueOn: "2026-09-10" },
    { dueKey: "jun", dueOn: "2026-06-10" }, // past but absent from current: not a "future" due, so dropped
    { dueKey: "oct", dueOn: "2026-10-10" },
  ],
  asOf,
);
assert.deepEqual(merged.map((d) => [d.dueKey, d.future]), [["sep", false], ["oct", true]]);

console.log("feeDueFuture.selftest: ok");
