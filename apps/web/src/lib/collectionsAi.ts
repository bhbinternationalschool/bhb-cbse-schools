/**
 * Fee-collections AI helpers — payment-likelihood scoring (heuristic, pure,
 * runs over the whole defaulters ledger client-side) and inputs for the
 * AI-drafted message/call-script API. See lib/aiLlm.server.ts for the LLM
 * call itself.
 */

export type PaymentLikelihoodTone = "good" | "warn" | "danger";

export type PaymentLikelihood = {
  /** 0-100. Clamped away from the extremes — a heuristic score is never a
   * certainty, so it must never claim 0% or 100%. */
  score: number;
  label: string;
  tone: PaymentLikelihoodTone;
};

/**
 * Heuristic payment-likelihood score from signals already on the live
 * defaulters ledger (overdue days, overdue amount, an active recovery
 * plan). No payment-history lookup — deliberately self-contained so it can
 * run over a full list instantly with no extra data fetch.
 */
export function paymentLikelihoodScore(row: {
  overdueDays: number;
  overdueAmountPaise: number;
  planCode?: string | null;
}): number {
  let score = 100;

  if (row.overdueDays > 0) {
    score -= Math.min(65, row.overdueDays * 1.3);
  } else if (row.overdueDays < 0) {
    // Not yet due — still very likely to pay on time.
    score += 5;
  }

  const rupees = row.overdueAmountPaise / 100;
  if (rupees > 100000) score -= 15;
  else if (rupees > 50000) score -= 8;
  else if (rupees > 20000) score -= 3;

  if (row.planCode) score += 15;

  return Math.round(Math.max(5, Math.min(95, score)));
}

export function paymentLikelihood(row: {
  overdueDays: number;
  overdueAmountPaise: number;
  planCode?: string | null;
}): PaymentLikelihood {
  const score = paymentLikelihoodScore(row);
  if (score >= 65) {
    return { score, label: "Likely to pay soon", tone: "good" };
  }
  if (score >= 35) {
    return { score, label: "Uncertain — needs follow-up", tone: "warn" };
  }
  return { score, label: "High risk — escalate", tone: "danger" };
}

/** Count of defaulters whose payment likelihood is "danger" tone — the
 * dashboard anomaly count, kept alongside the scoring logic it depends on. */
export function countAtRiskDefaulters(
  rows: { overdueDays: number; overdueAmountPaise: number; planCode?: string | null }[],
): number {
  return rows.reduce(
    (n, row) => n + (paymentLikelihood(row).tone === "danger" ? 1 : 0),
    0,
  );
}
