import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

console.log("feeExtrasForwardOnly.selftest.ts");

/**
 * Fee extras (cheques, day closes, charge vouchers, carried-forward dues,
 * instalment plans, plan allocations): a save — often the server's cached
 * desk — can't move a stored row backwards.
 */

type Row = Record<string, unknown> & { id: string };
const stored = new Map<string, Row>();
let failRead = false;
const sb = {
  from: () => {
    let ids: string[] = [];
    const q = {
      select: () => q,
      eq: () => q,
      in: (_k: string, v: string[]) => {
        ids = v;
        return q;
      },
      order: () => q,
      range: async () =>
        failRead ? { data: null, error: { message: "timeout" } } : { data: [...stored.values()].filter((r) => ids.includes(r.id)), error: null },
    };
    return q;
  },
} as unknown as SupabaseClient;

void (async () => {
  const { withoutStale, FEE_STALE_RULES } = await import("./feesDeskAncillary.server");
  const ids = (r: { ok: true; rows: Record<string, unknown>[] } | { ok: false; error: string }) =>
    r.ok ? r.rows.map((x) => String(x.id)) : null;

  // Cheques
  stored.clear();
  stored.set("c1", { id: "c1", status: "cleared" });
  stored.set("c2", { id: "c2", status: "deposited" });
  stored.set("c3", { id: "c3", status: "bounced" });
  let r = await withoutStale(sb, "t", "fee_desk_cheques", [
    { id: "c1", status: "received" }, // stale: was cleared at the counter
    { id: "c2", status: "cleared" }, // forward
    { id: "c3", status: "cleared" }, // the other end: bounced is final
    { id: "c4", status: "received" }, // new
  ]);
  assert.deepEqual(ids(r), ["c2", "c4"]);

  // Day closes: latest action wins; approved is final; a rejected close can be resubmitted.
  stored.clear();
  stored.set("d1", { id: "d1", status: "submitted", created_at: "2026-10-10T16:00:00Z", submitted_at: "2026-10-10T17:00:00Z" });
  stored.set("d2", { id: "d2", status: "approved", created_at: "2026-10-09T16:00:00Z", submitted_at: "2026-10-09T17:00:00Z", resolved_at: "2026-10-09T18:00:00Z" });
  stored.set("d3", { id: "d3", status: "rejected", created_at: "2026-10-08T16:00:00Z", submitted_at: "2026-10-08T17:00:00Z", resolved_at: "2026-10-08T18:00:00Z" });
  r = await withoutStale(sb, "t", "fee_desk_day_closes", [
    { id: "d1", status: "draft", created_at: "2026-10-10T16:00:00Z", submitted_at: null }, // stale draft
    { id: "d2", status: "submitted", created_at: "2026-10-09T16:00:00Z", submitted_at: "2026-10-10T09:00:00Z" }, // approved is final
    { id: "d3", status: "submitted", created_at: "2026-10-08T16:00:00Z", submitted_at: "2026-10-10T09:00:00Z" }, // resubmitted after rejection
  ]);
  assert.deepEqual(ids(r), ["d3"]);

  // Voided stays voided; cancelled plans stay cancelled; completed ↔ active is allowed.
  stored.clear();
  stored.set("v1", { id: "v1", voided_at: "2026-10-10T10:00:00Z" });
  r = await withoutStale(sb, "t", "fee_desk_charge_vouchers", [{ id: "v1", voided_at: null }, { id: "v2", voided_at: null }]);
  assert.deepEqual(ids(r), ["v2"]);
  r = await withoutStale(sb, "t", "fee_desk_carried_forward", [{ id: "v1", voided_at: null }]);
  assert.deepEqual(ids(r), []);
  stored.clear();
  stored.set("p1", { id: "p1", status: "cancelled" });
  stored.set("p2", { id: "p2", status: "completed" });
  r = await withoutStale(sb, "t", "fee_desk_installment_plans", [{ id: "p1", status: "active" }, { id: "p2", status: "active" }]);
  assert.deepEqual(ids(r), ["p2"], "a voided receipt may reopen a completed plan; nothing reopens a cancelled one");

  failRead = true;
  r = await withoutStale(sb, "t", "fee_desk_cheques", [{ id: "c9", status: "received" }]);
  assert.equal(r.ok, false, "a failed read writes nothing");
  failRead = false;
  assert.equal(Object.keys(FEE_STALE_RULES).length, 5);

  // ── Wiring ─────────────────────────────────────────────────────────────
  const src = readFileSync(join(__dirname, "feesDeskAncillary.server.ts"), "utf8");
  const push = src.slice(src.indexOf("export async function pushFeeDeskAncillaryToDb("), src.indexOf("export async function fetchFeeDeskAncillaryFromDb("));
  for (const t of Object.keys(FEE_STALE_RULES)) {
    assert.ok(push.includes(`withoutStale(sb, tenantId, "${t}", rows)`), `${t} is written through withoutStale`);
  }
  assert.ok(/upsert\(rows, \{ onConflict: "id", ignoreDuplicates: true \}\)/.test(push), "plan allocations insert-only");
  assert.ok(/!skippedCharges\.has\(String\(l\.charge_voucher_id\)\)/.test(push), "a kept charge keeps its stored lines");
  assert.equal(/cheque_count: cheques\.length/.test(push), false, "meta counts come from the tables");

  console.log("feeExtrasForwardOnly.selftest: all assertions passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
