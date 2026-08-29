/**
 * Self-test: changing a standing discount does not rewrite history.
 * Run: npx tsx apps/web/src/lib/standingDiscountChange.selftest.ts
 *
 * The office changes ₹150 off tuition to ₹200 in September. April–August were
 * billed and collected at ₹150. Those months must STAY at ₹150 — otherwise
 * every receipt already issued disagrees with the money that was taken.
 *
 * The engine reads grants per due (resolvedConcessionGrantsForStudent), so
 * this proves the two grants hand over cleanly at the boundary.
 */

import assert from "node:assert/strict";

import { resolvedConcessionGrantsForStudent } from "./feeDiscountRuntime";
import type { MastersState } from "./masters";

console.log("standingDiscountChange.selftest.ts");

const STUDENT = { id: "stu_1", admissionNo: "BHB-1" };

// What changeStandingDiscount leaves behind: the old grant ended the day
// before the new one starts.
const masters = {
  concessions: [
    { id: "cnc_150", code: "C150", name: "₹150 off", kind: "other",
      mode: "fixed", value: 15000, feeHeadIds: ["fh_t"], isActive: true,
      academicYearCode: "2026-27", siblingTiers: [], incompatibleCodes: [] },
    { id: "cnc_200", code: "C200", name: "₹200 off", kind: "other",
      mode: "fixed", value: 20000, feeHeadIds: ["fh_t"], isActive: true,
      academicYearCode: "2026-27", siblingTiers: [], incompatibleCodes: [] },
  ],
  concessionGrants: [
    { id: "cg_old", concessionId: "cnc_150", studentId: "stu_1",
      status: "approved", reason: "", effectiveFrom: "2026-04-01",
      effectiveTo: "2026-09-09", createdAt: "", siblingChildNo: null },
    { id: "cg_new", concessionId: "cnc_200", studentId: "stu_1",
      status: "approved", reason: "", effectiveFrom: "2026-09-10",
      effectiveTo: null, createdAt: "", siblingChildNo: null },
  ],
  feeHeads: [{ id: "fh_t", code: "TUITION", isActive: true }],
} as unknown as MastersState;

const at = (dueOn: string) =>
  resolvedConcessionGrantsForStudent(masters, STUDENT, dueOn);

/* ── Months already billed keep the old rate ── */
for (const dueOn of ["2026-04-10", "2026-05-10", "2026-08-10"]) {
  const g = at(dueOn);
  assert.equal(g.length, 1, `${dueOn} must resolve exactly one discount`);
  assert.equal(g[0]!.id, "cg_old", `${dueOn} keeps the rate it was billed at`);
}

/* ── The new rate starts on its month, not before ── */
const sep = at("2026-09-10");
assert.equal(sep.length, 1, "September resolves exactly one discount");
assert.equal(sep[0]!.id, "cg_new", "September takes the new rate");
assert.equal(at("2026-10-10")[0]!.id, "cg_new", "and every month after");

/* ── The handover leaves no gap and no overlap ── */
assert.equal(at("2026-09-09").length, 1, "the day before is still covered");
assert.equal(at("2026-09-09")[0]!.id, "cg_old", "and by the OLD grant");

/* ── Removing a discount leaves the head clear from that month ── */
const removed = {
  ...masters,
  concessionGrants: [masters.concessionGrants![0]],
} as unknown as MastersState;
assert.equal(
  resolvedConcessionGrantsForStudent(removed, STUDENT, "2026-09-10").length,
  0,
  "with no replacement, September carries no discount",
);
assert.equal(
  resolvedConcessionGrantsForStudent(removed, STUDENT, "2026-08-10").length,
  1,
  "but August, already billed, is untouched",
);

console.log("OK — standingDiscountChange.selftest.ts");
