import assert from "node:assert/strict";
import {
  additionalFromLink,
  computeStructureAmounts,
  defaultSalarySetupState,
  isEsicHeadCode,
  isPfHeadCode,
  seedSalaryHeads,
  seedSalaryStructures,
} from "./salarySetup";

console.log("salaryAdditional.selftest.ts");

const heads = seedSalaryHeads();
const structures = seedSalaryStructures(heads);
const state = { ...defaultSalarySetupState(), heads, structures, staffLinks: [] };
const st = structures.find((s) => s.code === "NTEACH_STD") ?? structures[0];
const cfg = { applyEpfWageCeiling: true, epfWageCeiling: 15000, esicWageCeiling: 21000, esicEmployeeExemptWageLimit: 5000 };
const sum = (rows: { head: { code: string }; amount: number }[], t: (c: string) => boolean) =>
  rows.filter((r) => t(r.head.code)).reduce((a, r) => a + r.amount, 0);

// Same structure, basic 12,000: once plain, once with ₹8,000 additional.
const plain = computeStructureAmounts(state, st, 12000, "both", cfg);
const extra = computeStructureAmounts(state, st, 12000, "both", cfg, { amount: 8000, label: "Additional allowance" });

assert.equal(plain.additionalAmount, 0);
assert.equal(extra.additionalAmount, 8000);
assert.equal(extra.statutoryGross, plain.gross, "statutory gross is the structure alone");
assert.equal(extra.gross, plain.gross + 8000, "paid gross includes the additional");
assert.equal(extra.earnings.some((e) => e.head.code === "ADDL" && e.amount === 8000), true, "shown as an earning line");
assert.equal(extra.earnings.find((e) => e.head.code === "ADDL")?.head.name, "Additional allowance");

// PF (employee + employer) identical — additional never enters PF wages.
assert.equal(sum(extra.deductions, isPfHeadCode), sum(plain.deductions, isPfHeadCode));
assert.equal(sum(extra.employer, isPfHeadCode), sum(plain.employer, isPfHeadCode));
// ESIC identical — eligibility and base judged on statutory gross, even when
// paid gross with the additional would cross the ₹21,000 ceiling.
assert.ok(plain.gross <= 21000 && extra.gross > 21000, `probe needs gross to straddle the ESIC ceiling (plain ${plain.gross}, extra ${extra.gross})`);
assert.ok(sum(plain.deductions, isEsicHeadCode) > 0, "ESIC applies on the plain structure");
assert.equal(sum(extra.deductions, isEsicHeadCode), sum(plain.deductions, isEsicHeadCode), "ESIC employee share unchanged");
assert.equal(sum(extra.employer, isEsicHeadCode), sum(plain.employer, isEsicHeadCode), "ESIC employer share unchanged");
assert.equal(extra.totalDeductions, plain.totalDeductions);

// Link helper: 0 / missing → null; label carried.
assert.equal(additionalFromLink(null), null);
assert.equal(additionalFromLink({ additionalAmount: 0, additionalLabel: "x" }), null);
assert.deepEqual(additionalFromLink({ additionalAmount: 500, additionalLabel: "Conveyance top-up" }), { amount: 500, label: "Conveyance top-up" });

// Negative / garbage additional → nothing.
const junk = computeStructureAmounts(state, st, 12000, "both", cfg, { amount: -300 });
assert.equal(junk.additionalAmount, 0);
assert.equal(junk.gross, plain.gross);

console.log("OK — salaryAdditional.selftest.ts");
