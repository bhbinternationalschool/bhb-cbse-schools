/**
 * Self-test: cash that outlives its pool.
 * Run: npx tsx apps/web/src/lib/cashPoolOrphans.selftest.ts
 *
 * Pool ids are generated per browser. A re-seed, or a desk restored from
 * another machine, leaves cash-ledger entries pointing at ids that are gone —
 * and the desk then reports zero cash while 59 receipts sit there in full.
 * That is what happened in production: ₹2,37,325 of counter cash invisible.
 */

import assert from "node:assert/strict";

import { repairOrphanCashLedger } from "./accountsStore";
import type { AccountsState } from "./accountsTypes";

console.log("cashPoolOrphans.selftest.ts");

function state(pools: string[], entries: [string, number][]): AccountsState {
  return {
    cashPools: pools.map((id, i) => ({
      id,
      code: i === 0 ? "main" : "petty",
      name: i === 0 ? "Main Cash Box" : "Petty Cash",
      balancePaise: 0,
    })),
    cashLedger: entries.map(([poolId, amt], i) => ({
      id: `cle_${i}`,
      poolId,
      date: "2026-08-01",
      direction: "in",
      amountPaise: amt,
      sourceType: "fee_voucher",
      sourceId: "",
      narration: "Fee receipt RCV-00001",
      transactionRef: "",
      createdAt: "",
      voidedAt: null,
      cancelReason: "",
    })),
  } as unknown as AccountsState;
}

const cashOf = (s: AccountsState, poolId: string) =>
  s.cashLedger
    .filter((e) => e.poolId === poolId)
    .reduce((n, e) => n + e.amountPaise, 0);

/* ── The production shape: every entry orphaned ── */
const broken = state(
  ["pool_new_main", "pool_new_petty"],
  [["pool_gone_a", 131950_00], ["pool_gone_b", 114099_00], ["pool_gone_c", 10700_00]],
);
assert.equal(cashOf(broken, "pool_new_main"), 0, "starts invisible");

const fixed = repairOrphanCashLedger(broken);
assert.equal(
  cashOf(fixed, "pool_new_main"),
  131950_00 + 114099_00 + 10700_00,
  "all orphaned cash lands in the main box",
);
assert.equal(fixed.cashLedger.length, 3, "no entry is dropped");
assert.ok(
  fixed.cashLedger.every((e) => /re-homed/.test(e.narration)),
  "each moved entry says so, so the move is auditable",
);

/* ── A healthy desk is returned untouched, same object ── */
const healthy = state(["pool_a", "pool_b"], [["pool_a", 5000_00]]);
assert.equal(
  repairOrphanCashLedger(healthy),
  healthy,
  "no orphans means no rewrite — callers compare by identity",
);

/* ── Partial orphaning only moves what is actually orphaned ── */
const partial = state(["pool_a", "pool_b"], [["pool_a", 1000_00], ["pool_gone", 2000_00]]);
const partialFixed = repairOrphanCashLedger(partial);
assert.equal(cashOf(partialFixed, "pool_a"), 3000_00, "orphan joins the main box");
assert.equal(
  partialFixed.cashLedger.filter((e) => /re-homed/.test(e.narration)).length,
  1,
  "the healthy entry is left alone",
);

/* ── Degenerate inputs do not throw ── */
assert.doesNotThrow(() => repairOrphanCashLedger(state([], [["pool_gone", 100]])));
assert.doesNotThrow(() => repairOrphanCashLedger(state(["pool_a"], [])));

console.log("OK — cashPoolOrphans.selftest.ts");
