/**
 * The school pays several staff members' own PF/ESIC share so that what
 * reaches their hand is the agreed salary. Until 2026-09-20 that top-up was a
 * hand-typed "additional" amount, and the EPFO return for Aug 2026 showed what
 * hand-typing costs: of 13 PF members only 4 actually landed on their agreed
 * figure — four had no top-up at all, two carried a stale ₹1,050 from an older
 * basic, and two had real allowances mixed into the same field.
 *
 * So the gross-up is DERIVED from the deductions computed for that month. These
 * tests pin the two properties that make it safe: net lands exactly on the
 * agreed salary, and grossing up never widens a statutory base.
 */
import assert from "node:assert/strict";
import {
  computeStructureAmounts,
  defaultSalarySetupState,
  grossUpFromLink,
  isEsicHeadCode,
  isPfHeadCode,
  seedSalaryHeads,
  seedSalaryStructures,
} from "./salarySetup";

console.log("salaryGrossUp.selftest.ts");

const heads = seedSalaryHeads();
const structures = seedSalaryStructures(heads);
const state = { ...defaultSalarySetupState(), heads, structures, staffLinks: [] };
const st = structures.find((s) => s.code === "NTEACH_STD") ?? structures[0];
const cfg = {
  applyEpfWageCeiling: true,
  epfWageCeiling: 15000,
  esicWageCeiling: 21000,
  esicEmployeeExemptWageLimit: 5000,
};
const sum = (rows: { head: { code: string }; amount: number }[], t: (c: string) => boolean) =>
  rows.filter((r) => t(r.head.code)).reduce((a, r) => a + r.amount, 0);

// The school's own structures pay BASIC alone — no DA/HRA/TA, no professional
// tax — so "net equals the agreed salary" is literally true there. The seeded
// structure carries all of those, so build the school-shaped one to assert on
// and keep the fat structure for the does-not-widen-a-base tests.
const headById = new Map(heads.map((h) => [h.id, h]));
const codeOf = (headId: string) => headById.get(headId)?.code ?? "";
const basicOnly = {
  ...st,
  id: "basic_only",
  code: "BASIC_ONLY",
  lines: st.lines.filter((l) => {
    const c = codeOf(l.headId);
    return c === "BASIC" || isPfHeadCode(c) || isEsicHeadCode(c);
  }),
};

// --- net pay lands on the agreed salary, at several wages -----------------
// 3,000 sits under the ESIC employee-exemption limit; 12,000 is a plain
// PF+ESIC case; 20,000 is Rajesh Patel's, above the ₹15,000 PF ceiling.
for (const basic of [3000, 4000, 6000, 12000, 16200, 20000]) {
  const plain = computeStructureAmounts(state, basicOnly, basic, "both", cfg);
  const up = computeStructureAmounts(state, basicOnly, basic, "both", cfg, null, true);

  assert.equal(plain.statutoryGrossUpAmount, 0, `no gross-up unless asked (${basic})`);
  assert.equal(
    up.statutoryGrossUpAmount,
    up.employeeStatutoryCut,
    `gross-up equals the staff member's own cut (${basic})`,
  );
  assert.equal(
    up.gross - up.totalDeductions,
    basic,
    `net pay is exactly the agreed salary (${basic})`,
  );
  // Without it, the staff member is short by exactly the cut — the ₹6,708 a
  // month the Aug-2026 EPFO reconciliation found across six people.
  assert.equal(plain.gross - plain.totalDeductions, basic - up.employeeStatutoryCut);
  // No typed number can drift away from the deduction.
  assert.equal(
    up.employeeStatutoryCut,
    sum(plain.deductions, isPfHeadCode) + sum(plain.deductions, isEsicHeadCode),
    `cut is PF employee + ESIC employee only (${basic})`,
  );
  // Employer-side contributions are the school's cost either way and must
  // never be handed to the staff member as pay.
  assert.equal(sum(up.employer, isPfHeadCode), sum(plain.employer, isPfHeadCode));
  assert.equal(sum(up.employer, isEsicHeadCode), sum(plain.employer, isEsicHeadCode));
  assert.ok(
    sum(plain.employer, isPfHeadCode) > 0 || basic === 0,
    `employer PF exists but is not in the gross-up (${basic})`,
  );
}

// A structure that pays more than BASIC still cancels exactly the PF/ESIC cut
// and nothing else: professional tax is not the school's to bear.
const fat = computeStructureAmounts(state, st, 12000, "both", cfg);
const fatUp = computeStructureAmounts(state, st, 12000, "both", cfg, null, true);
const nonStatutory = fat.totalDeductions - fat.employeeStatutoryCut;
assert.ok(nonStatutory > 0, "probe needs a non-statutory deduction (professional tax)");
assert.equal(fatUp.gross - fatUp.totalDeductions, fatUp.statutoryGross - nonStatutory);

// --- grossing up never widens a statutory base ----------------------------
// Straddle the ESIC ceiling: statutory gross stays under it, paid gross goes
// over. If the gross-up leaked into the base, ESIC would switch off and net
// would stop matching the salary.
const near = computeStructureAmounts(state, basicOnly, 20800, "both", cfg);
const nearUp = computeStructureAmounts(state, basicOnly, 20800, "both", cfg, null, true);
assert.ok(near.statutoryGross <= 21000, "statutory gross is under the ESIC ceiling");
assert.ok(nearUp.gross > 21000, "paid gross crosses it");
assert.ok(sum(near.deductions, isEsicHeadCode) > 0, "ESIC applies before grossing up");
assert.equal(nearUp.statutoryGross, near.statutoryGross, "statutory gross is the structure alone");
assert.equal(sum(nearUp.deductions, isPfHeadCode), sum(near.deductions, isPfHeadCode), "PF wages unchanged");
assert.equal(sum(nearUp.deductions, isEsicHeadCode), sum(near.deductions, isEsicHeadCode), "ESIC base unchanged");
assert.equal(nearUp.totalDeductions, near.totalDeductions, "deductions unchanged");
assert.equal(nearUp.gross, near.gross + nearUp.statutoryGrossUpAmount);
assert.equal(nearUp.gross - nearUp.totalDeductions, 20800, "still lands on the salary");

// The ₹15,000 PF ceiling is respected: at 20,000 the cut is 12% of 15,000,
// which is what the EPFO return for Aug 2026 actually remits for Rajesh Patel.
const ceiling = computeStructureAmounts(state, basicOnly, 20000, "both", cfg, null, true);
assert.equal(sum(ceiling.deductions, isPfHeadCode), 1800, "PF employee share honours the ₹15,000 ceiling");

// --- the gross-up line is visible on the payslip --------------------------
const shown = computeStructureAmounts(state, basicOnly, 6000, "both", cfg, null, true);
const line = shown.earnings.find((e) => e.head.code === "SGUP");
assert.ok(line, "gross-up prints as its own earning line");
assert.equal(line?.amount, shown.statutoryGrossUpAmount);
assert.equal(line?.head.name, "PF/ESIC paid by school");

// --- it composes with a real additional allowance -------------------------
// Suraj Kumar's case: a genuine ₹2,000 allowance AND the school bearing his
// cut. The two are separate lines and both reach gross.
const both = computeStructureAmounts(state, basicOnly, 6000, "both", cfg, { amount: 2000, label: "Special allowance" }, true);
assert.equal(both.additionalAmount, 2000);
assert.equal(both.statutoryGrossUpAmount, shown.statutoryGrossUpAmount, "allowance does not change the cut");
assert.equal(both.gross, shown.gross + 2000);
assert.equal(both.gross - both.totalDeductions, 6000 + 2000, "net is salary plus the allowance");
assert.equal(both.earnings.filter((e) => e.head.code === "ADDL" || e.head.code === "SGUP").length, 2);

// --- staff outside PF/ESIC gross up by nothing ----------------------------
const none = computeStructureAmounts(state, basicOnly, 8000, "none", cfg, null, true);
assert.equal(none.employeeStatutoryCut, 0);
assert.equal(none.statutoryGrossUpAmount, 0, "nothing to bear when there is no cover");
assert.equal(none.earnings.some((e) => e.head.code === "SGUP"), false);

// --- link helper ----------------------------------------------------------
assert.equal(grossUpFromLink(null), false);
assert.equal(grossUpFromLink({ statutoryGrossUp: false }), false);
assert.equal(grossUpFromLink({ statutoryGrossUp: true }), true);
// A link saved before this field existed must not silently start grossing up.
assert.equal(grossUpFromLink({} as { statutoryGrossUp: boolean }), false);

console.log("OK — salaryGrossUp.selftest.ts");
