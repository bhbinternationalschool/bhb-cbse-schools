/**
 * Ask the ERP — question detection, periods, the plan parser, the keyword
 * planner, renderers and the number guard.
 * Run: npx tsx src/lib/erpAsk.selftest.ts
 */
import assert from "node:assert/strict";
import {
  deterministicPlan,
  detectAskPeriod,
  looksLikeQuestion,
  namesPeriodBeyondDay,
  numberTokens,
  parseErpAskAnswerJson,
  parseErpAskPlanJson,
  previousRange,
  renderAgeingFacts,
  renderCollectionsFacts,
  resolvePeriodRange,
} from "./erpAsk";
import { parseErpCommandLocal } from "./erpCommands";

console.log("erpAsk.selftest.ts");

/* ── what counts as a question ─────────────────────────────────── */
for (const q of ["how much fee collected this week?", "kitne bachche 90 din se baaki hain", "class 5 me kitne students", "कितना पैसा आया", "who owes over 90 days", "fees collected this week", "dues over 90 days", "class 5A strength", "concession list"]) {
  assert.ok(looksLikeQuestion(q), `question: ${q}`);
}
for (const q of ["ok", "bus 2 abhi tak nahi aayi, driver ko phone karo", "Good morning all", "collection counter band karo", "students ko ground me le jao"]) {
  assert.ok(!looksLikeQuestion(q), `not a question: ${q}`);
}

/* ── periods ───────────────────────────────────────────────────── */
assert.equal(detectAskPeriod("fee collected this week"), "this_week");
assert.equal(detectAskPeriod("is hafte kitna aaya"), "this_week");
assert.equal(detectAskPeriod("pichle hafte ka collection"), "last_week");
assert.equal(detectAskPeriod("पिछले महीने कितना आया"), "last_month");
assert.equal(detectAskPeriod("this month collection"), "this_month");
assert.equal(detectAskPeriod("session me ab tak kitna aaya"), "session");
assert.equal(detectAskPeriod("kal kitna aaya"), "yesterday");
assert.equal(detectAskPeriod("aaj ka collection"), "today");
assert.equal(detectAskPeriod("collection"), null);
assert.ok(namesPeriodBeyondDay("collected this week"));
assert.ok(!namesPeriodBeyondDay("collected today"));

// 2026-09-09 is a Wednesday.
assert.deepEqual(resolvePeriodRange("this_week", "2026-09-09"), { from: "2026-09-07", to: "2026-09-09", label: "this week (from Monday)" });
assert.deepEqual(resolvePeriodRange("last_week", "2026-09-09"), { from: "2026-08-31", to: "2026-09-06", label: "last week" });
assert.deepEqual(resolvePeriodRange("last_month", "2026-09-09"), { from: "2026-08-01", to: "2026-08-31", label: "last month" });
assert.deepEqual(resolvePeriodRange("this_month", "2026-09-09"), { from: "2026-09-01", to: "2026-09-09", label: "this month" });
assert.deepEqual(resolvePeriodRange("this_week", "2026-09-07"), { from: "2026-09-07", to: "2026-09-07", label: "this week (from Monday)" }, "a Monday's week is just Monday");
assert.deepEqual(previousRange({ from: "2026-09-07", to: "2026-09-09", label: "x" }), { from: "2026-09-04", to: "2026-09-06", label: "the period before" }, "same length, ending the day before");
assert.equal(previousRange(resolvePeriodRange("session", "2026-09-09")), null);

/* ── the day command no longer swallows a week ─────────────────── */
assert.equal(parseErpCommandLocal("how much fee collected today")?.commandId, "collection_today");
assert.equal(parseErpCommandLocal("how much fee collected this week"), null, "a week is a question for the answering layer");
assert.equal(parseErpCommandLocal("pichle mahine ka collection"), null);

/* ── plan parser ───────────────────────────────────────────────── */
{
  const p = parseErpAskPlanJson('```json\n{"tools":[{"id":"collections","period":"this_week"},{"id":"dues_ageing","band":"over90","limit":99},{"id":"nope"},{"id":"collections"}],"language":"hinglish","outOfScope":false,"confidence":0.92}\n```');
  assert.ok(p);
  assert.equal(p.tools.length, 2, "unknown id dropped, duplicate dropped");
  assert.equal(p.tools[1]!.limit, 25, "limit clamped");
  assert.equal(p.language, "hinglish");
  assert.equal(p.confidence, 0.92);
  const bad = parseErpAskPlanJson('{"tools":[{"id":"collections","period":"next_year","band":"whatever"}],"language":"xx"}');
  assert.ok(bad);
  assert.equal(bad.tools[0]!.period, undefined, "an unknown period is dropped, not guessed");
  assert.equal(bad.language, "en");
  assert.equal(parseErpAskPlanJson("nope"), null);
}

/* ── keyword planner ───────────────────────────────────────────── */
{
  const a = deterministicPlan("how much fee collected this week?");
  assert.deepEqual(a?.tools, [{ id: "collections", period: "this_week" }]);
  assert.equal(a?.language, "en");
  const b = deterministicPlan("kitne bachche 90 din se baaki hain");
  assert.equal(b?.tools[0]!.id, "dues_ageing");
  assert.equal(b?.tools[0]!.band, "over90");
  assert.equal(b?.tools[0]!.classRef, undefined, "'90 din' is not a class");
  assert.equal(b?.language, "hinglish");
  const c = deterministicPlan("class 5A me kitne students hain");
  assert.equal(c?.tools[0]!.id, "class_strength");
  assert.equal(c?.tools[0]!.classRef, "5A");
  const d = deterministicPlan("कितने बच्चे बाकी हैं");
  assert.equal(d?.tools[0]!.id, "dues_ageing");
  assert.equal(d?.language, "hi");
  assert.equal(deterministicPlan("good morning everyone"), null, "no hint, no plan");
  assert.equal(deterministicPlan("kitni concession di hai")?.tools[0]!.id, "concessions");
}

/* ── renderers carry the numbers ───────────────────────────────── */
{
  const t = renderCollectionsFacts({
    range: { from: "2026-09-07", to: "2026-09-09", label: "this week (from Monday)" },
    count: 12,
    amountPaise: 100950_00,
    previous: { range: { from: "2026-09-04", to: "2026-09-06", label: "the period before" }, count: 9, amountPaise: 24200_00 },
    byMode: [{ label: "CASH", amountPaise: 60000_00 }, { label: "Online", amountPaise: 40950_00 }],
  });
  assert.match(t, /\*₹1,00,950\* · 12 receipts/);
  assert.match(t, /₹76,750 more/);
  const a = renderAgeingFacts({
    scopeLabel: "whole school",
    bands: [
      { band: "over90", label: "Over 90 days", amountPaise: 670775_00, children: 193 },
      { band: "d31to90", label: "31–90 days", amountPaise: 0, children: 0 },
      { band: "d0to30", label: "0–30 days", amountPaise: 262568_00, children: 171 },
      { band: "notDue", label: "Not yet due", amountPaise: 0, children: 0 },
    ],
    totalOpenPaise: 1723582_00,
    childrenOwing: 230,
    listed: { band: "Over 90 days", rows: [{ name: "AARAV SINGH", classLabel: "Class 5 A", amountPaise: 12000_00, oldestDueOn: "2026-04-10" }], more: 192 },
  });
  assert.match(a, /Still owed \*₹17,23,582\* across 230 children/);
  assert.doesNotMatch(a, /31–90 days/, "empty bands are not printed");
  assert.match(a, /\*1\.\* AARAV SINGH · Class 5 A · ₹12,000 · oldest due 2026-04-10/);
  assert.match(a, /…and 192 more/);
}

/* ── the number guard ──────────────────────────────────────────── */
{
  const facts = "*Fee collection · this week*\n*₹1,00,950* · 22 receipts\nthe period before: ₹24,200 · 9 receipts → ₹76,750 more";
  assert.deepEqual(numberTokens("₹1,00,950 in 22 receipts"), ["100950", "22"]);
  assert.equal(
    parseErpAskAnswerJson('{"answer":"Is hafte ab tak *₹1,00,950* aaya hai, 22 receipts se — pichle hafte se ₹76,750 zyada."}', facts),
    "Is hafte ab tak *₹1,00,950* aaya hai, 22 receipts se — pichle hafte se ₹76,750 zyada.",
  );
  assert.equal(parseErpAskAnswerJson('{"answer":"About ₹1 lakh came in from 22 receipts."}', facts), null, "a rounded figure the facts do not contain is refused");
  assert.equal(parseErpAskAnswerJson('{"answer":"23 receipts this week."}', facts), null, "a wrong small count is refused too");
  assert.equal(parseErpAskAnswerJson('{"answer":"Collections were well above last week."}', facts), "Collections were well above last week.", "no numbers is fine");
  assert.equal(parseErpAskAnswerJson('{"answer":""}', facts), null);
}

console.log("  ok");
