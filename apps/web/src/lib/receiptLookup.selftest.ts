/**
 * Self-test: finding a receipt by the number someone is holding.
 * Run: npx tsx apps/web/src/lib/receiptLookup.selftest.ts
 *
 * A parent quotes a UTR from their bank app; the office holds a paper stub.
 * Both must lead back to the receipt, and a serial range over the book must
 * order numerically — as text, "9" sorts after "10" and hides a page.
 */

import assert from "node:assert/strict";

import { leafNumber, paperRefOf } from "./fees";

console.log("receiptLookup.selftest.ts");

/* ── paperRefOf: either way a paper number was recorded ── */
assert.equal(
  paperRefOf({ manualBookSeries: "FEE-BOOK-A", manualBookLeaf: "4521" }),
  "FEE-BOOK-A/4521",
  "manual-book receipts read as SERIES/LEAF",
);
assert.equal(
  paperRefOf({ schoolReceiptNo: "1376" }),
  "1376",
  "counter receipts read as the free-text number",
);
// A manual-book ref wins over a stray schoolReceiptNo on the same voucher.
assert.equal(
  paperRefOf({
    manualBookSeries: "A",
    manualBookLeaf: "7",
    schoolReceiptNo: "ignored",
  }),
  "A/7",
);
assert.equal(paperRefOf({}), "", "no paper number is empty, not undefined");
assert.equal(
  paperRefOf({ schoolReceiptNo: "  1376  " }),
  "1376",
  "whitespace is trimmed so search matches",
);
// A half-entered book ref is not a paper number.
assert.equal(paperRefOf({ manualBookSeries: "A", manualBookLeaf: "" }), "");

/* ── leafNumber: serial ranges sort like a book, not like text ── */
assert.equal(leafNumber("1376"), 1376);
assert.equal(leafNumber("FEE-BOOK-A/4521"), 4521, "digits after the series");
assert.equal(leafNumber("A/7"), 7);
assert.equal(leafNumber(" 42 "), 42);
assert.equal(leafNumber("no-digits"), null);
assert.equal(leafNumber(""), null);

// The regression this exists for: 9 must fall inside 1..10.
const inRange = (ref: string, from: string, to: string) => {
  const n = leafNumber(ref);
  const a = leafNumber(from);
  const b = leafNumber(to);
  assert.ok(n != null && a != null && b != null);
  return n! >= a! && n! <= b!;
};
assert.equal(inRange("9", "1", "10"), true, "9 is inside 1–10");
assert.equal(inRange("10", "1", "10"), true, "range is inclusive");
assert.equal(inRange("11", "1", "10"), false);
assert.ok("9" > "10", "text comparison would have excluded 9 — hence leafNumber");

console.log("OK — receiptLookup.selftest.ts");
