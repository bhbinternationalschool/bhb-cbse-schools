/**
 * Put the fee receipts' LINES and TENDERS back, from the BigQuery mirror.
 *
 * On 2026-09-06 `fee_desk_voucher_lines` and `fee_desk_voucher_tenders` were
 * emptied outright — 0 rows against 502 receipt headers holding ₹20.8 lakh.
 * A receipt with no lines has a guardian and an amount but no student, no fee
 * head and no month, and because dues clear FROM the lines, every month those
 * families had paid reads unpaid again. That is the same damage as 2026-09-01,
 * on the whole book instead of 134 receipts.
 *
 * The source is BigQuery time travel, not the live mirror: the nightly sync
 * had already copied the emptiness forward, so `bhb_erp.fee_desk_voucher_lines`
 * reads 0 today. `FOR SYSTEM_TIME AS OF` still sees the table as the sync of
 * 2026-09-05 20:30 UTC left it — 1,913 lines over 435 receipts, and 526
 * tenders. That snapshot was checked before it was trusted: 430 receipts'
 * lines sum EXACTLY to the receipt total, 5 are the partial-loss receipts
 * already known from the last incident, and 67 had no lines even then.
 *
 * ON CONFLICT DO NOTHING, deliberately. If a row is already there — because
 * the counter re-attached it by hand, or because this ran twice — the live
 * row wins. This script only fills holes; it never overwrites today's work.
 *
 *   node scripts/restore-fee-lines.mjs --dry-run   # counts only, writes nothing
 *   node scripts/restore-fee-lines.mjs --apply
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ENV_PATH = fileURLToPath(
  new URL("../apps/web/.env.local", import.meta.url),
);

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = loadEnv(process.env.ENV_FILE || ENV_PATH);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const DIR = process.argv.find((a) => a.startsWith("--dir="))?.slice(6);
if (!DIR) {
  console.error("Pass --dir=<directory holding restore_lines.json / restore_tenders.json>");
  process.exit(1);
}
const APPLY = process.argv.includes("--apply");

const lines = JSON.parse(readFileSync(`${DIR}/restore_lines.json`, "utf8"));
const tenders = JSON.parse(readFileSync(`${DIR}/restore_tenders.json`, "utf8"));

/**
 * A standalone script builds its own client, so it never passes through the
 * app's write guard in apps/web/src/lib/supabase/server.ts. That is exactly
 * the bypass that made 2026-09-06 possible, so the demand is made here
 * instead: writing needs the same env var, typed on purpose, per run.
 */
if (APPLY && process.env.ALLOW_LOCAL_PROD_WRITES !== "1") {
  console.error(
    "Refusing to write: this script talks straight to the production database " +
      "and bypasses the app's write guard.\n" +
      "Re-run it as:\n\n" +
      "  ALLOW_LOCAL_PROD_WRITES=1 node scripts/restore-fee-lines.mjs --dir=… --apply\n",
  );
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

/** BigQuery mirrors everything as STRING; the columns here are bigint/jsonb. */
function lineRow(l) {
  return {
    id: l.id,
    voucher_id: l.voucher_id,
    tenant_id: l.tenant_id,
    student_id: l.student_id,
    due_key: l.due_key,
    kind: l.kind,
    label: l.label,
    amount_paise: Number(l.amount_paise),
    line_json: l.line_json ? JSON.parse(l.line_json) : {},
  };
}

function tenderRow(t) {
  return {
    id: t.id,
    voucher_id: t.voucher_id,
    tenant_id: t.tenant_id,
    tender_index: Number(t.tender_index),
    mode: t.mode,
    amount_paise: Number(t.amount_paise),
    ref: t.ref ?? "",
    instrument_date: t.instrument_date || null,
    bank_name: t.bank_name ?? "",
    realisation: t.realisation ?? "",
    tender_json: t.tender_json ? JSON.parse(t.tender_json) : {},
  };
}

/**
 * Only restore lines whose receipt still exists.
 *
 * A line pointing at a voucher the desk no longer holds would fail the foreign
 * key and take its whole batch down with it — and it would be wrong anyway.
 */
async function liveVoucherIds() {
  const ids = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("fee_desk_vouchers")
      .select("id")
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`voucher read failed: ${error.message}`);
    for (const r of data) ids.add(r.id);
    if (data.length < 1000) break;
  }
  return ids;
}

async function insertAll(table, rows) {
  let done = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    // No upsert: ON CONFLICT DO NOTHING is the point — never clobber a live row.
    const { error } = await sb.from(table).insert(batch, { count: "exact" });
    if (error) {
      if (!/duplicate key/i.test(error.message)) {
        throw new Error(`${table} insert failed at row ${i}: ${error.message}`);
      }
      // A batch that collides is retried one row at a time so the rest land.
      for (const row of batch) {
        const { error: e1 } = await sb.from(table).insert(row);
        if (e1 && !/duplicate key/i.test(e1.message)) {
          throw new Error(`${table} row ${row.id} failed: ${e1.message}`);
        }
        if (!e1) done += 1;
      }
      continue;
    }
    done += batch.length;
  }
  return done;
}

const live = await liveVoucherIds();
const lineRows = lines.map(lineRow).filter((r) => live.has(r.voucher_id));
const tenderRows = tenders.map(tenderRow).filter((r) => live.has(r.voucher_id));
const droppedLines = lines.length - lineRows.length;
const droppedTenders = tenders.length - tenderRows.length;

console.log(`live receipts in desk : ${live.size}`);
console.log(`lines in snapshot     : ${lines.length} (restoring ${lineRows.length}, dropping ${droppedLines} orphaned)`);
console.log(`tenders in snapshot   : ${tenders.length} (restoring ${tenderRows.length}, dropping ${droppedTenders} orphaned)`);
console.log(
  `money in restored lines: ₹${(lineRows.reduce((s, r) => s + r.amount_paise, 0) / 100).toLocaleString("en-IN")}`,
);

if (!APPLY) {
  console.log("\n--dry-run: nothing written. Re-run with --apply.");
  process.exit(0);
}

const nLines = await insertAll("fee_desk_voucher_lines", lineRows);
const nTenders = await insertAll("fee_desk_voucher_tenders", tenderRows);
console.log(`\ninserted ${nLines} lines, ${nTenders} tenders`);
