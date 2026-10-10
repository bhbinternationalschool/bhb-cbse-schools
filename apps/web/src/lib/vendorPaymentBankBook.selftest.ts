/**
 * Self-test: a store vendor payment must reach the DESK bank book.
 *
 * The store pays through inv_pay_vendor_bill, which writes the server book
 * (Dr 2000 Accounts Payable / Cr tender) and nothing else. The desk's own
 * bank ledger never saw a store payment, so the Accounts dashboard's "Bank
 * balances" counted money coming IN and none going OUT: in production, 170
 * debits and zero credits, while the server book carried ₹3,06,784.94 of bank
 * payments the desk had never heard of.
 */

import assert from "node:assert/strict";

import { bankBalancePaise, bankMovementExists } from "./accountsCashBank";
import type { AccountsState, BankLedgerEntry } from "./accountsTypes";

console.log("vendorPaymentBankBook.selftest.ts");

const entry = (p: Partial<BankLedgerEntry>): BankLedgerEntry =>
  ({
    id: "ble_1",
    bankId: "bnk_1",
    date: "2026-09-01",
    direction: "dr",
    amountPaise: 0,
    mode: "upi",
    sourceType: "fee_voucher",
    sourceId: "",
    narration: "",
    transactionRef: "",
    createdAt: "2026-09-01T00:00:00.000Z",
    voidedAt: null,
    cancelReason: "",
    ...p,
  }) as BankLedgerEntry;

const state = (ledger: BankLedgerEntry[]): AccountsState =>
  ({
    bankAccounts: [
      { id: "bnk_1", name: "UBI -Main", openingBalancePaise: 0, isActive: true },
    ],
    bankLedger: ledger,
  }) as unknown as AccountsState;

/* A bank balance must be receipts IN minus payments OUT. */
{
  const s = state([
    entry({ id: "b1", direction: "dr", amountPaise: 500_00, sourceType: "fee_voucher" }),
    entry({
      id: "b2",
      direction: "cr",
      amountPaise: 200_00,
      sourceType: "inv_vendor_payment",
      sourceId: "PAY-1",
    }),
  ]);
  assert.equal(
    bankBalancePaise("bnk_1", s),
    300_00,
    "a vendor payment must REDUCE the bank balance — without the credit it read 500",
  );
}

/* The guard that stops a replayed payment posting twice. */
{
  const s = state([
    entry({
      id: "b1",
      direction: "cr",
      amountPaise: 200_00,
      sourceType: "inv_vendor_payment",
      sourceId: "PAY-1",
    }),
  ]);
  assert.equal(
    bankMovementExists("inv_vendor_payment", "PAY-1", s),
    true,
    "a payment already in the bank book is recognised, so a retry cannot double it",
  );
  assert.equal(
    bankMovementExists("inv_vendor_payment", "PAY-2", s),
    false,
    "a different payment is still allowed through",
  );
  assert.equal(
    bankMovementExists("fee_voucher", "PAY-1", s),
    false,
    "the source TYPE is part of the key — a fee receipt and a payment never collide",
  );
  assert.equal(
    bankMovementExists("inv_vendor_payment", "", s),
    false,
    "an empty source id never counts as already-posted",
  );
}

/* A voided payment must not keep suppressing a re-post. */
{
  const s = state([
    entry({
      id: "b1",
      direction: "cr",
      amountPaise: 200_00,
      sourceType: "inv_vendor_payment",
      sourceId: "PAY-1",
      voidedAt: "2026-09-01T10:00:00.000Z",
    }),
  ]);
  assert.equal(
    bankMovementExists("inv_vendor_payment", "PAY-1", s),
    false,
    "a voided entry does not block re-posting",
  );
  assert.equal(
    bankBalancePaise("bnk_1", s),
    0,
    "and a voided payment does not move the balance",
  );
}

console.log("  ok — store payments credit the desk bank book, once and only once");
