/**
 * Self-test: Middle VI–VIII 2026-27 totals (₹32,300 / ₹27,300).
 * Run: npx tsx apps/web/src/lib/feeStructureMiddle202627.selftest.ts
 */

import assert from "node:assert/strict";
import { defaultMasters } from "@/lib/masters";
import {
  ensureMiddleFeeStructure202627,
  middleFeeStructureTotals,
} from "@/lib/feeStructureMiddle202627";

const seeded = ensureMiddleFeeStructure202627(defaultMasters());
const totals = middleFeeStructureTotals(seeded);

assert.ok(totals);
assert.equal(totals!.newRupees, 32300);
assert.equal(totals!.promoteRupees, 27300);

console.log("feeStructureMiddle202627.selftest: ok");
