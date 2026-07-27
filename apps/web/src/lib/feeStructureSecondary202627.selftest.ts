/**
 * Self-test: Secondary IX–X 2026-27 totals (₹39,400 / ₹33,400).
 * Run: npx tsx apps/web/src/lib/feeStructureSecondary202627.selftest.ts
 */

import assert from "node:assert/strict";
import { defaultMasters } from "@/lib/masters";
import {
  ensureSecondaryFeeStructure202627,
  secondaryFeeStructureTotals,
} from "@/lib/feeStructureSecondary202627";

const seeded = ensureSecondaryFeeStructure202627(defaultMasters());
const totals = secondaryFeeStructureTotals(seeded);

assert.ok(totals);
assert.equal(totals!.newRupees, 39400);
assert.equal(totals!.promoteRupees, 33400);

console.log("feeStructureSecondary202627.selftest: ok");
