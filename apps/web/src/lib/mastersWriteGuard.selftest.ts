/**
 * Regression test for the data-loss class that recurred three times on
 * 2026-08-09: a client POSTing masters with a freshly generated set of class
 * ids, orphaning 711 students and 889 leads in a single accepted write.
 *
 * Run: npx tsx src/lib/mastersWriteGuard.selftest.ts
 */
import assert from "node:assert/strict";
import { guardMastersOverwrite } from "./mastersWriteGuard";

// The real generations observed during the incident, in the order they
// appeared. Each replaced the previous one wholesale.
const GEN_A = ["cls_lm3g56a2", "cls_h8vxtd4j", "cls_xhpkfz14"];
const GEN_B = ["cls_9u3gv73p", "cls_oeq5e02h", "cls_rxdsv4bd"];
const GEN_C = ["cls_p7bw8cpc", "cls_2hwxqq84", "cls_oobr6iej"];

// ── The incident: a whole new generation must be refused ──────────────
for (const [from, to, label] of [
  [GEN_A, GEN_B, "A→B"],
  [GEN_B, GEN_C, "B→C"],
  [GEN_C, GEN_A, "C→A"],
] as const) {
  const v = guardMastersOverwrite(from, to);
  assert.equal(v.allow, false, `${label} must be refused`);
  assert.equal(v.allow === false && v.reason, "regenerated");
  assert.equal(v.allow === false && v.overlap, 0);
}

// ── An empty push deletes the slice — equally destructive ─────────────
const wipe = guardMastersOverwrite(GEN_B, []);
assert.equal(wipe.allow, false);
assert.equal(wipe.allow === false && wipe.reason, "wipe");

// ── Ordinary edits must still go through ──────────────────────────────

// Rename a class: ids unchanged.
assert.equal(guardMastersOverwrite(GEN_B, GEN_B).allow, true);

// Add a class: all existing ids retained, one new id.
assert.equal(
  guardMastersOverwrite(GEN_B, [...GEN_B, "cls_brandnew1"]).allow,
  true,
);

// Delete a class: a subset still overlaps.
assert.equal(guardMastersOverwrite(GEN_B, GEN_B.slice(0, 2)).allow, true);

// Down to a single surviving id — still a legitimate (if drastic) edit,
// and crucially distinguishable from a regeneration.
assert.equal(guardMastersOverwrite(GEN_B, [GEN_B[0]]).allow, true);

// ── Bootstrap: nothing stored yet, so nothing can be orphaned ─────────
assert.equal(guardMastersOverwrite([], GEN_B).allow, true);
assert.equal(guardMastersOverwrite([], []).allow, true);
assert.equal(
  guardMastersOverwrite([], []).allow === true &&
    guardMastersOverwrite([], []).reason,
  "bootstrap",
);

// ── Blank ids must not be mistaken for overlap ────────────────────────
// Two pushes that share only "" are still a regeneration.
const blanks = guardMastersOverwrite(["", ...GEN_B], ["", ...GEN_C]);
assert.equal(blanks.allow, false, "empty-string ids must not count as overlap");

console.log("mastersWriteGuard.selftest: all assertions passed");
