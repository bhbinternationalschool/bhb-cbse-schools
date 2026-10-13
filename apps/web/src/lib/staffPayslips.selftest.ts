/**
 * Self-test: the staff app's payslip list and payslip PDF pick the same run.
 * Run: npx tsx src/lib/staffPayslips.selftest.ts
 *
 * One payslip per month for the signed-in member of staff: paid beats
 * posted beats approved; drafts / pending runs are never shown, and a month
 * counts as "being prepared" only while it has no payslip at all. Someone
 * else's run never becomes my slip.
 */
import assert from "node:assert/strict";
import type { PayrollRun, PayrollRunStatus } from "./payroll";
import { bestPayslipRunsForStaff } from "./staffPayslips";

function run(id: string, month: string, status: PayrollRunStatus, staffIds: string[]): PayrollRun {
  return {
    id,
    month,
    status,
    academicYearCode: "2026-27",
    lines: staffIds.map((staffId) => ({ staffId })),
  } as unknown as PayrollRun;
}

const runs = [
  run("r1", "2026-08", "approved", ["s1", "s2"]),
  run("r2", "2026-08", "paid", ["s1"]),
  run("r3", "2026-08", "posted", ["s1"]),
  run("r4", "2026-09", "draft", ["s1"]),
  run("r5", "2026-10", "pending_approval", ["s1"]),
  run("r6", "2026-10", "posted", ["s1"]),
  run("r7", "2026-07", "paid", ["s2"]),
];

const mine = bestPayslipRunsForStaff(runs, "s1");
assert.equal(mine.best.get("2026-08")?.id, "r2", "paid wins over posted and approved");
assert.equal(mine.best.get("2026-10")?.id, "r6", "a posted run beats a pending one");
assert.equal(mine.best.has("2026-09"), false, "a draft month is never a payslip");
assert.equal(mine.best.has("2026-07"), false, "someone else's run is never my slip");
assert.equal(mine.preparing, 1, "only September (no slip at all) is being prepared");

const other = bestPayslipRunsForStaff(runs, "s2");
assert.equal(other.best.get("2026-08")?.id, "r1");
assert.equal(other.best.get("2026-07")?.id, "r7");
assert.equal(other.preparing, 0);

const nobody = bestPayslipRunsForStaff(runs, "");
assert.equal(nobody.best.size, 0, "no staff id, no payslips");

console.log("staffPayslips selftest: ok");
