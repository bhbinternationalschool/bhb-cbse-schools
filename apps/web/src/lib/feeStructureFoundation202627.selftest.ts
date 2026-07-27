/**
 * Self-test: Foundation 2026-27 fee totals match school PDF (₹25,500 / ₹21,500).
 * Run: npx tsx apps/web/src/lib/feeStructureFoundation202627.selftest.ts
 */
import assert from "node:assert/strict";
import { defaultMasters } from "@/lib/masters";
import {
  ensureFoundationFeeStructure202627,
  foundationFeeStructureTotals,
} from "@/lib/feeStructureFoundation202627";

const seeded = ensureFoundationFeeStructure202627(defaultMasters());
const totals = foundationFeeStructureTotals(seeded);

assert.ok(totals, "Foundation fee groups should be seeded");
assert.equal(totals!.newRupees, 25500, "New admission Foundation total");
assert.equal(totals!.promoteRupees, 21500, "Promoted Foundation total");

const newGroup = seeded.feeGroups.find((g) => g.code === "NEW_FOUNDATION_2627");
assert.ok(newGroup, "New Foundation group exists");
assert.equal(newGroup!.academicYearCode, "2026-27");
assert.equal(newGroup!.classIds.length, 3, "Nursery, LKG, UKG");

console.log("feeStructureFoundation202627.selftest: ok");
