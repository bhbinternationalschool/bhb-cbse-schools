/**
 * Payroll follows Masters → Salary setup (director, 14 Oct 2026: "Shreya and
 * many staff are not on PF/ESIC, but the system built everyone on PF & ESIC;
 * each staff's actual position is in Masters → staff salary setup").
 *
 * What went wrong in the July 2026 draft (built 19 Aug): four staff had no
 * salary setup link yet, and `link?.statutoryCover || "both"` put them on PF
 * and ESIC; nothing prorated from the joining date, and a day with no
 * register was then counted present — so Shreya Sharma and Nihal Rajak
 * (joined 22 Jul) were paid a full month with PF/ESI, and Sanjay Pratap
 * (joined 1 Aug) was paid for July at all.
 *
 * Pure: no storage.
 */

import type { StatutoryCover } from "@/lib/salarySetup";

export const NO_SETUP_NOTE = "No salary setup — PF/ESI not applied; set it up in Masters → Salary setup";

/**
 * Statutory cover for a staff member. No setup link means no decision has
 * been made: never PF + ESIC by default — "none", and flagged.
 */
export function statutoryCoverFor(
  link: { statutoryCover?: StatutoryCover | string | null } | null | undefined,
): { cover: StatutoryCover; noSetup: boolean } {
  if (!link) return { cover: "none", noSetup: true };
  const c = link.statutoryCover;
  if (c === "both" || c === "pf_only" || c === "esic_only" || c === "none") return { cover: c, noSetup: false };
  return { cover: "none", noSetup: false };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}

/**
 * The first day of the month this person is paid for, and whether they
 * belong in the month at all.
 *
 * The joining date decides. The salary setup's effectiveFrom is used only
 * when there is no joining date: increments move effectiveFrom forward for
 * people who have worked here for years (salaryIncrement applyIncrementBatch),
 * so an effectiveFrom after the month never means "not employed then".
 */
export function payrollEmploymentStart(
  month: string,
  joiningDate: string | null | undefined,
  effectiveFrom?: string | null,
): { from: string; excluded: boolean; joinedInMonth: boolean } {
  const start = `${month}-01`;
  const end = monthEnd(month);
  const join = ISO.test(String(joiningDate || "")) ? String(joiningDate) : "";
  const eff = ISO.test(String(effectiveFrom || "")) ? String(effectiveFrom) : "";
  const basis = join || eff;
  if (!basis) return { from: start, excluded: false, joinedInMonth: false };
  if (basis > end) return { from: basis, excluded: true, joinedInMonth: false };
  return basis > start
    ? { from: basis, excluded: false, joinedInMonth: true }
    : { from: start, excluded: false, joinedInMonth: false };
}

export type SetupSyncFigures = {
  gross: number;
  totalDeductions: number;
  netPay: number;
  employerCost: number;
  daysPresent: number;
  daysAbsent: number;
  daysHoliday: number;
  daysLwp: number;
  statutoryCover: string;
  structureId: string;
};

export type SetupSyncRow = {
  staffId: string;
  fullName: string;
  empCode: string;
  /** rebuild = recompute from setup; remove = not in this month; none = in step. */
  action: "rebuild" | "remove" | "none";
  reasons: string[];
  noSetup: boolean;
  before: SetupSyncFigures;
  after: SetupSyncFigures | null;
};

export function figuresOf(l: SetupSyncFigures): SetupSyncFigures {
  return {
    gross: l.gross,
    totalDeductions: l.totalDeductions,
    netPay: l.netPay,
    employerCost: l.employerCost,
    daysPresent: l.daysPresent,
    daysAbsent: l.daysAbsent,
    daysHoliday: l.daysHoliday,
    daysLwp: l.daysLwp,
    statutoryCover: l.statutoryCover,
    structureId: l.structureId,
  };
}

/**
 * Why a draft line differs from what salary setup, attendance and the
 * joining date give today (fresh = the line rebuilt now with the line's own
 * adjustments kept; null = the person does not belong in the month).
 */
export function setupDiffReasons(
  before: SetupSyncFigures,
  fresh: SetupSyncFigures | null,
  why: { excludedReason?: string; noSetup?: boolean } = {},
): string[] {
  if (!fresh) return [why.excludedReason || "Not in this month"];
  const out: string[] = [];
  if (why.noSetup) out.push("No salary setup");
  if (before.statutoryCover !== fresh.statutoryCover) out.push(`PF/ESI cover ${before.statutoryCover} → ${fresh.statutoryCover}`);
  if (before.structureId !== fresh.structureId) out.push("Salary structure changed");
  if (before.gross !== fresh.gross) out.push(`Gross ${before.gross} → ${fresh.gross}`);
  if (
    before.daysPresent !== fresh.daysPresent ||
    before.daysAbsent !== fresh.daysAbsent ||
    before.daysHoliday !== fresh.daysHoliday ||
    before.daysLwp !== fresh.daysLwp
  ) {
    out.push(`Days ${before.daysPresent}/${before.daysAbsent}/${before.daysLwp} → ${fresh.daysPresent}/${fresh.daysAbsent}/${fresh.daysLwp} (P/A/LWP)`);
  }
  if (before.totalDeductions !== fresh.totalDeductions) out.push(`Deductions ${before.totalDeductions} → ${fresh.totalDeductions}`);
  if (before.employerCost !== fresh.employerCost) out.push(`Employer cost ${before.employerCost} → ${fresh.employerCost}`);
  if (before.netPay !== fresh.netPay && !out.length) out.push(`Net ${before.netPay} → ${fresh.netPay}`);
  return out;
}

/** Run totals before and after applying the chosen rows. */
export function setupSyncTotals(rows: SetupSyncRow[], all: SetupSyncFigures[]): {
  before: { net: number; employer: number; gross: number };
  after: { net: number; employer: number; gross: number };
} {
  const sum = (xs: SetupSyncFigures[]) => ({
    net: xs.reduce((n, x) => n + x.netPay, 0),
    employer: xs.reduce((n, x) => n + x.employerCost, 0),
    gross: xs.reduce((n, x) => n + x.gross, 0),
  });
  const before = sum(all);
  const delta = { net: 0, employer: 0, gross: 0 };
  for (const r of rows) {
    if (r.action === "none") continue;
    const a = r.after ?? { netPay: 0, employerCost: 0, gross: 0 };
    delta.net += a.netPay - r.before.netPay;
    delta.employer += a.employerCost - r.before.employerCost;
    delta.gross += a.gross - r.before.gross;
  }
  return {
    before,
    after: { net: before.net + delta.net, employer: before.employer + delta.employer, gross: before.gross + delta.gross },
  };
}
