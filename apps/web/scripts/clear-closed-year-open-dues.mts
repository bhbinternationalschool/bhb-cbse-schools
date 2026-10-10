/**
 * Clear a CLOSED academic year out of the open-dues cache.
 *
 * Why this exists (2026-09-08): the cache carried 3,310 "open dues" for
 * 213 children under 2025-26, ₹35.8 lakh, every one fully unpaid. This ERP
 * holds ZERO receipts for 2025-26 — last year's collections lived in the old
 * ERP — so those rows are the fee structure billed with none of the year's
 * payments against it: an artefact of the March migration, not money owed.
 * The real carry-forward is what the office entered by hand as "Previous
 * Due" arrears in 2026-27 (32 children). Readers that do not filter by year
 * (the parent app's summary, the principal's open-dues tile, the ageing
 * figures) were adding the artefact to this year's book.
 *
 * Uses the desk's own transaction (fee_desk_replace_open_dues with an empty
 * payload: rows absent from the payload are deleted, sync meta updated),
 * after writing a JSON snapshot of the rows so the step is reversible.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/clear-closed-year-open-dues.mts --ay 2025-26
 *       Dry run: counts and snapshots, deletes nothing.
 *   ALLOW_LOCAL_PROD_WRITES=1 npx tsx scripts/clear-closed-year-open-dues.mts --ay 2025-26 --clear
 *       Clears, after a typed confirmation. Refuses the CURRENT year.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { createInterface } from "readline/promises";

for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  const k = t.slice(0, i);
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[k]) process.env[k] = v;
}

const args = process.argv.slice(2);
const ay = args[args.indexOf("--ay") + 1];
const CLEAR = args.includes("--clear");
if (!/^\d{4}-\d{2}$/.test(ay ?? "")) throw new Error("--ay YYYY-YY required, e.g. --ay 2025-26");

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const h = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const inr = (p: number) => "₹" + Math.round(p / 100).toLocaleString("en-IN");

async function pageAll<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  for (let off = 0; ; off += 1000) {
    const r = await fetch(`${URL_}/rest/v1/${path}&limit=1000&offset=${off}`, { headers: h });
    const j = (await r.json()) as T[];
    if (!Array.isArray(j)) throw new Error(JSON.stringify(j).slice(0, 300));
    out.push(...j);
    if (j.length < 1000) break;
  }
  return out;
}

// The current year is never cleared: its rows are live truth, rebuilt from
// receipts. Only a year with no receipts in this ERP is an artefact.
const receipts = await pageAll<{ id: string }>(`fee_desk_vouchers?academic_year_code=eq.${ay}&voided_at=is.null&select=id`);
const allYears = await pageAll<{ academic_year_code: string }>(`fee_desk_open_dues?select=academic_year_code`);
const years = [...new Set(allYears.map((r) => r.academic_year_code))].sort();
const current = years[years.length - 1];
console.log(`Years in the cache: ${years.join(", ")} · current (latest) = ${current}`);
console.log(`Live receipts for ${ay} in this ERP: ${receipts.length}`);
if (ay === current) throw new Error(`Refusing: ${ay} is the current year — its dues are rebuilt from receipts, not cleared.`);
if (receipts.length > 0) throw new Error(`Refusing: ${ay} has ${receipts.length} receipts here — its dues are not an artefact. Carry them forward instead.`);

type Row = { tenant_id: string; student_id: string; balance_paise: number };
const rows = await pageAll<Row>(`fee_desk_open_dues?academic_year_code=eq.${ay}&select=*`);
const bal = rows.reduce((s, r) => s + (r.balance_paise || 0), 0);
const students = new Set(rows.map((r) => r.student_id)).size;
const snap = resolve(process.cwd(), `.data/open-dues-${ay}-snapshot-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
try {
  writeFileSync(snap, JSON.stringify(rows));
  console.log(`Snapshot: ${rows.length} rows · ${students} students · ${inr(bal)} → ${snap}`);
} catch (e) {
  throw new Error(`Snapshot failed, nothing cleared: ${e instanceof Error ? e.message : String(e)}`);
}
if (!rows.length) {
  console.log("Nothing to clear.");
  process.exit(0);
}
if (!CLEAR) {
  console.log("\nDry run. Re-run with --clear (and ALLOW_LOCAL_PROD_WRITES=1) to remove these rows.");
  process.exit(0);
}
if (process.env.ALLOW_LOCAL_PROD_WRITES !== "1") throw new Error("Set ALLOW_LOCAL_PROD_WRITES=1 to write production.");

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question(`Type CLEAR ${ay} to delete ${rows.length} cache rows (${inr(bal)}) for ${students} students: `);
rl.close();
if (answer.trim() !== `CLEAR ${ay}`) {
  console.log("Aborted.");
  process.exit(1);
}
const r = await fetch(`${URL_}/rest/v1/rpc/fee_desk_replace_open_dues`, {
  method: "POST",
  headers: h,
  body: JSON.stringify({ p_tenant_id: rows[0]!.tenant_id, p_academic_year_code: ay, p_rows: [] }),
});
console.log(`rpc HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
const left = await pageAll<{ student_id: string }>(`fee_desk_open_dues?academic_year_code=eq.${ay}&select=student_id`);
console.log(`After: ${left.length} rows left for ${ay}.`);
