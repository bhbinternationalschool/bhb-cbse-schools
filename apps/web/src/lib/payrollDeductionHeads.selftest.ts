/**
 * Payroll deductions land on the right heads (13 Oct 2026).
 *
 * payroll_ledger_post put loss of pay and "old advance" recoveries into 2300
 * Statutory Dues — a liability to the government that did not exist — four
 * runs in April/May 2026 (corrected by journal JV/FY2026-27/00119–00121 and
 * PY/FY2026-27/00681). The live definition is whichever migration defines
 * the function last; it must keep the per-line rules.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(__dirname, "../../../../supabase/migrations");
const definers = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .filter((f) => /create\s+or\s+replace\s+function\s+public\.payroll_ledger_post\s*\(/i.test(readFileSync(join(dir, f), "utf8")));
assert.ok(definers.length > 0, "some migration defines payroll_ledger_post");
const latest = definers[definers.length - 1]!;
const sql = readFileSync(join(dir, latest), "utf8");

// Loss of pay is decided per line: what was deducted as LWP, capped by attendance.
assert.ok(/least\(lc\.comp,\s*l\.lwp_deduction\)/.test(sql), `${latest}: LWP per line, capped by the attendance column`);
assert.ok(/headCode'\s*=\s*'LWP'/.test(sql), `${latest}: LWP read from the line's components`);
// A special deduction labelled as an advance is an advance recovered (1070).
const m = /special_deduction_label,\s*''\)\s*~\*\s*'([^']+)'/.exec(sql);
assert.ok(m, `${latest}: advance-labelled special deductions go to Staff Advances`);
// The label pattern (SQL regex, case-insensitive) — checked here with the
// same expression in JS so a loosened pattern fails this test.
const label = new RegExp(m![1]!.replace(/\\\\/g, "\\"), "i");
for (const ok of ["advance", "Old advance", "old  advance", "staff advance", "Salary Advance", "advance recovery", "old advance recovered", " advance deduction "]) {
  assert.ok(label.test(ok), `"${ok}" is an advance recovery`);
}
for (const no of ["advance tax", "no advance", "advance salary paid in July", "fine", "uniform", "TDS", "advances given"]) {
  assert.ok(!label.test(no), `"${no}" is not booked to Staff Advances`);
}
assert.ok(/v_adv\s*:=\s*v_adv\s*\+\s*v_adv_special/.test(sql), `${latest}: advance specials added to recoveries`);
assert.ok(/v_special\s*:=\s*v_special\s*-\s*v_adv_special/.test(sql), `${latest}: and taken out of Statutory Dues`);
// The payment leg from the wallet migration is still there.
assert.ok(sql.includes("payroll_line_wallet_paid"), `${latest}: wallet-paid lines still booked to 1110`);

console.log(`payrollDeductionHeads.selftest.ts: ok (${latest})`);
