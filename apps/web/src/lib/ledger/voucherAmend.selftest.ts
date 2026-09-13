/**
 * Self-test: amending and voiding a posted voucher.
 *
 * Weighted toward refusal, because a replacement is validated BEFORE the
 * original is voided. A check that lets a bad replacement through does not
 * produce a bad voucher — it produces a voided voucher with nothing in its
 * place, which is worse than the mistake being corrected.
 */
import assert from "node:assert/strict";
import { linesFromVoucher, planAmend, planVoid, type AmendLine } from "./voucherAmend";
import type { VoucherFacts } from "./voucherFilter";

const postable = new Set(["1000", "1012", "5000.01", "5031", "5070", "5900", "4000"]);

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

const good: AmendLine[] = [
  { accountCode: "5031", debitPaise: 50000, creditPaise: 0, party: { kind: "vendor", externalId: "hp-1", name: "Hindustan Petroleum" } },
  { accountCode: "1000", debitPaise: 0, creditPaise: 50000 },
];
const base = {
  voucher: voucher(),
  lines: good,
  date: "2026-09-13",
  narration: "Diesel for Magic-2",
  reason: "was booked to Other Expenses",
  postableCodes: postable,
};

/* ── the happy path ───────────────────────────────────────── */

const ok = planAmend(base);
assert.equal(ok.ok, true);
if (ok.ok) {
  assert.equal(ok.totalPaise, 50000);
  assert.match(ok.narration, /Diesel for Magic-2/);
  assert.match(ok.narration, /corrects PY\/FY2026-27\/00203/);
  assert.match(ok.narration, /was booked to Other Expenses/);
  assert.match(ok.voidReason, /Replaced — was booked to Other Expenses/);
}

// An empty narration falls back to the original's, rather than posting blank.
const inherited = planAmend({ ...base, narration: "   " });
assert.equal(inherited.ok, true);
if (inherited.ok) assert.match(inherited.narration, /Daily Expense \(old ERP receipt 531\)/);

/* ── refusals: the state of the original ──────────────────── */

assert.equal(planAmend({ ...base, reason: "   " }).ok, false);
const onReversal = planAmend({ ...base, voucher: voucher({ isReversal: true }) });
assert.equal(onReversal.ok, false);
if (!onReversal.ok) assert.match(onReversal.error, /reversal/i);
const onVoided = planAmend({ ...base, voucher: voucher({ reversed: true }) });
assert.equal(onVoided.ok, false);
if (!onVoided.ok) assert.match(onVoided.error, /already been voided/i);

/* ── refusals: the replacement itself ─────────────────────── */

// Must balance — the case that would leave the book out of balance.
const unbalanced = planAmend({
  ...base,
  lines: [
    { accountCode: "5031", debitPaise: 50000, creditPaise: 0 },
    { accountCode: "1000", debitPaise: 0, creditPaise: 40000 },
  ],
});
assert.equal(unbalanced.ok, false);
if (!unbalanced.ok) assert.match(unbalanced.error, /differ by ₹100/);

// A head that does not exist, or is a group heading.
const badCode = planAmend({
  ...base,
  lines: [
    { accountCode: "5", debitPaise: 50000, creditPaise: 0 },
    { accountCode: "1000", debitPaise: 0, creditPaise: 50000 },
  ],
});
assert.equal(badCode.ok, false);
if (!badCode.ok) assert.match(badCode.error, /not a head you can post to/);

// One line is not a voucher.
assert.equal(planAmend({ ...base, lines: [good[0]!] }).ok, false);

// A line cannot be both sides, nor neither.
assert.equal(
  planAmend({
    ...base,
    lines: [
      { accountCode: "5031", debitPaise: 100, creditPaise: 100 },
      { accountCode: "1000", debitPaise: 0, creditPaise: 100 },
    ],
  }).ok,
  false,
);
assert.equal(
  planAmend({
    ...base,
    lines: [
      { accountCode: "5031", debitPaise: 0, creditPaise: 0 },
      { accountCode: "1000", debitPaise: 0, creditPaise: 0 },
    ],
  }).ok,
  false,
);

// Negative amounts belong on the other side, not behind a minus sign.
assert.equal(
  planAmend({
    ...base,
    lines: [
      { accountCode: "5031", debitPaise: -50000, creditPaise: 0 },
      { accountCode: "1000", debitPaise: 0, creditPaise: -50000 },
    ],
  }).ok,
  false,
);

// Paise are whole: a rupee input that produced 50000.5 must not be posted.
assert.equal(
  planAmend({
    ...base,
    lines: [
      { accountCode: "5031", debitPaise: 50000.5, creditPaise: 0 },
      { accountCode: "1000", debitPaise: 0, creditPaise: 50000.5 },
    ],
  }).ok,
  false,
);

// A half-filled party would tag the sub-ledger with an id naming nobody.
const halfParty = planAmend({
  ...base,
  lines: [
    { accountCode: "5031", debitPaise: 50000, creditPaise: 0, party: { kind: "vendor", externalId: "", name: "typed by hand" } },
    { accountCode: "1000", debitPaise: 0, creditPaise: 50000 },
  ],
});
assert.equal(halfParty.ok, false);
if (!halfParty.ok) assert.match(halfParty.error, /pick one from the list/);

// A missing or malformed date.
assert.equal(planAmend({ ...base, date: "" }).ok, false);
assert.equal(planAmend({ ...base, date: "13-09-2026" }).ok, false);

/* ── voiding ──────────────────────────────────────────────── */

const v = planVoid({ voucher: voucher(), reason: "duplicate of receipt 530" });
assert.equal(v.ok, true);
if (v.ok) assert.equal(v.reason, "duplicate of receipt 530");

assert.equal(planVoid({ voucher: voucher(), reason: "" }).ok, false);
// A reason nobody can use next year is not a reason.
assert.equal(planVoid({ voucher: voucher(), reason: "x" }).ok, false);
assert.equal(planVoid({ voucher: voucher(), reason: "   " }).ok, false);
assert.equal(planVoid({ voucher: voucher({ isReversal: true }), reason: "wrong" }).ok, false);
assert.equal(planVoid({ voucher: voucher({ reversed: true }), reason: "wrong" }).ok, false);

/* ── the starting point for an edit ───────────────────────── */

const seeded = linesFromVoucher(voucher());
assert.equal(seeded.length, 2);
assert.deepEqual(
  seeded.map((l) => [l.accountCode, l.debitPaise, l.creditPaise]),
  [
    ["5900", 50000, 0],
    ["1000", 0, 50000],
  ],
);
// Seeded lines are a valid replacement as they stand: opening the dialog and
// pressing save re-posts the same voucher rather than refusing.
assert.equal(planAmend({ ...base, lines: seeded }).ok, true);

console.log("voucherAmend self-test passed");
