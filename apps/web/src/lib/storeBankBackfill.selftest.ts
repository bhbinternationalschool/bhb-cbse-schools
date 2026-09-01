/**
 * Self-test: bringing the store's bank history into the desk bank book.
 *
 * Store banked and paid through the server inv_* module, which writes the
 * ledger and stops, so the desk bank ledger held 170 fee receipts and zero
 * store entries — the dashboard read about ₹2.6 lakh under the book for the
 * same accounts. This decides what to bring over, and must never bring the
 * same payment twice.
 */

import assert from "node:assert/strict";

import {
  decideStoreBankBackfill,
  type StoreBankMovementInput,
} from "./accountsStoreBankBackfill";
import type { AccountsState, BankLedgerEntry } from "./accountsTypes";

console.log("storeBankBackfill.selftest.ts");

const BANK = "bnk_main";

const state = (ledger: BankLedgerEntry[] = []): AccountsState =>
  ({
    bankAccounts: [{ id: BANK, name: "UBI -Main", openingBalancePaise: 0, isActive: true }],
    bankLedger: ledger,
  }) as unknown as AccountsState;

const mv = (p: Partial<StoreBankMovementInput> = {}): StoreBankMovementInput => ({
  sourceType: "inv_sale_payment",
  sourceId: "inv_sale_payment:1",
  deskBankId: BANK,
  date: "2026-07-01",
  direction: "dr",
  amountPaise: 1000_00,
  mode: "upi",
  narration: "Store sale receipt",
  reference: "",
  ...p,
});

const already = (sourceType: string, sourceId: string): BankLedgerEntry =>
  ({
    id: "ble_x",
    bankId: BANK,
    date: "2026-07-01",
    direction: "dr",
    amountPaise: 1000_00,
    mode: "upi",
    sourceType,
    sourceId,
    narration: "",
    transactionRef: "",
    createdAt: "2026-07-01T00:00:00.000Z",
    voidedAt: null,
    cancelReason: "",
  }) as BankLedgerEntry;

/* Sales come in, vendor payments go out. */
{
  const d = decideStoreBankBackfill(state(), [
    mv({ sourceId: "a", direction: "dr", amountPaise: 350_00 }),
    mv({ sourceId: "b", sourceType: "inv_vendor_payment", direction: "cr", amountPaise: 250_00 }),
  ]);
  assert.equal(d.accept.length, 2, "both accepted");
  const net = d.accept.reduce(
    (n, m) => n + (m.direction === "dr" ? m.amountPaise : -m.amountPaise),
    0,
  );
  assert.equal(net, 100_00, "the net is receipts minus payments, not receipts alone");
}

/* Anything already in the desk book is left alone — the button is safe twice. */
{
  const d = decideStoreBankBackfill(
    state([already("inv_sale_payment", "a")]),
    [mv({ sourceId: "a" }), mv({ sourceId: "b" })],
  );
  assert.equal(d.skippedExisting, 1, "the one already written is skipped");
  assert.deepEqual(d.accept.map((m) => m.sourceId), ["b"], "only the new one is accepted");
}

/* A duplicate inside ONE plan must not slip through the same-run gap. */
{
  const d = decideStoreBankBackfill(state(), [mv({ sourceId: "a" }), mv({ sourceId: "a" })]);
  assert.equal(d.accept.length, 1, "the repeat within a single plan is caught");
  assert.equal(d.skippedExisting, 1, "and counted as already handled");
}

/* Source type is part of the identity. */
{
  const d = decideStoreBankBackfill(
    state([already("inv_sale_payment", "a")]),
    [mv({ sourceId: "a", sourceType: "inv_vendor_payment", direction: "cr" })],
  );
  assert.equal(d.accept.length, 1, "a vendor payment is not confused with a sale receipt of the same id");
}

/* A voided desk entry must not suppress the real one. */
{
  const voided = { ...already("inv_sale_payment", "a"), voidedAt: "2026-08-01T00:00:00.000Z" };
  const d = decideStoreBankBackfill(state([voided as BankLedgerEntry]), [mv({ sourceId: "a" })]);
  assert.equal(d.accept.length, 1, "a voided entry does not block the movement");
}

/* Unknown bank and unknown tender are reported, never invented. */
{
  const d = decideStoreBankBackfill(state(), [
    mv({ sourceId: "a", deskBankId: "bnk_missing" }),
    mv({ sourceId: "b", mode: "crypto" }),
  ]);
  assert.equal(d.accept.length, 0, "neither is written");
  assert.equal(d.unknownBank, 1, "the unknown bank is counted");
  assert.equal(d.rejected.length, 1, "the unknown tender is rejected");
  assert.match(d.rejected[0]!.reason, /unrecognised payment mode/, "and says why");
}

/* Zero and empty rows are ignored rather than posted as nothing. */
{
  const d = decideStoreBankBackfill(state(), [
    mv({ sourceId: "", amountPaise: 100 }),
    mv({ sourceId: "z", amountPaise: 0 }),
  ]);
  assert.equal(d.accept.length, 0, "neither an id-less nor a zero-value row is written");
}

console.log("  ok — store history lands once, nets correctly, and guesses nothing");
