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

/* ------------------------------------------------------------------ *
 * 2026-09-06: the same damage again, by a different route.
 *
 * The guard above governs WHICH vouchers get their lines deleted. It says
 * nothing about whether the delete survives an insert that dies behind it —
 * and the push ran delete and insert as separate PostgREST statements with
 * no transaction. When the insert failed, the deletes stayed committed: 0
 * rows in fee_desk_voucher_lines against 502 receipt headers, ₹20.8 lakh of
 * collections with no breakdown at all.
 *
 * The delete and the insert now happen inside one plpgsql function, so a
 * failure rolls both back. What is testable here without a database is the
 * check that runs BEFORE it: a payload with two lines claiming the same id
 * is refused outright, because that id is `${voucherId}:${dueKey}` and a
 * repeat means two lines settling the same due. Collapsing them would lose
 * money detail; the push declines and writes nothing.
 * ------------------------------------------------------------------ */

import { firstDuplicateId } from "./feesNormalized.server";

{
  assert.equal(
    firstDuplicateId([{ id: "rcv_a:acad:1" }, { id: "rcv_a:acad:2" }]),
    null,
    "two different dues on one receipt are ordinary",
  );

  assert.equal(
    firstDuplicateId([
      { id: "rcv_a:acad:1" },
      { id: "rcv_b:acad:1" },
      { id: "rcv_a:acad:1" },
    ]),
    "rcv_a:acad:1",
    "the same due twice on the same receipt must be refused, not deduped",
  );

  // The same due on two DIFFERENT receipts is a part payment — ₹1,350 then
  // ₹300 against one ₹1,650 tuition due. The 2026-09-01 analysis mistook 13
  // of these for duplicates and nearly excluded them from the restore.
  assert.equal(
    firstDuplicateId([{ id: "rcv_a:acad:1" }, { id: "rcv_b:acad:1" }]),
    null,
    "a due settled across two receipts is a part payment, never a duplicate",
  );

  assert.equal(firstDuplicateId([]), null, "an empty push has nothing to refuse");
}

console.log("feePushLineSafety.selftest.ts OK");
