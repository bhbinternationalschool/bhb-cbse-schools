import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

console.log("accountsFeesPagedReads.selftest.ts");

/**
 * The accounts desk and the fee desk's ancillary lists (cheques, day closes,
 * plans, allocations, charge vouchers, carried-forward dues) were each read
 * in ONE request per table. PostgREST stops at 1,000 rows and reports the cut
 * as success: the cash and bank ledgers and the journal lines pass that, and
 * cheques and allocations grow with every receipt.
 *
 * Both readers also dropped their errors, so a failed read came back as an
 * empty desk — and the server hydrates merged that with preferDb, emptying
 * the server's accounts or fee copy; the fee cutover then saw 0 vouchers and
 * backfilled the old blob over the real desk.
 *
 * Now every list is paged, a failed read says ok:false, and nothing treats it
 * as empty. This reads the code itself.
 */

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
const fnOf = (src: string, name: string) => {
  const a = src.indexOf(`export async function ${name}`);
  assert.ok(a >= 0, `found ${name}`);
  const b = src.indexOf("\nexport ", a + 10);
  return src.slice(a, b > 0 ? b : undefined);
};

// ── Accounts ───────────────────────────────────────────────────────────────
{
  const f = fnOf(read("accountsNormalized.server.ts"), "fetchAccountsDeskFromDb");
  assert.equal(/\.select\("\*"\)\.eq\("tenant_id", tenantId\),\n/.test(f), false, "no single-request list read");
  assert.ok(/fetchAllPages<Record<string, unknown>>/.test(f), "lists are paged");
  for (const t of ["accounts_desk_cash_ledger", "accounts_desk_bank_ledger", "accounts_desk_journal_lines"]) {
    assert.ok(f.includes(`page("${t}")`), `${t} is read paged`);
  }
  assert.ok(/page\("accounts_desk_mode_bank_map", "mode"\)/.test(f), "the mode map (no id column) pages by mode");
  assert.ok(/if \(failed\?\.error\)[\s\S]*?ok: false/.test(f), "a failed read says so");

  const route = read("../app/api/school-data/accounts-desk/route.ts");
  assert.ok(/if \(!ok\) \{[\s\S]*?status: 503/.test(route), "the route answers 503, not an empty desk");
  const persist = read("accountsPersistence.ts");
  assert.ok(/if \(!dbDesk\.ok\) \{/.test(persist), "the server hydrate does not merge a failed read");
}

// ── Fee ancillary ──────────────────────────────────────────────────────────
{
  const f = fnOf(read("feesDeskAncillary.server.ts"), "fetchFeeDeskAncillaryFromDb");
  assert.ok(/fetchAllPages<Record<string, unknown>>/.test(f), "lists are paged");
  for (const t of ["fee_desk_cheques", "fee_desk_plan_allocations", "fee_desk_charge_voucher_lines"]) {
    assert.ok(f.includes(`page("${t}")`), `${t} is read paged`);
  }
  assert.ok(/ok: false, error: failed\.error/.test(f), "a failed read says so");

  const fees = read("feesNormalized.server.ts");
  assert.ok(/ok: ok && anc\.ok/.test(fees), "the fee desk read fails if either half failed");
  const persist = read("feesPersistence.server.ts");
  assert.ok(/dbDesk\.ok &&\s*\(dbDesk\.vouchers\.length > 0/.test(persist), "the server hydrate does not merge a failed read");
  const cutover = read("ensureDeskCutover.server.ts");
  assert.ok(/if \(!desk\.ok\) return \{ module: id, action: "skip", detail: "fee desk unreadable" \}/.test(cutover), "no blob backfill over an unread fee desk");
}

console.log("accountsFeesPagedReads.selftest: all assertions passed");
