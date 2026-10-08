/**
 * Run: npx tsx src/lib/udiseSchoolFinance.selftest.ts
 */
import assert from "node:assert/strict";
import { buildProfileFillPlan, type SchoolProfileStore } from "@/lib/udiseSchoolProfile";
import { confirmedYear, financeRules, financeTotal, normalizeFinanceStore, normalizeFinanceYear, previousYear } from "@/lib/udiseSchoolFinance";

assert.equal(previousYear("2026-27"), "2025-26");
const y = normalizeFinanceYear({
  maintenance: "1,20,000", teachers: "₹ 2400000", construction: "", others: "abc",
  assistance: { ngo: { received: true, name: "Seva Trust", amount: "50000" }, psu: { received: false, name: "X", amount: "9" } },
  source: "Audited accounts FY 2025-26", confirmedBy: "Office", confirmedAt: "2026-10-07T00:00:00Z",
});
assert.equal(y.maintenance, "120000");
assert.equal(y.teachers, "2400000");
assert.equal(y.others, "", "a bad figure is dropped, not guessed");
assert.equal(y.assistance.psu.name, "", "no name/amount when nothing was received");
assert.equal(financeTotal(y), "2520000");
assert.equal(confirmedYear(normalizeFinanceStore({ years: { "2025-26": { ...y, confirmedBy: "" } } }), "2025-26"), null, "unsigned = no figures");

// The fill plan puts them only into EMPTY plain boxes, by label.
const field = (label: string, value = "", type = "number") => ({ label, serial: "", type, value, text: "", locked: false });
const store = {
  "2026-27": {
    "1.59-1.62": {
      title: "1(c)", capturedAt: "2026-10-07", capturedBy: "x", formStatus: "", text: "",
      fields: {
        m: field("1.62.1 Maintenance/ Housekeeping › Expenditure (In Rs.)"),
        t: field("1.62.2 Teachers › Expenditure (In Rs.)"),
        c: field("1.62.3 Construction Works › Expenditure (In Rs.)", "5000"),
        tot: field("Total Expenditure Incurred"),
        ngoAmt: field("1.60.1 Non-Govt. Organization (NGO) › Amount (In Rs.)"),
        ngoName: field("1.60.1 Non-Govt. Organization (NGO) › Name", "", "text"),
        ngoYes: field("1.60.1 Non-Govt. Organization (NGO) › Is Assistance Received?", "", "radio"),
      },
    },
  },
} as unknown as SchoolProfileStore;
const plan = buildProfileFillPlan(store, "2026-27", "1.59-1.62", {}, financeRules(y, "2025-26"));
const v = (c: string) => plan.fields.find((f) => f.control === c)?.value;
assert.equal(v("m"), "120000");
assert.equal(v("t"), "2400000");
assert.equal(v("c"), undefined, "a box the portal already holds is kept");
assert.equal(v("tot"), "2520000");
assert.equal(v("ngoAmt"), "50000");
assert.equal(v("ngoName"), "Seva Trust");
assert.equal(v("ngoYes"), undefined, "yes/no radios are left for the person");
console.log("udiseSchoolFinance selftest: ok");
