import assert from "node:assert/strict";
import {
  defaultCoaAccounts,
  migrateRefreshmentSubHead,
  normalizeCoa,
} from "./accountsNormalize";
import { COA_EXP_MESS, COA_EXP_MILK, type AccountsState } from "./accountsTypes";

console.log("refreshmentChartMigration.selftest.ts");

/**
 * 2026-09-01: "Mess Expenses" became Refreshment and milk became its
 * sub-head 5000.01. The old flat 5010 was seeded on the desk but never
 * existed in the server book, so every milk expense was refused.
 */

const base = (over: Partial<AccountsState> = {}): AccountsState =>
  ({
    coaAccounts: defaultCoaAccounts(),
    expenseCategories: [],
    ...over,
  }) as unknown as AccountsState;

// A chart still carrying the old shipped state.
const legacy = base({
  coaAccounts: [
    normalizeCoa({ code: COA_EXP_MESS, name: "Mess Expenses", group: "expense" }),
    normalizeCoa({ code: "5010", name: "Milk Expenses", group: "expense" }),
  ],
  expenseCategories: [
    { id: "c1", parentId: "", name: "Milk", coaCode: "5010", isActive: true, vendorIds: [] },
  ],
} as Partial<AccountsState>);

const out = migrateRefreshmentSubHead(legacy);
const by = (code: string) => out.coaAccounts.find((c) => c.code === code);

assert.equal(by(COA_EXP_MESS)?.name, "Refreshment", "5000 is renamed");
assert.ok(by(COA_EXP_MILK), "5000.01 sub-head is created");
assert.equal(by(COA_EXP_MILK)?.name, "Milk Expenses", "sub-head keeps the name");
assert.equal(by("5010")?.isActive, false, "the flat 5010 is retired");
assert.ok(by("5010"), "5010 is deactivated, NOT deleted — history must stay readable");
assert.equal(
  out.expenseCategories[0]!.coaCode,
  COA_EXP_MILK,
  "the Milk expense category follows the account, or entry keeps booking to a refused code",
);

// Idempotent: running it again changes nothing.
assert.equal(migrateRefreshmentSubHead(out), out, "second run is a no-op");

// A school that renamed 5000 themselves keeps their own name.
const custom = base({
  coaAccounts: [
    normalizeCoa({ code: COA_EXP_MESS, name: "Canteen & Refreshments", group: "expense" }),
  ],
} as Partial<AccountsState>);
assert.equal(
  migrateRefreshmentSubHead(custom).coaAccounts.find((c) => c.code === COA_EXP_MESS)?.name,
  "Canteen & Refreshments",
  "a name the school chose is never overwritten",
);

// The shipped seed already reflects the new structure.
const seeded = defaultCoaAccounts();
assert.ok(
  seeded.some((c) => c.code === COA_EXP_MILK),
  "the seed ships milk as the 5000.01 sub-head",
);
assert.ok(
  !seeded.some((c) => c.code === "5010"),
  "the seed no longer ships the flat 5010 that the book never had",
);

console.log("  ok — refreshment rename, milk sub-head, 5010 retired, category remapped");
