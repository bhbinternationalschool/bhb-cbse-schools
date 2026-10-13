import type { PayrollRun, PayrollRunStatus } from "@/lib/payroll";

/** Statuses a member of staff may see their own payslip in. */
export const VISIBLE_PAYSLIP_STATUSES: ReadonlySet<PayrollRunStatus> = new Set([
  "approved",
  "posted",
  "paid",
]);

const rank = (st: PayrollRunStatus) =>
  st === "paid" ? 3 : st === "posted" ? 2 : st === "approved" ? 1 : 0;

/**
 * One payslip per month for one member of staff (13 Oct 2026): a month can
 * be paid in several runs, and a person may also sit on a draft of that
 * month — the paid run wins, then posted, then approved; a month counts as
 * "being prepared" only while it has no payslip at all.
 *
 * Shared by the payslip list (GET /api/v1/staff/payslips) and the payslip
 * PDF, so the PDF is always the same slip the list shows.
 */
export function bestPayslipRunsForStaff(
  runs: readonly PayrollRun[],
  staffId: string,
): { best: Map<string, PayrollRun>; preparing: number } {
  const best = new Map<string, PayrollRun>();
  const draftMonths = new Set<string>();
  if (!staffId) return { best, preparing: 0 };
  for (const run of runs) {
    if (!run.lines.some((l) => l.staffId === staffId)) continue;
    if (!VISIBLE_PAYSLIP_STATUSES.has(run.status)) {
      draftMonths.add(run.month);
      continue;
    }
    const have = best.get(run.month);
    if (!have || rank(run.status) > rank(have.status)) best.set(run.month, run);
  }
  const preparing = [...draftMonths].filter((m) => !best.has(m)).length;
  return { best, preparing };
}
