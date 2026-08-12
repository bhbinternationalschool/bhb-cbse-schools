/**
 * EPF/ESIC compliance calc: wage-ceiling based EPS/EDLI split, due dates, and
 * estimated late-payment penalty. Kept separate from salarySetup.ts (payroll
 * calc) and statutoryRemit.ts (batch/deposit tracking) so each stays focused.
 *
 * Penalty numbers here are always ESTIMATES — EPFO/ESIC levy the real amount,
 * and their rates change by circular. Callers must present these as
 * "Estimated penalty", never as a final figure.
 */

import type { StatutoryEstablishmentConfig, StatutoryPenaltySlab } from "@/lib/foundationMasters";

/**
 * Splits an already-computed employer PF contribution (flat 12%/13% of basic,
 * as salarySetup.ts already produces) into the EPS/EPF-proper reporting split
 * EPFO's ECR expects, plus the separate EDLI employer contribution.
 *
 * epsAmount + epfEmployerAmount always reconciles to pfEmployerTotal exactly —
 * this is a reporting breakdown of money already withheld, not a recompute,
 * so it can never drift from what payroll actually deducted. EDLI is a
 * genuinely separate, additional employer-only contribution (not carved out
 * of the 12%), so it's returned alongside rather than subtracted.
 */
export function splitEmployerPfContribution(
  basicWages: number,
  pfEmployerTotal: number,
  config: Pick<StatutoryEstablishmentConfig, "applyEpfWageCeiling" | "epfWageCeiling">,
): {
  epfWages: number;
  epsWages: number;
  edliWages: number;
  epsAmount: number;
  epfEmployerAmount: number;
  edliAmount: number;
} {
  const basic = Math.max(0, basicWages || 0);
  const ceiling = config.epfWageCeiling || 15000;
  const epfWages = config.applyEpfWageCeiling ? Math.min(basic, ceiling) : basic;
  // EPS and EDLI wage ceilings apply regardless of whether the employer
  // voluntarily contributes on higher wages for the EPF-proper share.
  const epsWages = Math.min(basic, ceiling);
  const edliWages = Math.min(basic, ceiling);
  const epsAmount = Math.min(
    Math.round((epsWages * 8.33) / 100),
    Math.max(0, pfEmployerTotal || 0),
  );
  const epfEmployerAmount = Math.max(0, (pfEmployerTotal || 0) - epsAmount);
  const edliAmount = Math.round((edliWages * 0.5) / 100);
  return { epfWages, epsWages, edliWages, epsAmount, epfEmployerAmount, edliAmount };
}

/** EPF ECR and ESIC contributions are both due on the 15th of the following month. */
export function statutoryDueDate(month: string): Date {
  const [yearStr, monthStr] = (month || "").split("-");
  const year = Number(yearStr);
  const mo = Number(monthStr); // 1-12; used directly as next month's 0-indexed JS month
  if (!year || !mo) return new Date(NaN);
  return new Date(year, mo, 15, 12, 0, 0);
}

export function daysOverdueFor(dueDate: Date, today: Date = new Date()): number {
  if (Number.isNaN(dueDate.getTime())) return 0;
  const diffMs = today.getTime() - dueDate.getTime();
  return Math.max(0, Math.floor(diffMs / 86400000));
}

export type EstimatedPenalty = {
  daysOverdue: number;
  estimatedInterest: number;
  estimatedDamages: number;
  estimatedTotal: number;
};

const ZERO_PENALTY: EstimatedPenalty = {
  daysOverdue: 0,
  estimatedInterest: 0,
  estimatedDamages: 0,
  estimatedTotal: 0,
};

/** Simple daily-accrued estimate: interest (7Q-style) + slab-based damages, both per annum rates prorated by days overdue. */
export function computeEstimatedPenalty(
  dueDate: Date,
  today: Date,
  amountDue: number,
  slabs: StatutoryPenaltySlab[],
  interestRatePctPerAnnum: number,
): EstimatedPenalty {
  const overdue = daysOverdueFor(dueDate, today);
  if (overdue <= 0 || !amountDue || amountDue <= 0) return ZERO_PENALTY;
  const interest = amountDue * (interestRatePctPerAnnum / 100) * (overdue / 365);
  const slab =
    slabs.find((s) => overdue <= s.maxDelayDays) ?? slabs[slabs.length - 1];
  const damages = slab
    ? amountDue * (slab.ratePctPerAnnum / 100) * (overdue / 365)
    : 0;
  return {
    daysOverdue: overdue,
    estimatedInterest: Math.round(interest),
    estimatedDamages: Math.round(damages),
    estimatedTotal: Math.round(interest + damages),
  };
}

/** One outstanding EPF or ESIC filing/payment, decoupled from StatutoryRemitBatch's exact shape. */
export type StatutoryDue = {
  batchId: string;
  kind: "epf" | "esic";
  month: string;
  href: string;
  amountDue: number;
  /** "" = not yet paid */
  paidAt: string;
};

export type StatutoryAlert = {
  id: string;
  kind: "epf" | "esic";
  text: string;
  href: string;
  estimatedPenalty: number;
  daysOverdue: number;
};

export function listOverdueStatutoryAlerts(
  dues: StatutoryDue[],
  config: StatutoryEstablishmentConfig,
  today: Date = new Date(),
): StatutoryAlert[] {
  const alerts: StatutoryAlert[] = [];
  for (const due of dues) {
    if (due.paidAt || !due.amountDue || due.amountDue <= 0) continue;
    const dueDate = statutoryDueDate(due.month);
    const slabs =
      due.kind === "epf" ? config.penalty.damageSlabs : config.penalty.esicDamageSlabs;
    const interestRate =
      due.kind === "epf"
        ? config.penalty.interestRatePctPerAnnum
        : config.penalty.esicInterestRatePctPerAnnum;
    const penalty = computeEstimatedPenalty(
      dueDate,
      today,
      due.amountDue,
      slabs,
      interestRate,
    );
    if (penalty.daysOverdue <= 0) continue;
    const label = due.kind === "epf" ? "EPF" : "ESIC";
    alerts.push({
      id: `${due.kind}_${due.batchId}`,
      kind: due.kind,
      text: `${label} return for ${due.month} is ${penalty.daysOverdue} day(s) overdue — est. penalty ₹${penalty.estimatedTotal.toLocaleString("en-IN")}, rising daily. Submit as soon as possible.`,
      href: due.href,
      estimatedPenalty: penalty.estimatedTotal,
      daysOverdue: penalty.daysOverdue,
    });
  }
  return alerts.sort((a, b) => b.estimatedPenalty - a.estimatedPenalty);
}
