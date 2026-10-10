/**
 * Self-test: the projection must not post what the counter already booked.
 *
 * 2026-09-01, 00:55 IST. Someone ran the projection. It posted all 360 live
 * fee receipts a second time — as `fee_receipt`, while the counter had booked
 * them live as `fee_voucher` — and fee income read 34,53,952 against a desk
 * that had collected 17,60,226. Neither side's idempotency check could see
 * the other's work, because each looked only under its own label.
 */

import assert from "node:assert/strict";

import { findPriorPosting } from "./project.server";

console.log("projectionDoublePost.selftest.ts");

const book = new Map<string, { voucherId: string; reversed: boolean }>([
  // What the COUNTER posted, live, when the money was taken.
  ["fee_voucher:rcv_a", { voucherId: "v_a", reversed: false }],
  ["fee_voucher:rcv_b", { voucherId: "v_b", reversed: true }],
  // Something the projection itself posted earlier, under its own label.
  ["fee_receipt:rcv_c", { voucherId: "v_c", reversed: false }],
]);

/* The exact bug: booked by the counter, invisible under the projector's label. */
{
  assert.equal(
    findPriorPosting(book, "fee_receipt:rcv_a"),
    undefined,
    "looking only under its own label finds nothing — this is what doubled the income",
  );
  const found = findPriorPosting(book, "fee_receipt:rcv_a", ["fee_voucher:rcv_a"]);
  assert.ok(found, "with the counter's label offered too, the receipt is recognised");
  assert.equal(found!.voucherId, "v_a");
}

/* A reversed prior still counts as found — reversed is not "never posted". */
{
  const found = findPriorPosting(book, "fee_receipt:rcv_b", ["fee_voucher:rcv_b"]);
  assert.ok(found, "a reversed posting is still a posting");
  assert.equal(found!.reversed, true, "and the caller is told, so it can decide");
}

/* Its own label still wins, and is checked first. */
{
  const found = findPriorPosting(book, "fee_receipt:rcv_c", ["fee_voucher:rcv_c"]);
  assert.equal(found!.voucherId, "v_c");
}

/* A receipt nobody has booked is still posted — the projection must not stall. */
{
  assert.equal(
    findPriorPosting(book, "fee_receipt:rcv_new", ["fee_voucher:rcv_new"]),
    undefined,
    "an unbooked receipt is posted as normal",
  );
}

/* No alternates, and empty alternates, behave like the original. */
{
  assert.equal(findPriorPosting(book, "fee_voucher:rcv_a")!.voucherId, "v_a");
  assert.equal(findPriorPosting(book, "fee_receipt:rcv_a", [])?.voucherId, undefined);
}

console.log("  ok — a receipt booked under any label is not booked again");
