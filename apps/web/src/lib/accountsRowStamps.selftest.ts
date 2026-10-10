import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AccountsState } from "./accountsTypes";
import { captureAccountsStamps, stampedPayload } from "./accountsNormalizedClient";
import { ACCOUNTS_STAMPED_SLICES, ACCOUNTS_STAMPED_TABLES } from "./accountsStampSlices";

console.log("accountsRowStamps.selftest.ts");

/**
 * Stamped saves on the accounts desk (10 Oct 2026). Every save used to
 * upsert all 22 tables from the browser's copy, so a stale tab quietly
 * reversed another PC's ledger line, voucher or journal. Now a save sends
 * only the rows this browser changed, each with the stamp it loaded, and the
 * server writes a row only while it is still at that stamp; a tab from an
 * older build may add rows but never replace one.
 */

const desk = (over: Partial<AccountsState> = {}): AccountsState =>
  ({
    version: 1,
    cashPools: [{ id: "pool_main", code: "main", name: "Main", balancePaise: 0 }],
    cashLedger: [
      { id: "cl_1", poolId: "pool_main", amountPaise: 100_00, direction: "in" },
      { id: "cl_2", poolId: "pool_main", amountPaise: 50_00, direction: "out" },
    ],
    bankAccounts: [],
    bankLedger: [],
    modeBankMap: [],
    reconSessions: [],
    expenseCategories: [],
    expenseVouchers: [],
    recurringRules: [],
    vendors: [],
    vendorBills: [],
    payables: [],
    trustees: [],
    ownerLoans: [],
    ownerLoanSchedule: [],
    ownerCashHandovers: [],
    coaAccounts: [{ id: "coa_1", code: "1000", name: "Cash" }],
    journalEntries: [],
    fiscalYears: [],
    settings: { expenseApprovalPaise: 1_000_000, pettyThresholdPaise: 200_000 },
    ...over,
  }) as unknown as AccountsState;

{
  const loaded = desk();
  captureAccountsStamps(
    loaded as unknown as Record<string, unknown>,
    {
      cashPools: { pool_main: "s0" },
      cashLedger: { cl_1: "s1", cl_2: "s2" },
      coaAccounts: { coa_1: "s3" },
    },
    "s9",
  );

  // Nothing changed: no rows travel, settings are not touched.
  const idle = stampedPayload(loaded);
  for (const slice of ACCOUNTS_STAMPED_SLICES) {
    assert.deepEqual((idle.body as Record<string, unknown>)[slice], [], `${slice} sends nothing when unchanged`);
  }
  assert.equal(idle.body.settingsBase, null, "unchanged settings are not sent as a change");

  // One ledger line edited, one new line: only those two go, with their bases.
  const edited = desk({
    cashLedger: [
      { id: "cl_1", poolId: "pool_main", amountPaise: 120_00, direction: "in" },
      { id: "cl_2", poolId: "pool_main", amountPaise: 50_00, direction: "out" },
      { id: "cl_3", poolId: "pool_main", amountPaise: 10_00, direction: "out" },
    ] as never,
  });
  const p = stampedPayload(edited);
  assert.deepEqual(
    ((p.body as Record<string, unknown>).cashLedger as { id: string }[]).map((r) => r.id),
    ["cl_1", "cl_3"],
    "only the changed and the new row travel",
  );
  assert.deepEqual(p.stamps.cashLedger, { cl_1: "s1", cl_3: "" }, "edited row carries its base, new row ''");
  assert.deepEqual(p.stamps.coaAccounts, {}, "untouched chart is not sent");

  // Settings changed: sent against the stamp they were loaded at.
  const s2 = stampedPayload(desk({ settings: { expenseApprovalPaise: 5_00_000, pettyThresholdPaise: 200_000 } }));
  assert.equal(s2.body.settingsBase, "s9");
  console.log("  ok  a save sends only changed rows, each with the stamp it was loaded at");
}

// ── Wiring ─────────────────────────────────────────────────────────────────
const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
const server = read("accountsNormalized.server.ts");
assert.ok(
  /writeStampedRows\(sb, table, tenantId, changed, sliceStamps\)/.test(server),
  "a stamped save writes each changed row only at its stamp",
);
assert.ok(/insertMissingRows\(sb, table, rows\)/.test(server), "an unstamped save only inserts missing rows");
assert.ok(
  /ignoreDuplicates: true[\s\S]{0,80}\.select\("id"\)/.test(server),
  "insertMissingRows never replaces a stored row",
);
assert.ok(!/upsertChunks\(sb, table, keep\)/.test(server), "the old write-every-row loop is gone");
assert.ok(
  /parents\.has\(String\(r\[set\.parentKey\]\)\)/.test(server),
  "lines are written only under a parent whose save landed",
);
assert.ok(/\.eq\("updated_at", opts\.settingsBase\)/.test(server), "settings change only from the stamp they were loaded at");
assert.ok(/count: "exact", head: true/.test(server), "meta counts come from the tables, not a partial save");
assert.ok(/stamps\[slice\] = stampsOf\(/.test(server), "the load returns each row's stamp");
for (const t of Object.values(ACCOUNTS_STAMPED_TABLES)) {
  assert.ok(server.includes(`"${t}"`) || read("accountsStampSlices.ts").includes(`"${t}"`), `${t} is named`);
}
const route = read("../app/api/school-data/accounts-desk/route.ts");
assert.ok(/readStampsParam\(body\.stamps, ACCOUNTS_STAMPED_SLICES\)/.test(route), "the route passes the stamps through");
assert.ok(/conflicts: result\.conflicts/.test(route), "the route returns conflicts");
const client = read("accountsNormalizedClient.ts");
assert.ok(/onStampConflicts\(STAMP_MODULE, body\.conflicts\)/.test(client), "conflicts reload the desk and say so");
assert.ok(/captureAccountsStamps\(remote\.bundle/.test(client), "a load the browser takes becomes the base");
console.log("  ok  wiring: stamped writer, insert-only legacy, lines under landed parents, stamps on load");

console.log("\nAll accounts row-stamp checks passed.");
