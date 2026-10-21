/**
 * Self-test: the staff phone's fee counter — total paying now, the reference
 * rule, and the per-head discount.
 * Run: npm run test:staff-fee-collect
 *
 * Requests mr_mv9zqkve5jy8 (a part payment against the whole bill, split
 * across heads; a discount per head) and mr_mv9ztcw6hkgt (a reference for
 * every payment that is not cash).
 */

import assert from "node:assert/strict";

import { TENDER_MODES, type FeeDueLine } from "./fees";
import {
  allocationRanks,
  checkPayingNowSplit,
  dueDiscountOut,
  dueRefKey,
  tenderReferenceProblem,
} from "./staffFeeCollect";

console.log("staffFeeCollect.selftest.ts");


function due(
  studentId: string,
  dueKey: string,
  dueOn: string,
  balancePaise: number,
  extra: Partial<FeeDueLine> = {},
): FeeDueLine {
  return {
    dueKey,
    kind: "academic",
    studentId,
    feeHeadId: "fh",
    feeHeadName: "Tuition",
    installmentId: null,
    installmentLabel: "",
    specialFeeId: null,
    structureLineId: null,
    storeIssueId: null,
    storeIssueNo: "",
    storeItems: [],
    transport: null,
    dueOn,
    billedPaise: balancePaise,
    concessionPaise: 0,
    concessionDetails: [],
    paidPaise: 0,
    balancePaise,
    label: dueKey,
    ...extra,
  };
}

// Household order deliberately NOT date order: the younger sibling's April
// tuition is listed after the elder's May transport.
const may = due("stu_a", "acad:stu_a:may", "2026-05-10", 150000);
const aprTransport = due("stu_a", "trn:stu_a:apr", "2026-04-10", 80000);
const aprSibling = due("stu_b", "acad:stu_b:apr", "2026-04-10", 120000);
const household = [may, aprTransport, aprSibling];
const total = 150000 + 80000 + 120000;

const posted = (pairs: [FeeDueLine, number][]) =>
  new Map(pairs.map(([d, p]) => [dueRefKey(d.studentId, d.dueKey), p]));

// ---- allocation order is the web counter's (oldest due date, then key) ----
{
  const ranks = allocationRanks(household);
  assert.equal(ranks.get(dueRefKey("stu_b", "acad:stu_b:apr")), 0, "April sibling tuition first (key acad < trn)");
  assert.equal(ranks.get(dueRefKey("stu_a", "trn:stu_a:apr")), 1, "April transport second");
  assert.equal(ranks.get(dueRefKey("stu_a", "acad:stu_a:may")), 2, "May last");
}

// ---- part payment across heads ----
{
  const r = checkPayingNowSplit({
    selected: household,
    payingNowPaise: 150000,
    posted: posted([
      [aprSibling, 120000],
      [aprTransport, 30000],
      [may, 0],
    ]),
  });
  assert.ok(r.ok, "₹1,500 against a ₹3,500 bill is accepted");
  assert.equal(r.amounts.get(dueRefKey("stu_b", "acad:stu_b:apr")), 120000);
  assert.equal(r.amounts.get(dueRefKey("stu_a", "trn:stu_a:apr")), 30000);
  assert.equal(r.amounts.get(dueRefKey("stu_a", "acad:stu_a:may")) ?? 0, 0);
}

// ---- the phone's split is checked, not trusted ----
{
  const r = checkPayingNowSplit({
    selected: household,
    payingNowPaise: 150000,
    // Same total, but the phone put it all on May.
    posted: posted([
      [aprSibling, 0],
      [aprTransport, 0],
      [may, 150000],
    ]),
  });
  assert.equal(r.ok, false, "a split that differs from the server's is refused");
  assert.equal(!r.ok && r.status, 409);
}

// ---- exact payment ----
{
  const r = checkPayingNowSplit({
    selected: household,
    payingNowPaise: total,
    posted: posted([
      [aprSibling, 120000],
      [aprTransport, 80000],
      [may, 150000],
    ]),
  });
  assert.ok(r.ok, "the whole bill exactly is accepted");
  assert.equal([...r.amounts.values()].reduce((a, b) => a + b, 0), total);
}

// ---- over-payment refused ----
{
  const r = checkPayingNowSplit({
    selected: household,
    payingNowPaise: total + 100,
    posted: posted([
      [aprSibling, 120000],
      [aprTransport, 80000],
      [may, 150100],
    ]),
  });
  assert.equal(r.ok, false, "more than the bill is refused");
  assert.match(!r.ok ? r.error : "", /exceeds/i);
  const zero = checkPayingNowSplit({ selected: household, payingNowPaise: 0, posted: new Map() });
  assert.equal(zero.ok, false, "nothing paid is refused");
}

// ---- reference rule ----
{
  assert.equal(tenderReferenceProblem("cash", ""), null, "cash needs no reference");
  assert.equal(tenderReferenceProblem("cash", undefined), null);
  const nonCash = TENDER_MODES.filter((m) => m.value !== "cash");
  assert.ok(nonCash.length >= 7, "every non-cash mode is covered");
  for (const m of nonCash) {
    assert.ok(tenderReferenceProblem(m.value, ""), `${m.value} without a reference is refused`);
    assert.ok(tenderReferenceProblem(m.value, "   "), `${m.value} with a blank reference is refused`);
    assert.equal(tenderReferenceProblem(m.value, "REF123"), null, `${m.value} with a reference is accepted`);
  }
  assert.ok(tenderReferenceProblem("wallet", ""), "an unknown future mode is not cash, so it needs one too");
}

// ---- discount per head ----
{
  const withDisc = due("stu_a", "acad:stu_a:jun", "2026-06-10", 90000, {
    billedPaise: 120000,
    concessionPaise: 30000,
    concessionDetails: [
      {
        grantId: "g1",
        concessionId: "c1",
        code: "SIB",
        name: "Sibling discount",
        kind: "percent",
        rateLabel: "25%",
        siblingLabel: "2nd child",
        amountPaise: 30000,
      },
    ],
  });
  const known = dueDiscountOut(withDisc, true);
  assert.equal(known.discountPaise, 30000);
  assert.equal(known.billedPaise, 120000);
  assert.equal(known.discountLines.length, 1);
  assert.match(known.discountLines[0], /Sibling discount/);

  const none = dueDiscountOut(due("stu_a", "x", "2026-06-10", 1000), true);
  assert.equal(none.discountPaise, 0, "a loaded head with no discount is a real zero");

  const unknown = dueDiscountOut(withDisc, false);
  assert.equal(unknown.discountPaise, null, "an unread discount is null, never 0");
  assert.equal(unknown.discountLabel, "not loaded");
}

console.log("staffFeeCollect.selftest.ts — all passed");
