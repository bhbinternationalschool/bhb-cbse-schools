/**
 * Self-test: the check that would have caught both fee-line wipes in an hour
 * instead of fourteen.
 *
 * A live receipt holding money with no lines is the incident shape — 134
 * receipts on 2026-09-01, all 502 on 2026-09-06. The Accounts controls page
 * raised it correctly both times and nobody was looking at the Accounts
 * controls page; the director found the second one on his own screen. So the
 * judgement below now runs hourly and pushes.
 *
 *   npm run -w web test:fee-integrity
 */

import assert from "node:assert/strict";
import { classifyReceipts } from "./feeIntegrityAlert.server";

console.log("feeIntegrityAlert.selftest.ts");

const v = (id: string, receipt_no: string, total_paise: number) => ({
  id,
  receipt_no,
  total_paise,
});

/* The incident: money, no lines at all. */
{
  const { blankReceipts, mismatchedReceipts } = classifyReceipts(
    [v("rcv_a", "RCV-00001", 50000), v("rcv_b", "RCV-00002", 120000)],
    new Map([["rcv_b", 120000]]),
  );
  assert.deepEqual(
    blankReceipts,
    [{ receiptNo: "RCV-00001", paise: 50000 }],
    "a receipt with no lines at all is the one worth waking someone for",
  );
  assert.equal(mismatchedReceipts.length, 0, "the intact receipt is not flagged");
}

/* A receipt whose lines net to ZERO has lines. It is not blank.
 *
 * This is the reason the check keys on Map.has() and never on falsiness: `0`
 * is a real sum, and reading it as "missing" would report a fully-attached
 * receipt as the incident shape and bury the real one in noise. */
{
  const { blankReceipts, mismatchedReceipts } = classifyReceipts(
    [v("rcv_z", "RCV-00009", 30000)],
    new Map([["rcv_z", 0]]),
  );
  assert.equal(blankReceipts.length, 0, "0 is a sum, not a missing entry");
  assert.deepEqual(mismatchedReceipts, [
    { receiptNo: "RCV-00009", paise: 30000, linePaise: 0 },
  ]);
}

/* Partial loss — lines exist but do not add up. Reported, not alarmed. */
{
  const { blankReceipts, mismatchedReceipts } = classifyReceipts(
    [v("rcv_c", "RCV-00178", 400000)],
    new Map([["rcv_c", 250000]]),
  );
  assert.equal(blankReceipts.length, 0);
  assert.deepEqual(mismatchedReceipts, [
    { receiptNo: "RCV-00178", paise: 400000, linePaise: 250000 },
  ]);
}

/* The healthy book: every receipt's lines sum to its total, nothing raised. */
{
  const { blankReceipts, mismatchedReceipts } = classifyReceipts(
    [v("rcv_d", "RCV-00050", 490000), v("rcv_e", "RCV-00051", 750000)],
    new Map([
      ["rcv_d", 490000],
      ["rcv_e", 750000],
    ]),
  );
  assert.equal(blankReceipts.length, 0);
  assert.equal(mismatchedReceipts.length, 0);
}

console.log("feeIntegrityAlert.selftest.ts OK");
