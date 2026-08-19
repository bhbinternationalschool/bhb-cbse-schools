import assert from "node:assert/strict";
import type { PayrollRun, PayrollStaffLine } from "./payroll";
import { buildSalaryRegister } from "./payrollRegister";

console.log("payrollRegister.selftest.ts");
const comp = (headCode: string, headName: string, kind: "earning" | "deduction" | "employer", amount: number) => ({ headId: headCode.toLowerCase(), headCode, headName, kind, amount });
const line = (p: Partial<PayrollStaffLine>): PayrollStaffLine =>
  ({ staffId: "", empCode: "", fullName: "", stream: "", structureId: "", structureName: "", daysPresent: 24, daysAbsent: 0, daysHalf: 0, daysLeavePaid: 1, daysLwp: 0, daysHoliday: 5, latePenalty: 0, lwpDeduction: 0, components: [], gross: 0, totalDeductions: 0, employerCost: 0, netPay: 0, juneHold: false, eligibleForJuneDraw: false, amountPayable: 0, holdNote: "", statutoryCover: "both", paymentDate: "", paymentMode: "bank_transfer", note: "", advanceTaken: 0, advanceDeduct: 0, pfGovtDeposit: 0, esicGovtDeposit: 0, ...p }) as PayrollStaffLine;

const run = {
  id: "r1", month: "2026-07", status: "draft",
  lines: [
    line({ staffId: "s1", empCode: "STF-015", fullName: "SURAJ KUMAR", components: [comp("BASIC", "Basic", "earning", 6000), comp("ADDL", "Additional allowance", "earning", 2765), comp("PF_EE", "PF (employee)", "deduction", 720), comp("ESIC_EE", "ESIC (employee)", "deduction", 45), comp("PF_ER", "PF (employer)", "employer", 720), comp("ESIC_ER", "ESIC (employer)", "employer", 195)], gross: 8765, totalDeductions: 765, netPay: 8000, amountPayable: 8000, employerCost: 9680, pfGovtDeposit: 1440, esicGovtDeposit: 240 }),
    line({ staffId: "s2", empCode: "STF-026", fullName: "DEVENDRA KUMAR PANDEY", components: [comp("BASIC", "Basic", "earning", 13000)], gross: 13000, totalDeductions: 0, netPay: 13000, amountPayable: 13000, employerCost: 13000 }),
  ],
} as unknown as PayrollRun;

const reg = buildSalaryRegister(run);
assert.equal(reg.rows.length, 2, "ONE row per staff");
assert.deepEqual(reg.earningHeads.map((h) => h.code), ["BASIC", "ADDL"], "Basic first, then the other earning heads seen in the run");
assert.deepEqual(reg.deductionHeads.map((h) => h.code), ["PF_EE", "ESIC_EE"]);
const suraj = reg.rows.find((r) => r.empCode === "STF-015")!;
assert.equal(suraj["earning:BASIC"], 6000);
assert.equal(suraj["earning:ADDL"], 2765);
assert.equal(suraj["deduction:PF_EE"], 720);
assert.equal(suraj.gross, 8765);
assert.equal(suraj.net, 8000);
assert.equal(suraj.govtPf, 1440);
assert.equal(suraj.days, "30");
const dev = reg.rows.find((r) => r.empCode === "STF-026")!;
assert.equal(dev["earning:ADDL"], 0, "absent head shows 0, not blank");
assert.equal(dev["deduction:PF_EE"], 0);
assert.equal(reg.totals.name, "TOTAL");
assert.equal(reg.totals.gross, 21765);
assert.equal(reg.totals.net, 21000);
assert.equal(reg.totals["employer:PF_ER"], 720);
assert.ok(reg.columns.some((c) => c.key === "payable") && reg.columns.some((c) => c.key === "govtEsic"));
console.log("OK — payrollRegister.selftest.ts");
