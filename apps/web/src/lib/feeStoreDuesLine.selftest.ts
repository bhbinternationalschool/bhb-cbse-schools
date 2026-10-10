/**
 * Self-test: books / uniform are named beside the fee dues, never inside.
 * Run: npx tsx apps/web/src/lib/feeStoreDuesLine.selftest.ts
 *
 * Store slips are settled at the store counter against the fee receipt
 * (`collectOnSale`), and nothing else can settle one — not the /pay/due
 * link, not the parent app. So a dues message may TELL a family about its
 * ₹4,697 of books, but the total it asks for, and the link it offers, must
 * stay the fee total. A combined figure the link under-pays would send the
 * parent away believing they were clear.
 *
 * On 2026-09-16 twelve children owed the store ₹31,548 and no parent-facing
 * message had ever mentioned it.
 */

import assert from "node:assert/strict";

import { composeSisDuesReply } from "./sisParentBotEngine";

console.log("feeStoreDuesLine.selftest.ts");

const dueLines = [
  {
    studentName: "Aarav",
    label: "Tuition · September",
    amountLabel: "₹3,250",
    dueOn: "2026-09-10",
  },
];
const FEE_TOTAL = 325000;
const STORE = 469746;

/* ── English, with both kinds of due ────────────────────────────────── */

const en = composeSisDuesReply({
  guardianName: "Ramesh",
  dueLines,
  totalPaise: FEE_TOTAL,
  runningMonthOnly: true,
  storeDuesPaise: STORE,
  payUrl: "https://bhbinternational.school/pay/due/tok",
});

assert.ok(en.includes("Books / uniform"), "the store dues must be named");
assert.ok(en.includes("₹4,697"), "with their own amount");
assert.ok(
  en.includes("school counter"),
  "and where to pay them, since the link cannot take them",
);
assert.ok(
  en.includes("*Total to pay: ₹3,250*"),
  "the total asked for stays the FEE total — this is the assertion that matters",
);
assert.ok(
  !en.includes("₹7,947"),
  "fee and store must never be added into one figure",
);

/* ── Hindi says the same thing ──────────────────────────────────────── */

const hi = composeSisDuesReply({
  guardianName: "रमेश",
  dueLines,
  totalPaise: FEE_TOTAL,
  runningMonthOnly: true,
  hindi: true,
  storeDuesPaise: STORE,
  payUrl: "https://bhbinternational.school/pay/due/tok",
});

assert.ok(hi.includes("पुस्तक/यूनिफ़ॉर्म"), "Hindi names the store dues too");
assert.ok(hi.includes("₹4,697"), "with the amount");
assert.ok(
  hi.includes("*कुल जमा करना है: ₹3,250*"),
  "and the Hindi total is still the fee total",
);

/* ── No store dues: not a word about the store ──────────────────────── */

const plain = composeSisDuesReply({
  guardianName: "Ramesh",
  dueLines,
  totalPaise: FEE_TOTAL,
  runningMonthOnly: true,
  storeDuesPaise: 0,
});
assert.ok(
  !plain.toLowerCase().includes("uniform"),
  "a family that owes the store nothing hears nothing about it",
);

/* ── Fees clear, store not: the family still gets told ───────────────── */

const feesClear = composeSisDuesReply({
  guardianName: "Ramesh",
  dueLines: [],
  totalPaise: 0,
  storeDuesPaise: STORE,
});
assert.ok(
  feesClear.includes("No open dues"),
  "the fee book is clear and says so",
);
assert.ok(
  feesClear.includes("₹4,697"),
  "but the books are still owed, and 'no dues' alone would be a half-truth",
);

const feesClearHi = composeSisDuesReply({
  guardianName: "रमेश",
  dueLines: [],
  totalPaise: 0,
  hindi: true,
  storeDuesPaise: STORE,
});
assert.ok(
  feesClearHi.includes("पुस्तक/यूनिफ़ॉर्म"),
  "same in Hindi",
);

console.log("  ok — store dues are named, never added to the fee total");
