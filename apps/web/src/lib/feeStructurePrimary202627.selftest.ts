/**
 * Self-test: Primary I–V 2026-27 fee totals match school PDF (₹27,800 / ₹23,800).
 * Run: npx tsx apps/web/src/lib/feeStructurePrimary202627.selftest.ts
 */

import assert from "node:assert/strict";
import { defaultMasters } from "@/lib/masters";
import {
  ensurePrimaryFeeStructure202627,
  primaryFeeStructureTotals,
} from "@/lib/feeStructurePrimary202627";

const seeded = ensurePrimaryFeeStructure202627(defaultMasters());
const totals = primaryFeeStructureTotals(seeded);

assert.ok(totals, "Primary 2026-27 groups should be seeded");
assert.equal(totals!.newRupees, 27800);
assert.equal(totals!.promoteRupees, 23800);

const newGroup = seeded.feeGroups.find((g) => g.code === "NEW_PRIMARY_2627");
assert.ok(newGroup);
assert.equal(newGroup!.academicYearCode, "2026-27");
assert.ok(newGroup!.classIds.length >= 5);

console.log("feeStructurePrimary202627.selftest: ok");
