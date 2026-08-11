/**
 * Run: npx tsx src/lib/collectionsAi.selftest.ts
 *
 * Exercises only paymentLikelihoodScore()/paymentLikelihood() — the pure
 * heuristic. The AI-drafted message/call-script path needs a live LLM
 * call (OpenAI/Gemini) so it's excluded here and verified live instead.
 */
import assert from "node:assert/strict";

import { paymentLikelihood, paymentLikelihoodScore } from "./collectionsAi";

console.log("collectionsAi.selftest.ts");

// --- scores are always clamped to [5, 95] — never a false certainty ------
{
  const veryOverdue = paymentLikelihoodScore({
    overdueDays: 400,
    overdueAmountPaise: 150_000_00,
  });
  assert.ok(veryOverdue >= 5, "score must never claim absolute zero chance");
  assert.equal(veryOverdue, 20, "days penalty (65) + amount penalty (15), floored well above the 5-clamp");

  const notYetDue = paymentLikelihoodScore({
    overdueDays: -30,
    overdueAmountPaise: 0,
  });
  assert.ok(notYetDue <= 95, "score must never claim absolute certainty");
  assert.equal(notYetDue, 95);
}

// --- more overdue days lowers the score, monotonically -------------------
{
  const d5 = paymentLikelihoodScore({ overdueDays: 5, overdueAmountPaise: 10_000_00 });
  const d20 = paymentLikelihoodScore({ overdueDays: 20, overdueAmountPaise: 10_000_00 });
  const d60 = paymentLikelihoodScore({ overdueDays: 60, overdueAmountPaise: 10_000_00 });
  assert.ok(d5 > d20, "5 days overdue must score higher than 20 days");
  assert.ok(d20 > d60, "20 days overdue must score higher than 60 days");
}

// --- a larger overdue amount lowers the score at the same overdue days ---
{
  const small = paymentLikelihoodScore({ overdueDays: 10, overdueAmountPaise: 5_000_00 });
  const large = paymentLikelihoodScore({ overdueDays: 10, overdueAmountPaise: 150_000_00 });
  assert.ok(small > large, "a bigger overdue amount must not score higher likelihood");
}

// --- an active installment plan raises the score (already engaging) ------
{
  const noPlan = paymentLikelihoodScore({ overdueDays: 25, overdueAmountPaise: 30_000_00 });
  const withPlan = paymentLikelihoodScore({
    overdueDays: 25,
    overdueAmountPaise: 30_000_00,
    planCode: "IP-2026-014",
  });
  assert.ok(withPlan > noPlan, "an active recovery plan must raise the score");
}

// --- label/tone buckets line up with the score thresholds ----------------
{
  assert.deepEqual(paymentLikelihood({ overdueDays: -5, overdueAmountPaise: 0 }), {
    score: 95,
    label: "Likely to pay soon",
    tone: "good",
  });
  const escalate = paymentLikelihood({ overdueDays: 90, overdueAmountPaise: 200_000_00 });
  assert.equal(escalate.tone, "danger");
  assert.equal(escalate.label, "High risk — escalate");
}

console.log("OK — collectionsAi.selftest.ts");
