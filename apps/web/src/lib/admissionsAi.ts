/**
 * Admissions AI helpers — conversion-likelihood scoring (heuristic, pure) and
 * inputs for the AI-suggested next-best-action API. See lib/aiLlm.server.ts
 * for the LLM call itself.
 */
import {
  leadFollowUpBucket,
  type AdmissionLead,
  type FollowUpOutcome,
} from "@/lib/admissions";

export type LeadConversionTone = "good" | "warn" | "danger";

export type LeadConversionLikelihood = {
  /** 0-100. Clamped away from the extremes — a heuristic score is never a
   * certainty, so it must never claim 0% or 100%. */
  score: number;
  label: string;
  tone: LeadConversionTone;
};

const STAGE_BONUS: Record<AdmissionLead["stage"], number> = {
  enquiry: 0,
  applied: 15,
  verified: 35,
  enrolled: 0,
  lost: 0,
};

const OUTCOME_ADJUST: Partial<Record<FollowUpOutcome, number>> = {
  interested: 15,
  visit_scheduled: 20,
  connected: 5,
  callback: 5,
  no_answer: -5,
  busy: -5,
  not_interested: -40,
  wrong_number: -45,
};

/**
 * Heuristic conversion-likelihood score from signals already on the lead
 * (stage, registration payment, latest follow-up outcome, document
 * completeness, sibling-in-school, overdue follow-up). No LLM call — runs
 * over the whole leads list instantly.
 */
export function leadConversionScore(lead: AdmissionLead): number {
  if (lead.stage === "lost") return 5;

  let score = 40 + (STAGE_BONUS[lead.stage] ?? 0);

  if (lead.registrationFeePaid || lead.registrationPaymentStatus === "paid") {
    score += 20;
  } else if (lead.registrationPaymentStatus === "partial") {
    score += 10;
  }

  const latest = lead.followUps[lead.followUps.length - 1];
  if (latest) {
    score += OUTCOME_ADJUST[latest.outcome] ?? 0;
  }

  const docsCount = [
    lead.docsBirthCert,
    lead.docsPhoto,
    lead.docsAadhaar,
    lead.docsTc,
    lead.docsCategory,
  ].filter(Boolean).length;
  score += docsCount * 2;

  if (lead.siblingInSchool) score += 10;

  if (leadFollowUpBucket(lead) === "overdue") score -= 10;

  return Math.round(Math.max(5, Math.min(95, score)));
}

export function leadConversionLikelihood(
  lead: AdmissionLead,
): LeadConversionLikelihood {
  const score = leadConversionScore(lead);
  if (score >= 65) {
    return { score, label: "Likely to convert", tone: "good" };
  }
  if (score >= 35) {
    return { score, label: "Uncertain — needs follow-up", tone: "warn" };
  }
  return { score, label: "At risk — re-engage or close", tone: "danger" };
}
