import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

console.log("accountsNoPrune.selftest.ts");

/**
 * An accounts desk save deleted every row of 22 tables that the browser did
 * not hold: a fee counter that had not re-read erased the office's cash and
 * bank entries, and a fresh browser's seeded chart of accounts erased the
 * school's. Ledgers, vouchers, bills, loans and journals are voided, never
 * deleted. Only the four masters the UI can delete may be deleted, and only
 * by named id. This reads the push code itself, so a prune cannot come back.
 */

const src = readFileSync(join(__dirname, "accountsNormalized.server.ts"), "utf8");
const push = src.slice(
  src.indexOf("export async function pushAccountsDeskToDb"),
  src.indexOf("export async function fetchAccountsDeskFromDb"),
);
assert.ok(push.length > 500, "found the push code");

assert.equal(/deleteStale/.test(src), false, "no prune-by-absence helper in the accounts module");
assert.equal(/\.delete\(\)/.test(push.replace(/\.from\("accounts_desk_mode_bank_map"\)\s*\.delete\(\)\s*\.eq\("tenant_id", tenantId\)\s*\.in\("bank_id", goneBanks\)/, "")), false,
  "the push deletes only through deleteNamedIds (and unmaps modes of a named-deleted bank)");
assert.ok(/deleteNamedIds\(sb, tenantId, table, deletes\[table\]\)/.test(push), "masters are deleted by named id");

const allowed = src.slice(src.indexOf("ACCOUNTS_DELETABLE_TABLES = ["), src.indexOf("] as const;"));
const deletable = [...allowed.matchAll(/"(accounts_desk_[a-z_]+)"/g)].map((m) => m[1]).sort();
assert.deepEqual(deletable, [
  "accounts_desk_bank_accounts",
  "accounts_desk_coa_accounts",
  "accounts_desk_expense_categories",
  "accounts_desk_vendors",
], "only the four masters with a delete button may be deleted");

// Each of those delete buttons names its deletion.
for (const [file, table] of [
  ["accountsCashBank.ts", "accounts_desk_bank_accounts"],
  ["accountsCoa.ts", "accounts_desk_coa_accounts"],
  ["accountsExpenseCategories.ts", "accounts_desk_expense_categories"],
  ["accountsVendors.ts", "accounts_desk_vendors"],
] as const) {
  const f = readFileSync(join(__dirname, file), "utf8");
  assert.ok(f.includes(`recordAccountsDeletion("${table}"`), `${file} must name its deletion of ${table}`);
}

// The route passes the client's named deletes through, restricted to those tables.
const route = readFileSync(join(__dirname, "../app/api/school-data/accounts-desk/route.ts"), "utf8");
assert.ok(/readNamedDeletes\(body\.deletes, ACCOUNTS_DELETABLE_TABLES\)/.test(route), "route reads named deletes");

console.log("accountsNoPrune.selftest: all assertions passed");
