/**
 * Run: npx tsx src/lib/waUsageCost.selftest.ts
 *
 * This module turns the school's message log into a rupee figure the
 * director will read as their WhatsApp bill. Every assertion below exists
 * because getting it wrong quietly overstates or understates real money.
 */
import assert from "node:assert/strict";
import {
  DEFAULT_WA_RATES,
  billCategoryLabel,
  istDayKey,
  normalizeWaRates,
  projectedMonthlyPaise,
  rateFor,
  rateRupees,
  ratesAreDefaults,
  repriceWaUsage,
  rupees,
  summariseAiUsage,
  summariseWaUsage,
  type WaUsageMessage,
} from "./waUsageCost";

console.log("waUsageCost.selftest.ts");

const rates = { ...DEFAULT_WA_RATES, marketing: 80, utility: 10, authentication: 12 };

function msg(p: Partial<WaUsageMessage>): WaUsageMessage {
  return {
    at: "2026-09-09T06:00:00.000Z",
    category: "utility",
    templateName: "bhb_fee_stage_reminder",
    purpose: "fees",
    outcome: "delivered",
    ...p,
  };
}

// --- only delivered messages are charged ---------------------------------
{
  const s = summariseWaUsage(
    [
      msg({ outcome: "delivered" }),
      msg({ outcome: "failed" }),
      msg({ outcome: "pending" }),
    ],
    rates,
  );
  assert.equal(s.templateSent, 3);
  assert.equal(s.templateDelivered, 1);
  assert.equal(s.templateFailed, 1);
  assert.equal(s.templatePending, 1);
  assert.equal(s.messageCostPaise, 10, "one delivered utility message = 10 paise");
  assert.equal(
    s.pendingCostPaise,
    10,
    "the undelivered one is quoted separately, never folded into the bill",
  );
  assert.equal(
    s.totalPaise,
    10,
    "a failed template costs the school nothing — counting sends would overstate the invoice",
  );
}

// --- an unknown template is priced at the DEAREST rate, never the cheapest -
{
  const s = summariseWaUsage([msg({ category: "unknown", templateName: "who_is_this" })], rates);
  assert.equal(s.messageCostPaise, 80);
  assert.equal(
    rateFor(rates, "unknown"),
    rates.marketing,
    "an estimate that flatters the school is the one contradicted by the invoice",
  );
}

// --- service messages are free today, and countable anyway ---------------
{
  const s = summariseWaUsage(
    [msg({ category: "service", templateName: "", outcome: "delivered" })],
    rates,
  );
  assert.equal(s.serviceSent, 1);
  assert.equal(s.templateSent, 0, "a free-form reply is not a template send");
  assert.equal(s.messageCostPaise, 0);
  assert.equal(s.templates.length, 0, "free-form replies have no template row to show");
}

// --- categories are priced apart, not lumped -----------------------------
{
  const s = summariseWaUsage(
    [
      msg({ category: "marketing", templateName: "study_help_intro" }),
      msg({ category: "utility" }),
      msg({ category: "authentication", templateName: "bhb_otp" }),
    ],
    rates,
  );
  assert.equal(s.messageCostPaise, 80 + 10 + 12);
  const marketing = s.buckets.find((b) => b.category === "marketing");
  assert.equal(marketing?.costPaise, 80);
  assert.equal(
    s.buckets.length,
    3,
    "a category nobody used must not show as a zero row",
  );
}

// --- the day series is the school's day, not UTC's -----------------------
{
  // 19:30 UTC on the 9th is 01:00 IST on the 10th — a message the office
  // will look for under the 10th.
  assert.equal(istDayKey("2026-09-09T19:30:00.000Z"), "2026-09-10");
  assert.equal(istDayKey("2026-09-09T18:29:00.000Z"), "2026-09-09");
  assert.equal(istDayKey("nonsense"), "");
  const s = summariseWaUsage(
    [
      msg({ at: "2026-09-09T19:30:00.000Z" }),
      msg({ at: "2026-09-09T05:00:00.000Z" }),
      msg({ at: "2026-09-09T05:10:00.000Z", outcome: "failed" }),
    ],
    rates,
  );
  assert.deepEqual(
    s.days.map((d) => [d.day, d.delivered, d.failed, d.costPaise]),
    [
      ["2026-09-09", 1, 1, 10],
      ["2026-09-10", 1, 0, 10],
    ],
  );
  assert.deepEqual(s.days[0].deliveredByCategory, { utility: 1 });
}

// --- re-pricing a window matches counting it again from scratch ----------
{
  // The rate-card editor re-prices what is already on screen rather than
  // re-reading the log. If that ever drifts from the real thing, the office
  // saves a rate and the number jumps — so this pins them together.
  const messages: WaUsageMessage[] = [
    msg({ category: "marketing", templateName: "a", at: "2026-09-08T05:00:00.000Z" }),
    msg({ category: "utility", templateName: "b" }),
    msg({ category: "utility", templateName: "b", outcome: "pending" }),
    msg({ category: "utility", templateName: "b", outcome: "failed" }),
    msg({ category: "unknown", templateName: "c", at: "2026-09-09T19:00:00.000Z" }),
    msg({ category: "service", templateName: "" }),
  ];
  const ai = summariseAiUsage(
    [
      { at: "2026-09-09T06:00:00.000Z", model: "m1", promptTokens: 1500, completionTokens: 500 },
      { at: "2026-09-09T06:00:00.000Z", model: "m2", promptTokens: 400, completionTokens: 100 },
    ],
    rates,
  );
  const cheap = { ...rates, marketing: 40, utility: 5, authentication: 6, service: 1, aiInputPerKTok: 3, aiOutputPerKTok: 7 };
  const fresh = summariseWaUsage(messages, cheap, summariseAiUsage(
    [
      { at: "2026-09-09T06:00:00.000Z", model: "m1", promptTokens: 1500, completionTokens: 500 },
      { at: "2026-09-09T06:00:00.000Z", model: "m2", promptTokens: 400, completionTokens: 100 },
    ],
    cheap,
  ));
  const repriced = repriceWaUsage(summariseWaUsage(messages, rates, ai), cheap);

  assert.equal(repriced.totalPaise, fresh.totalPaise);
  assert.equal(repriced.messageCostPaise, fresh.messageCostPaise);
  assert.equal(repriced.pendingCostPaise, fresh.pendingCostPaise);
  assert.equal(repriced.ai.costPaise, fresh.ai.costPaise);
  assert.deepEqual(
    repriced.days.map((d) => [d.day, d.costPaise]),
    fresh.days.map((d) => [d.day, d.costPaise]),
  );
  assert.deepEqual(
    repriced.templates.map((t) => [t.templateName, t.costPaise]),
    fresh.templates.map((t) => [t.templateName, t.costPaise]),
  );
  assert.deepEqual(
    repriced.buckets.map((b) => [b.category, b.sent, b.costPaise, b.ratePaise]),
    fresh.buckets.map((b) => [b.category, b.sent, b.costPaise, b.ratePaise]),
  );
  // Counts are untouched by a price change — only the money moves.
  assert.equal(repriced.templateDelivered, fresh.templateDelivered);
  assert.equal(repriced.serviceSent, fresh.serviceSent);
}

// --- template rows rank by money, so the costly one is on top ------------
{
  const s = summariseWaUsage(
    [
      msg({ category: "utility", templateName: "cheap" }),
      msg({ category: "utility", templateName: "cheap" }),
      msg({ category: "marketing", templateName: "dear" }),
    ],
    rates,
  );
  assert.equal(s.templates[0].templateName, "dear");
  assert.equal(s.templates[0].costPaise, 80);
  assert.equal(s.templates[1].costPaise, 20);
}

// --- rates: a bad value falls back, it never becomes zero ----------------
{
  const r = normalizeWaRates({ marketing: "abc", utility: -3, authentication: null });
  assert.equal(r.marketing, DEFAULT_WA_RATES.marketing);
  assert.equal(r.utility, DEFAULT_WA_RATES.utility, "a negative rate is not a discount");
  assert.equal(r.authentication, DEFAULT_WA_RATES.authentication);
  // A typed rate is honoured exactly, decimals and all — a utility message
  // rounded from 11.46 to 11 paise is a 4% error on the biggest category.
  assert.equal(normalizeWaRates({ utility: 11.46 }).utility, 11.46);
  assert.equal(normalizeWaRates({ service: 0 }).service, 0, "free must stay free");
  assert.equal(normalizeWaRates({ marketing: 99_999 }).marketing, 10_000, "stray zero");
  assert.equal(normalizeWaRates(null).marketing, DEFAULT_WA_RATES.marketing);
}

// --- the office is nagged until it confirms against its own invoice ------
{
  assert.equal(ratesAreDefaults(DEFAULT_WA_RATES), true);
  assert.equal(
    ratesAreDefaults(normalizeWaRates({ updatedAt: "2026-09-10T00:00:00.000Z" })),
    false,
  );
}

// --- study-help AI, per model -------------------------------------------
{
  const ai = summariseAiUsage(
    [
      { at: "2026-09-09T06:00:00.000Z", model: "gemini-3.6-flash", promptTokens: 1000, completionTokens: 1000 },
      { at: "2026-09-09T06:00:00.000Z", model: "gpt-4o-mini", promptTokens: 2000, completionTokens: 0 },
    ],
    { ...rates, aiInputPerKTok: 2, aiOutputPerKTok: 10 },
  );
  assert.equal(ai.calls, 2);
  assert.equal(ai.promptTokens, 3000);
  assert.equal(ai.costPaise, 2 + 10 + 4);
  assert.equal(ai.byModel[0].model, "gemini-3.6-flash", "dearest model first");
  assert.equal(ai.byModel[1].costPaise, 4);
}

// --- AI cost lands in the total the director reads -----------------------
{
  const ai = summariseAiUsage(
    [{ at: "2026-09-09T06:00:00.000Z", model: "m", promptTokens: 1000, completionTokens: 0 }],
    { ...rates, aiInputPerKTok: 50, aiOutputPerKTok: 0 },
  );
  const s = summariseWaUsage([msg({})], rates, ai);
  assert.equal(s.ai.costPaise, 50);
  assert.equal(s.totalPaise, 60, "messages plus the AI behind them");
}

// --- an empty window is ₹0, not a crash ----------------------------------
{
  const s = summariseWaUsage([], rates);
  assert.equal(s.totalPaise, 0);
  assert.deepEqual(s.buckets, []);
  assert.deepEqual(s.days, []);
}

// --- what the office actually reads --------------------------------------
{
  assert.equal(rupees(12_346), "₹123.46");
  assert.equal(rupees(0), "₹0.00");
  assert.equal(rateRupees(11.46), "0.1146", "a rate needs four decimals, not two");
  assert.equal(projectedMonthlyPaise(700, 7), 3000, "₹7 a week is ₹30 a month");
  assert.equal(projectedMonthlyPaise(700, 0), 0, "no window, no projection");
  assert.equal(billCategoryLabel("unknown"), "Not in the template list");
}

console.log("  ok");
