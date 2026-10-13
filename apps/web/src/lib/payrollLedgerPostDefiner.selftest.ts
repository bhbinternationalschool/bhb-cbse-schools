/**
 * The live payroll_ledger_post keeps recall, re-post and per-day payments
 * (14 Oct 2026). Static: reads the migration that defines the function last.
 * Run: npx tsx src/lib/payrollLedgerPostDefiner.selftest.ts
 *
 * What broke before it: a recalled run left its accrual live in the book
 * (July 2026, PR/FY2026-27/00002); re-posting a recalled run booked nothing
 * because ledger_post hands back the reversed voucher for the same source
 * id; and the payment leg was one voucher on the run's paid day, so staff
 * paid on different days were all booked on one.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

console.log("payrollLedgerPostDefiner.selftest.ts");

const dir = join(__dirname, "../../../../supabase/migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const definesLast = (fn: string) => {
  const re = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\s*\\(`, "i");
  const hits = files.filter((f) => re.test(readFileSync(join(dir, f), "utf8")));
  assert.ok(hits.length, `some migration defines ${fn}`);
  return hits[hits.length - 1]!;
};

const latest = definesLast("payroll_ledger_post");
assert.ok(latest >= "20261014120000", `payroll_ledger_post is defined last by ${latest}, older than the per-date-pay migration`);
const all = readFileSync(join(dir, latest), "utf8");
const m = /create\s+or\s+replace\s+function\s+public\.payroll_ledger_post\s*\([\s\S]*?\$function\$;/i.exec(all);
assert.ok(m, `${latest}: payroll_ledger_post body`);
const fn = m![0];

// Signature, definer rights and search path are unchanged.
assert.match(fn, /payroll_ledger_post\(p_tenant_id uuid, p_run_id text, p_actor text DEFAULT 'system'::text\)/);
assert.match(fn, /RETURNS jsonb/);
assert.match(fn, /SECURITY DEFINER/);
assert.match(fn, /SET search_path TO 'public'/);

// A recalled run waits for its next posting (lock version).
assert.match(fn, /payroll_ledger_recalls[\s\S]*lock_version\s*>=\s*coalesce\(v_run\.lock_version, 0\)/, "recall gate");
// The accrual: live voucher first, versioned source id after a reversal.
assert.match(fn, /payroll_ledger_slot\(p_tenant_id, 'payroll_run', p_run_id/, "accrual looks up the live voucher");
assert.match(fn, /p_run_id \|\| '#' \|\| \(v_slot\.versions \+ 1\)/, "accrual re-posts as run#n");
assert.ok(!/'source_id',\s*p_run_id\b/.test(fn), "nothing posts under the bare run id without the slot check");
// Payments: per day and money account, regrouped, wallet first.
assert.match(fn, /':pay:'/, "payment groups keyed run:pay:date:account");
assert.match(fn, /coalesce\(l\.paid_on, v_default_paid\)/, "each line's own paid day");
assert.match(fn, /payroll_line_wallet_paid/, "wallet-paid lines → 1110");
assert.match(fn, /'1110'/);
assert.match(fn, /Salary payments regrouped:/, "a changed group is reversed and re-posted");
assert.match(fn, /ledger_reverse\(p_tenant_id, v_stale\.id/, "an emptied group is reversed");
// Paid the old way or corrected by hand (April 2026): left alone.
assert.match(fn, /'payroll_payment_correction'/);
assert.match(fn, /v_legacy_n > 0/);
// Accrual arithmetic from 20261013200000 is still there.
assert.match(fn, /least\(lc\.comp,\s*l\.lwp_deduction\)/);
assert.match(fn, /v_adv\s*:=\s*v_adv\s*\+\s*v_adv_special/);

// The slot: a hand reversal on a posted/paid run is never re-posted.
const slotFile = readFileSync(join(dir, definesLast("payroll_ledger_slot")), "utf8");
assert.match(slotFile, /like 'Salary payments regrouped:%'/);
assert.match(slotFile, /c\.created_at >= v_rev_at and c\.lock_version < p_lock/);

// The recall: all-or-nothing reversal, service role only, paid runs refused.
const recallFile = definesLast("payroll_ledger_recall");
const recall = readFileSync(join(dir, recallFile), "utf8");
assert.match(recall, /for update/, "the run row is locked while its book is reversed");
assert.match(recall, /= 'paid' then[\s\S]*cannot go back to draft/);
assert.match(recall, /raise exception 'The book refused to reverse/, "a refused reversal undoes the whole recall");
assert.match(recall, /insert into public\.payroll_ledger_recalls/);
assert.match(recall, /revoke all on function public\.payroll_ledger_recall\(uuid, text, text, text\) from public, anon, authenticated/);
assert.match(recall, /grant execute on function public\.payroll_ledger_recall\(uuid, text, text, text\) to service_role/);
assert.match(recall, /grant select, insert on public\.payroll_ledger_recalls to service_role/);
assert.match(recall, /add column if not exists paid_on date/);

console.log(`  ok (${latest})`);
