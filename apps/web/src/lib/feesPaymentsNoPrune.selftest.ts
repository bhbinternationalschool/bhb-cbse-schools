import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

console.log("feesPaymentsNoPrune.selftest.ts");

/**
 * Fee cheques, day closes, plans, allocations, carried-forward dues, charge
 * vouchers and payment links were each pruned of every row a save did not
 * carry. The saves come from browsers that read once per session AND from the
 * server's own cached copy (gateway settlement, the staff app's collect,
 * refunds, /pay/due, the WhatsApp bot, autopay) — a settlement on an instance
 * with an empty link cache kept one payment link and deleted the rest.
 * None of these rows is ever hard-deleted in the UI except a day close that a
 * newer session replaces (named) and a voided receipt's plan allocations
 * (scoped to receipts the payload says are voided). This reads the push code
 * itself, so a prune cannot quietly come back.
 */

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");

// ── Fee ancillary ──────────────────────────────────────────────────────────
{
  const src = read("feesDeskAncillary.server.ts");
  const push = src.slice(
    src.indexOf("export async function pushFeeDeskAncillaryToDb"),
    src.indexOf("export async function fetchFeeDeskAncillaryFromDb") > 0
      ? src.indexOf("export async function fetchFeeDeskAncillaryFromDb")
      : undefined,
  );
  assert.ok(push.length > 500, "found the ancillary push");
  assert.equal(/deleteStale/.test(src), false, "no prune-by-absence helper in fee ancillary");

  for (const t of [
    "fee_desk_cheques",
    "fee_desk_manual_books",
    "fee_desk_charge_vouchers",
    "fee_desk_installment_plans",
    "fee_desk_carried_forward",
  ]) {
    assert.equal(
      new RegExp(`from\\("${t}"\\)\\s*\\.delete\\(`).test(push),
      false,
      `${t} must never be deleted by a desk save`,
    );
  }
  // Allocations: only those of receipts the payload says are voided.
  const allocDeletes = push.match(/from\("fee_desk_plan_allocations"\)\s*\.delete\(\)[^;]*;/g) ?? [];
  assert.equal(allocDeletes.length, 1);
  assert.ok(/\.in\("voucher_id",/.test(allocDeletes[0]!), "allocation deletes are scoped to voided receipts");
  // Day closes: named ids only.
  assert.ok(/deleteNamedIds\(sb, tenantId, "fee_desk_day_closes", \[\.\.\.goneCloses\]\)/.test(push));
  assert.ok(/FEE_ANCILLARY_DELETABLE_TABLES = \["fee_desk_day_closes"\] as const/.test(src));

  // The charge-voucher lines stay a per-parent replacement.
  assert.ok(
    /match: \{ charge_voucher_id: charges\.filter\(\(c\) => \(c\.lines \?\? \[\]\)\.length > 0\)\.map/.test(push),
    "charge lines replaced only for vouchers that arrived with lines",
  );

  const fees = read("fees.ts");
  assert.ok(/recordFeeDayCloseDeletion\(replaced\)/.test(fees), "a replaced day close is named");
  const route = read("../app/api/school-data/fees-vouchers/route.ts");
  assert.ok(/readNamedDeletes\(body\.deletes, FEE_ANCILLARY_DELETABLE_TABLES\)/.test(route));
}

// ── Payment links ──────────────────────────────────────────────────────────
{
  const src = read("paymentsNormalized.server.ts");
  assert.equal(/deleteStale/.test(src), false, "no prune-by-absence helper in payments");
  assert.equal(
    /from\("payment_desk_links"\)\s*\.delete\(/.test(src) ||
      /deleteIdsInChunks\(sb, "payment_desk_links"/.test(src),
    false,
    "payment links are never deleted by a save — cancel, expire and paid are statuses",
  );
  // Link lines: only lines gone from a link the payload carries.
  assert.ok(/linkIds\.has\(String\(r\.payment_link_id\)\)/.test(src), "line prune scoped to links in the payload");
  // ...which is only safe if the browser received every line: the read pages.
  assert.ok(/fetchByIds<Record<string, unknown>>\(\s*ids,/.test(src), "link lines are read paged");
}

console.log("feesPaymentsNoPrune.selftest: all assertions passed");
