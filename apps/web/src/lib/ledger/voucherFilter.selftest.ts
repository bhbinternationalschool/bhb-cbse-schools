/**
 * Self-test: finding vouchers, and judging which are not classified.
 *
 * The cases that matter are the refusals. A reclassification that silently
 * moved a bank line, or landed on a parent head, would look like tidying and
 * would quietly misstate the book.
 */
import assert from "node:assert/strict";
import {
  childCodesByParent,
  headGapForLine,
  headGaps,
  matchesVoucherFilter,
  planHeadReclass,
  voucherAmountPaise,
  type ChartAccount,
  type VoucherFacts,
} from "./voucherFilter";

const chart: ChartAccount[] = [
  { code: "1000", name: "Cash in Hand", parentCode: "1", isCash: true },
  { code: "1012", name: "UBI -Main · Union Bank of India 5371", parentCode: "1010", isBank: true },
  { code: "1070", name: "Staff Advances", parentCode: "1", isControl: true },
  { code: "4000", name: "Fee Income", parentCode: "4" },
  { code: "4100", name: "Other Income", parentCode: "4" },
  { code: "5000", name: "Refreshment", parentCode: "5" },
  { code: "5000.01", name: "Milk Expenses", parentCode: "5000" },
  { code: "5031", name: "Vehicle Fuel", parentCode: "5" },
  { code: "5070", name: "Salary & Wages", parentCode: "5" },
  { code: "5900", name: "Other Expenses", parentCode: "5" },
];
const byParent = childCodesByParent(chart);

function voucher(over: Partial<VoucherFacts> = {}): VoucherFacts {
  return {
    id: "v1",
    voucherNo: "PY/FY2026-27/00203",
    voucherType: "payment",
    date: "2026-07-31",
    narration: "Daily Expense (old ERP receipt 531)",
    createdBy: "director",
    sourceType: "old_erp_import",
    reversed: false,
    isReversal: false,
    lines: [
      { accountCode: "5900", accountName: "Other Expenses", partyName: "", debitPaise: 50000, creditPaise: 0 },
      { accountCode: "1000", accountName: "Cash in Hand", partyName: "", debitPaise: 0, creditPaise: 50000 },
    ],
    ...over,
  };
}

/* ── which lines are unclassified ─────────────────────────── */

// A catch-all head by its own name.
const catchAll = headGapForLine({ accountCode: "5900" }, chart, byParent);
assert.equal(catchAll?.kind, "catch_all");
assert.equal(headGapForLine({ accountCode: "4100" }, chart, byParent)?.kind, "catch_all");

// A parent that has sub-heads: the detail the sub-head exists for is lost.
const parent = headGapForLine({ accountCode: "5000" }, chart, byParent);
assert.equal(parent?.kind, "parent_with_subheads");
assert.deepEqual(parent?.kind === "parent_with_subheads" ? parent.subHeads : [], ["5000.01"]);

// A real, specific head is fine — including the sub-head itself.
assert.equal(headGapForLine({ accountCode: "5031" }, chart, byParent), null);
assert.equal(headGapForLine({ accountCode: "5000.01" }, chart, byParent), null);
assert.equal(headGapForLine({ accountCode: "5070" }, chart, byParent), null);

// Cash, bank and control accounts are never a classification problem.
assert.equal(headGapForLine({ accountCode: "1000" }, chart, byParent), null);
assert.equal(headGapForLine({ accountCode: "1012" }, chart, byParent), null);
assert.equal(headGapForLine({ accountCode: "1070" }, chart, byParent), null);

// An account the chart does not know is not guessed at.
assert.equal(headGapForLine({ accountCode: "9999" }, chart, byParent), null);

// Only the expense line of a cash payment is flagged, not the cash side.
assert.equal(headGaps(voucher(), chart, byParent).length, 1);
assert.equal(headGaps(voucher(), chart, byParent)[0]!.index, 0);

/* ── filtering ────────────────────────────────────────────── */

const v = voucher();
assert.equal(matchesVoucherFilter(v, {}, chart), true);
assert.equal(matchesVoucherFilter(v, { q: "old erp receipt 531" }, chart), true);
assert.equal(matchesVoucherFilter(v, { q: "PY/FY2026-27" }, chart), true);
// The search reaches the lines, so a head name finds the voucher.
assert.equal(matchesVoucherFilter(v, { q: "other expenses" }, chart), true);
assert.equal(matchesVoucherFilter(v, { q: "milk" }, chart), false);

assert.equal(matchesVoucherFilter(v, { from: "2026-07-01", to: "2026-07-31" }, chart), true);
assert.equal(matchesVoucherFilter(v, { from: "2026-08-01" }, chart), false);
assert.equal(matchesVoucherFilter(v, { to: "2026-07-30" }, chart), false);

assert.equal(matchesVoucherFilter(v, { voucherType: "payment" }, chart), true);
assert.equal(matchesVoucherFilter(v, { voucherType: "journal" }, chart), false);
assert.equal(matchesVoucherFilter(v, { sourceType: "old_erp_import" }, chart), true);
assert.equal(matchesVoucherFilter(v, { sourceType: "manual" }, chart), false);
// A voucher with no source is findable as "manual", which is what the UI shows.
assert.equal(
  matchesVoucherFilter(voucher({ sourceType: "" }), { sourceType: "manual" }, chart),
  true,
);

assert.equal(matchesVoucherFilter(v, { accountCode: "5900" }, chart), true);
assert.equal(matchesVoucherFilter(v, { accountCode: "5031" }, chart), false);

assert.equal(voucherAmountPaise(v), 50000);
assert.equal(matchesVoucherFilter(v, { minPaise: 50000 }, chart), true);
assert.equal(matchesVoucherFilter(v, { minPaise: 50001 }, chart), false);
assert.equal(matchesVoucherFilter(v, { maxPaise: 49999 }, chart), false);

// Status.
assert.equal(matchesVoucherFilter(v, { status: "live" }, chart), true);
assert.equal(matchesVoucherFilter(v, { status: "reversed" }, chart), false);
assert.equal(matchesVoucherFilter(voucher({ reversed: true }), { status: "live" }, chart), false);
assert.equal(matchesVoucherFilter(voucher({ reversed: true }), { status: "reversed" }, chart), true);
assert.equal(matchesVoucherFilter(voucher({ isReversal: true }), { status: "reversal" }, chart), true);
assert.equal(matchesVoucherFilter(voucher({ isReversal: true }), { status: "live" }, chart), false);

// needsHead.
assert.equal(matchesVoucherFilter(v, { needsHead: true }, chart), true);
const classified = voucher({
  lines: [
    { accountCode: "5031", accountName: "Vehicle Fuel", partyName: "HP", debitPaise: 50000, creditPaise: 0 },
    { accountCode: "1000", accountName: "Cash in Hand", partyName: "", debitPaise: 0, creditPaise: 50000 },
  ],
});
assert.equal(matchesVoucherFilter(classified, { needsHead: true }, chart), false);

// needsParty looks only at income/expenditure — a cash line has no party by nature.
assert.equal(matchesVoucherFilter(v, { needsParty: true }, chart), true);
assert.equal(matchesVoucherFilter(classified, { needsParty: true }, chart), false);

/* ── the reclassification ─────────────────────────────────── */

const ok = planHeadReclass({ voucher: v, lineIndex: 0, toCode: "5031", chart, reason: "vehicle diesel" });
assert.equal(ok.ok, true);
// Same side as the original, so the trial balance does not move.
assert.deepEqual(
  ok.lines?.map((l) => [l.accountCode, l.debitPaise, l.creditPaise]),
  [
    ["5031", 50000, 0],
    ["5900", 0, 50000],
  ],
);
assert.match(ok.narration ?? "", /Reclassified from 5900 Other Expenses to 5031 Vehicle Fuel/);
assert.match(ok.narration ?? "", /vehicle diesel/);
assert.match(ok.narration ?? "", /PY\/FY2026-27\/00203/);

// A credit line moves as a credit.
const incomeV = voucher({
  lines: [
    { accountCode: "1000", accountName: "Cash in Hand", partyName: "", debitPaise: 20000, creditPaise: 0 },
    { accountCode: "4100", accountName: "Other Income", partyName: "", debitPaise: 0, creditPaise: 20000 },
  ],
});
const credit = planHeadReclass({ voucher: incomeV, lineIndex: 1, toCode: "4000", chart, reason: "late fee" });
assert.deepEqual(
  credit.lines?.map((l) => [l.accountCode, l.debitPaise, l.creditPaise]),
  [
    ["4000", 0, 20000],
    ["4100", 20000, 0],
  ],
);

// Refusals.
assert.equal(planHeadReclass({ voucher: v, lineIndex: 0, toCode: "5031", chart, reason: "  " }).ok, false);
assert.equal(planHeadReclass({ voucher: v, lineIndex: 9, toCode: "5031", chart, reason: "x" }).ok, false);
assert.equal(planHeadReclass({ voucher: v, lineIndex: 0, toCode: "9999", chart, reason: "x" }).ok, false);
// Already on that head.
assert.equal(planHeadReclass({ voucher: v, lineIndex: 0, toCode: "5900", chart, reason: "x" }).ok, false);
// Never onto cash or bank — that would move money, not a classification.
assert.equal(planHeadReclass({ voucher: v, lineIndex: 0, toCode: "1000", chart, reason: "x" }).ok, false);
assert.equal(planHeadReclass({ voucher: v, lineIndex: 0, toCode: "1012", chart, reason: "x" }).ok, false);
// Never onto a parent that has sub-heads — that is the gap, not the fix.
const toParent = planHeadReclass({ voucher: v, lineIndex: 0, toCode: "5000", chart, reason: "x" });
assert.equal(toParent.ok, false);
assert.match(toParent.error ?? "", /sub-heads/);
// A reversed voucher is history; correct its replacement instead.
assert.equal(
  planHeadReclass({ voucher: voucher({ reversed: true }), lineIndex: 0, toCode: "5031", chart, reason: "x" }).ok,
  false,
);
// A zero line has nothing to move.
assert.equal(
  planHeadReclass({
    voucher: voucher({ lines: [{ accountCode: "5900", accountName: "Other Expenses", partyName: "", debitPaise: 0, creditPaise: 0 }] }),
    lineIndex: 0,
    toCode: "5031",
    chart,
    reason: "x",
  }).ok,
  false,
);

console.log("voucherFilter self-test passed");
