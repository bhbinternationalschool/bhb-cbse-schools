/**
 * Self-test: a voided receipt must leave today's collection.
 *
 * Reported from the counter — a fee voided today still showed in the Accounts
 * dashboard's "Today's collection". The data layer was right all along
 * (vouchersForCollectionDate filters on !voidedAt); the tile was a useMemo
 * with an EMPTY dependency list, so it froze at whatever it read when the
 * panel mounted and only corrected on a page reload.
 *
 * This pins the data-layer rule, which the tile depends on.
 */

import assert from "node:assert/strict";

import { buildDayBook, vouchersForCollectionDate, emptyFeesState } from "./fees";
import type { CollectionVoucher, FeesState } from "./fees";

console.log("dayBookVoided.selftest.ts");

const TODAY = "2026-09-01";

const voucher = (p: Partial<CollectionVoucher>): CollectionVoucher =>
  ({
    id: "v1",
    receiptNo: "RCV-1",
    householdId: "hh1",
    collectionDate: TODAY,
    collectedAt: `${TODAY}T10:00:00.000Z`,
    totalPaise: 5000_00,
    voidedAt: null,
    lines: [],
    tenders: [{ mode: "cash", amountPaise: 5000_00, ref: "" }],
    ...p,
  }) as unknown as CollectionVoucher;

const fees = (vouchers: CollectionVoucher[]): FeesState =>
  ({ ...emptyFeesState(), vouchers }) as FeesState;

/* A live receipt counts. */
{
  const book = buildDayBook(TODAY, fees([voucher({})]));
  assert.equal(book.receiptCount, 1, "a live receipt is counted");
  assert.equal(book.totalPaise, 5000_00, "and its money is in the total");
  assert.equal(book.cashPaise, 5000_00, "cash total follows the tender");
}

/* A voided one does not — neither in the count nor in any total. */
{
  const book = buildDayBook(
    TODAY,
    fees([voucher({ id: "v1", voidedAt: `${TODAY}T11:00:00.000Z` })]),
  );
  assert.equal(book.receiptCount, 0, "a voided receipt is not counted");
  assert.equal(book.totalPaise, 0, "its money leaves today's collection");
  assert.equal(book.cashPaise, 0, "and leaves the cash split too");
}

/* Voiding one of several removes only that one. */
{
  const book = buildDayBook(
    TODAY,
    fees([
      voucher({ id: "a", receiptNo: "RCV-A" }),
      voucher({
        id: "b",
        receiptNo: "RCV-B",
        totalPaise: 3000_00,
        tenders: [{ mode: "cash", amountPaise: 3000_00, ref: "" }],
        voidedAt: `${TODAY}T12:00:00.000Z`,
      } as Partial<CollectionVoucher>),
    ]),
  );
  assert.equal(book.receiptCount, 1, "only the live receipt survives");
  assert.equal(book.totalPaise, 5000_00, "the voided one's money is gone, the other's is not");
  assert.deepEqual(
    vouchersForCollectionDate(TODAY, fees([
      voucher({ id: "a" }),
      voucher({ id: "b", voidedAt: `${TODAY}T12:00:00.000Z` }),
    ])).map((v) => v.id),
    ["a"],
    "the voucher list itself excludes the voided one",
  );
}

/* Yesterday's receipt is not today's collection. */
{
  const book = buildDayBook(
    TODAY,
    fees([voucher({ collectionDate: "2026-08-31" })]),
  );
  assert.equal(book.receiptCount, 0, "another day's receipt is not counted today");
}

console.log("  ok — voided receipts leave today's collection, live ones stay");
