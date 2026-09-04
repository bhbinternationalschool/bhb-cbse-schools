/**
 * Self-test: a fee push must never erase lines it was not given.
 *
 * 2026-09-01, 00:03 IST. One desk push carried 134 voucher HEADERS with empty
 * `lines` arrays. The push deleted the lines of every voucher it named and
 * re-inserted from the payload — so 134 receipts, RCV-00001..00227, worth
 * 5,80,543, were left showing a guardian and an amount with no student, no
 * head and no month. Dues clear FROM the lines, so every month those families
 * had paid read unpaid again.
 *
 * The same lesson had already been learnt one level up: voucher HEADERS are
 * append-only after eight receipts vanished on 2026-08-26. Lines never got
 * the same protection.
 */

import assert from "node:assert/strict";

import {
  voucherIdsCarryingLines,
  voucherIdsCarryingTenders,
} from "./feesNormalized.server";
import type { CollectionVoucher } from "./fees";

console.log("feePushLineSafety.selftest.ts");

const v = (id: string, lines: unknown[], tenders: unknown[] = [{ mode: "cash" }]) =>
  ({ id, lines, tenders }) as unknown as CollectionVoucher;

/* The exact shape of the incident: headers with no lines. */
{
  const push = [
    v("rcv_a", []),
    v("rcv_b", []),
    v("rcv_c", [{ dueKey: "acad:1" }]),
  ];
  assert.deepEqual(
    voucherIdsCarryingLines(push),
    ["rcv_c"],
    "ONLY the voucher that actually brought lines may have its lines replaced",
  );
  assert.ok(
    !voucherIdsCarryingLines(push).includes("rcv_a"),
    "a header pushed with no lines must not delete the server's — this is the bug",
  );
}

/* Every voucher carrying lines is still replaced, so edits still land. */
{
  const push = [v("rcv_a", [{ dueKey: "x" }]), v("rcv_b", [{ dueKey: "y" }, { dueKey: "z" }])];
  assert.deepEqual(voucherIdsCarryingLines(push), ["rcv_a", "rcv_b"]);
}

/* Missing, null and non-array lines all count as "not carried". */
{
  const push = [
    { id: "rcv_missing", tenders: [] } as unknown as CollectionVoucher,
    { id: "rcv_null", lines: null, tenders: [] } as unknown as CollectionVoucher,
    { id: "rcv_str", lines: "oops", tenders: [] } as unknown as CollectionVoucher,
  ];
  assert.deepEqual(
    voucherIdsCarryingLines(push),
    [],
    "a malformed payload must not be read as an instruction to delete",
  );
}

/* Tenders follow the same rule — the money side must not be erased either. */
{
  const push = [v("rcv_a", [{ dueKey: "x" }], []), v("rcv_b", [{ dueKey: "y" }], [{ mode: "upi" }])];
  assert.deepEqual(
    voucherIdsCarryingTenders(push),
    ["rcv_b"],
    "only a push carrying tenders may replace them",
  );
}

/* An empty push deletes nothing at all. */
{
  assert.deepEqual(voucherIdsCarryingLines([]), []);
  assert.deepEqual(voucherIdsCarryingTenders([]), []);
}

console.log("  ok — a push replaces only what it brings, and erases nothing it omits");
