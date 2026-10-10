import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

console.log("payrollStatutoryVaultNoPrune.selftest.ts");

/**
 * Payroll runs, their lines and audit trail, statutory remittance batches and
 * lines, and vault documents were each pruned of every row a save did not
 * carry — tenant-wide, lines included, from reads capped at 1,000 rows. The
 * payroll audit erased itself: the browser keeps the newest 500 entries and
 * every save deleted the rest.
 *
 * Now: runs, batches and documents are deleted only by named id; lines only
 * under parents the payload carries; the audit never. This reads the push
 * code itself, so a prune cannot quietly come back.
 */

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");

function pushOf(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `found ${start}`);
  return src.slice(a, b);
}

function onlyNamedOrScoped(
  push: string,
  named: string[],
  scoped: [table: string, parentColumn: string][],
  label: string,
) {
  assert.equal(/deleteStale/.test(push), false, `${label}: no prune-by-absence`);
  assert.equal(/\.delete\(\)/.test(push), false, `${label}: no direct deletes in the push`);
  const namedCalls = [...push.matchAll(/deleteNamedIds\(sb, tenantId, "([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(namedCalls.sort(), [...named].sort(), `${label}: named deletes`);
  const scopedCalls = [...push.matchAll(/deleteChildrenNotKept\(\s*sb,\s*tenantId,\s*"([a-z_]+)",\s*"([a-z_]+)"/g)].map(
    (m) => [m[1], m[2]],
  );
  assert.deepEqual(scopedCalls, scoped, `${label}: child deletes scoped to parent`);
}

// ── Payroll ────────────────────────────────────────────────────────────────
{
  const src = read("payrollNormalized.server.ts");
  assert.equal(/deleteStale/.test(src), false);
  const push = pushOf(src, "export async function pushPayrollDeskToDb", "export async function fetchPayrollDeskFromDb");
  onlyNamedOrScoped(push, ["payroll_desk_runs"], [["payroll_desk_run_lines", "run_id"]], "payroll");
  assert.equal(/payroll_desk_audit"[^\n]*delete/.test(push), false, "the payroll audit is append-only");
  assert.ok(/page\("payroll_desk_run_lines"\)/.test(src), "run lines are read paged");
  assert.ok(/line_index/.test(src.slice(src.indexOf("export async function fetchPayrollDeskFromDb"))), "lines read back in order");
  assert.ok(/recordPayrollRunDeletion\(run\.id\)/.test(read("payroll.ts")), "deleting a run names it");
  assert.ok(/readNamedDeletes\(body\.deletes, PAYROLL_DELETABLE_TABLES\)/.test(read("../app/api/school-data/payroll-desk/route.ts")));
}

// ── Statutory ──────────────────────────────────────────────────────────────
{
  const src = read("statutoryNormalized.server.ts");
  assert.equal(/deleteStale/.test(src), false);
  const push = pushOf(src, "export async function pushStatutoryDeskToDb", "export async function fetchStatutoryDeskFromDb");
  onlyNamedOrScoped(push, ["statutory_desk_batches"], [["statutory_desk_lines", "batch_id"]], "statutory");
  assert.ok(/page\("statutory_desk_lines"\)/.test(src), "lines are read paged");
  assert.ok(/recordStatutoryBatchDeletion\(removed\)/.test(read("statutoryRemit.ts")), "removing an empty batch names it");
  assert.ok(/readNamedDeletes\(body\.deletes, STATUTORY_DELETABLE_TABLES\)/.test(read("../app/api/school-data/statutory-desk/route.ts")));
}

// ── Vault ──────────────────────────────────────────────────────────────────
{
  const src = read("vaultNormalized.server.ts");
  assert.equal(/deleteStale/.test(src), false);
  const push = pushOf(src, "export async function pushVaultDeskToDb", "export async function fetchVaultDeskFromDb");
  onlyNamedOrScoped(push, ["vault_desk_documents"], [], "vault");
  assert.ok(/deleteNamedIds\(sb, tenantId, "vault_desk_documents", \[\.\.\.gone\]\)/.test(push));
  assert.ok(/recordVaultDocumentDeletion\(\[id\]\)/.test(read("vault.ts")), "deleting a document names it");
  assert.ok(/readNamedDeletes\(body\.deletes, VAULT_DELETABLE_TABLES\)/.test(read("../app/api/school-data/vault-desk/route.ts")));
}

console.log("payrollStatutoryVaultNoPrune.selftest: all assertions passed");
