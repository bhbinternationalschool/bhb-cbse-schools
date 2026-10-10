import assert from "node:assert/strict";
import {
  buildClosingBalancePlan,
  isClosingDate,
  parseRupeesToPaise,
  rupees,
} from "./closingBalance";
import { L_BANK, L_BALANCE_DIFFERENCE, L_CASH } from "./coa";

console.log("closingBalance.selftest.ts");

const sum = (lines: { debitPaise: number; creditPaise: number }[], k: "debitPaise" | "creditPaise") =>
  lines.reduce((t, l) => t + l[k], 0);
const line = <T extends { accountCode: string }>(lines: T[], code: string) => lines.find((l) => l.accountCode === code);

/* ─── every plan balances ─────────────────────────────────── */
// The one property that must never break: a journal whose debits and credits
// disagree is not postable, and a closing that silently fails is worse than
// one that never ran.
for (const [bc, bb, ac, ab] of [
  [0, 0, 0, 0],
  [10_00_000, 50_00_000, 10_00_000, 50_00_000],
  [10_00_000, 50_00_000, 28_20_000, 50_00_000],
  [28_20_000, 50_00_000, 10_00_000, 50_00_000],
  [10_00_000, 50_00_000, 10_00_000, 41_00_000],
  [10_00_000, 50_00_000, 15_00_000, 45_00_000], // legs cancel exactly
  [0, 0, 1, 0], // a single paise
] as const) {
  const p = buildClosingBalancePlan({
    asOn: "2026-09-30",
    bookCashPaise: bc,
    bookBankPaise: bb,
    actualCashPaise: ac,
    actualBankPaise: ab,
  });
  assert.equal(
    sum(p.lines, "debitPaise"),
    sum(p.lines, "creditPaise"),
    `debits must equal credits (book ${bc}/${bb} actual ${ac}/${ab})`,
  );
}

/* ─── nothing to post when the book already agrees ────────── */
const agreed = buildClosingBalancePlan({
  asOn: "2026-09-30",
  bookCashPaise: 28_20_000,
  bookBankPaise: 1_50_00_000,
  actualCashPaise: 28_20_000,
  actualBankPaise: 1_50_00_000,
});
assert.equal(agreed.alreadyAgrees, true);
assert.equal(agreed.lines.length, 0, "an agreeing book posts nothing at all");
assert.equal(agreed.netDifferencePaise, 0);

/* ─── more cash than the book knew about ──────────────────── */
// The school counts ₹2,82,000 where the book says ₹1,00,000: the cash asset
// rises and the difference head takes the gain as a credit.
const over = buildClosingBalancePlan({
  asOn: "2026-09-30",
  bookCashPaise: 1_00_000_00,
  bookBankPaise: 0,
  actualCashPaise: 2_82_000_00,
  actualBankPaise: 0,
});
assert.equal(over.alreadyAgrees, false);
assert.equal(over.cash.differencePaise, 1_82_000_00);
assert.equal(line(over.lines, L_CASH)?.debitPaise, 1_82_000_00, "cash is debited when there is more of it");
assert.equal(line(over.lines, L_CASH)?.creditPaise, 0);
assert.equal(line(over.lines, L_BALANCE_DIFFERENCE)?.creditPaise, 1_82_000_00, "the gain is a credit");
assert.equal(line(over.lines, L_BALANCE_DIFFERENCE)?.debitPaise, 0);
assert.equal(line(over.lines, L_BANK), undefined, "a leg that agrees gets no line");

/* ─── less cash than the book claimed ─────────────────────── */
const short = buildClosingBalancePlan({
  asOn: "2026-09-30",
  bookCashPaise: 2_82_000_00,
  bookBankPaise: 0,
  actualCashPaise: 1_00_000_00,
  actualBankPaise: 0,
});
assert.equal(short.cash.differencePaise, -1_82_000_00);
assert.equal(line(short.lines, L_CASH)?.creditPaise, 1_82_000_00, "cash is credited when there is less of it");
assert.equal(line(short.lines, L_BALANCE_DIFFERENCE)?.debitPaise, 1_82_000_00, "the loss is a debit");

/* ─── both move, in opposite directions ───────────────────── */
// Cash up 5,000 and bank down 5,000 nets to nothing. The two asset lines must
// still be posted — the book's split between cash and bank was wrong even
// though its total was right — and they balance each other without a contra.
const swap = buildClosingBalancePlan({
  asOn: "2026-09-30",
  bookCashPaise: 10_000_00,
  bookBankPaise: 50_000_00,
  actualCashPaise: 15_000_00,
  actualBankPaise: 45_000_00,
});
assert.equal(swap.netDifferencePaise, 0);
assert.equal(swap.alreadyAgrees, false, "a zero net is not the same as agreeing");
assert.equal(swap.lines.length, 2, "both assets move, no difference line");
assert.equal(line(swap.lines, L_CASH)?.debitPaise, 5_000_00);
assert.equal(line(swap.lines, L_BANK)?.creditPaise, 5_000_00);
assert.equal(line(swap.lines, L_BALANCE_DIFFERENCE), undefined, "nothing unexplained when the legs cancel");

/* ─── both move the same way ──────────────────────────────── */
const both = buildClosingBalancePlan({
  asOn: "2026-09-30",
  bookCashPaise: 10_000_00,
  bookBankPaise: 50_000_00,
  actualCashPaise: 12_000_00,
  actualBankPaise: 53_000_00,
});
assert.equal(both.netDifferencePaise, 5_000_00);
assert.equal(both.lines.length, 3);
assert.equal(line(both.lines, L_BALANCE_DIFFERENCE)?.creditPaise, 5_000_00, "one contra for both legs");

/* ─── the difference never lands in corpus ────────────────── */
for (const p of [over, short, both]) {
  assert.equal(p.lines.some((l) => l.accountCode === "3000"), false, "a difference must never be hidden in corpus");
}

/* ─── paise are whole ─────────────────────────────────────── */
const rounded = buildClosingBalancePlan({
  asOn: "2026-09-30",
  bookCashPaise: 100.4,
  bookBankPaise: 0,
  actualCashPaise: 250.6,
  actualBankPaise: 0,
});
assert.equal(Number.isInteger(rounded.cash.bookPaise), true);
assert.equal(Number.isInteger(rounded.cash.actualPaise), true);
assert.equal(rounded.cash.differencePaise, 251 - 100);

/* ─── typed rupees ────────────────────────────────────────── */
assert.deepEqual(parseRupeesToPaise("282000"), { ok: true, paise: 2_82_000_00 });
assert.deepEqual(parseRupeesToPaise("2,82,000"), { ok: true, paise: 2_82_000_00 });
assert.deepEqual(parseRupeesToPaise(" ₹ 1000.50 "), { ok: true, paise: 1_000_50 });
assert.deepEqual(parseRupeesToPaise("0"), { ok: true, paise: 0 });
assert.equal(parseRupeesToPaise("").ok, false, "blank is not zero");
assert.equal(parseRupeesToPaise("abc").ok, false);
assert.equal(parseRupeesToPaise("-5").ok, false, "a counted balance cannot be negative");
assert.equal(parseRupeesToPaise("1.234").ok, false, "more precision than paise is a typo");

/* ─── dates ───────────────────────────────────────────────── */
assert.equal(isClosingDate("2026-09-30"), true);
assert.equal(isClosingDate("30-09-2026"), false);
assert.equal(isClosingDate(""), false);

/* ─── display ─────────────────────────────────────────────── */
assert.equal(rupees(2_82_000_00), "₹2,82,000.00");
assert.equal(rupees(-1_82_000_00), "-₹1,82,000.00");
assert.equal(rupees(0), "₹0.00");

console.log("OK — closingBalance.selftest.ts");
