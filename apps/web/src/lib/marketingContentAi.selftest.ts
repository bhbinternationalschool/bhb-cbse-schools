import assert from "node:assert/strict";
import { forbiddenNameHits, sensitiveClaims, ungroundedNumbers } from "./aiGrounding";
import {
  buildMarketingSystemPrompt,
  buildMarketingUserPrompt,
  cleanMarketingFacts,
  flagMarketingVariant,
  marketingDraftPlan,
  normalizeAudiences,
  parseMarketingVariants,
} from "./marketingContentAi";
import { achievementsToFactLines, normalizeSchoolAchievements, upsertAchievement } from "./schoolAchievements";

console.log("marketingContentAi.selftest.ts");

// Grounding helpers
assert.deepEqual(ungroundedNumbers("Pass 100% with 42 distinctions in 2026", "Pass %: 100; Distinctions: 42; 2026"), []);
assert.deepEqual(ungroundedNumbers("Fee only ₹25,000 and 1,200 students", "₹1,200 per month"), ["₹25,000"]);
assert.deepEqual(forbiddenNameHits("Better than Sunbeam and DPS here", ["Sunbeam", "DPS", "xy"]), ["Sunbeam", "DPS"]);
assert.deepEqual(forbiddenNameHits("Sunbeams of hope", ["Sunbeam"]), [], "whole word only");
assert.ok(sensitiveClaims("We are the No. 1 school with 100% result").length === 2);
assert.deepEqual(sensitiveClaims("Our students did well"), []);

// Achievements → fact lines carry metrics verbatim.
{
  const s0 = normalizeSchoolAchievements({});
  const r = upsertAchievement(s0, { kind: "board_result", academicYearCode: "2025-26", title: "Class X CBSE result", detail: "All students passed", metrics: [{ label: "Pass %", value: "100" }, { label: "Distinctions", value: "42" }, { label: "", value: "x" }], date: "2026-05-13", sourceNote: "CBSE PDF", by: "t" });
  assert.ok(r.ok);
  if (!r.ok) throw new Error();
  const line = achievementsToFactLines(r.state.achievements)[0];
  assert.match(line, /^Board result 2025-26 \(2026-05-13\) — Class X CBSE result\. All students passed\. Pass %: 100; Distinctions: 42$/);
  assert.equal(r.state.achievements[0].metrics.length, 2, "metric without label dropped");
}

// Audiences + plan: regional needs a Hindi base.
assert.deepEqual(normalizeAudiences([]), [{ language: "en", register: "warm" }]);
assert.deepEqual(normalizeAudiences([{ language: "bn" }, { language: "bn" }, { language: "klingon" }]), [{ language: "bn", register: "warm" }]);
{
  const plan = marketingDraftPlan([{ language: "en", register: "warm" }, { language: "bn", register: "formal" }]);
  assert.deepEqual(plan.direct.map((a) => a.language), ["en", "hi"]);
  assert.deepEqual(plan.viaSarvam.map((a) => a.language), ["bn"]);
}

// Prompts declare absence; positioning never names.
const facts = cleanMarketingFacts({ schoolName: "BHB International School", tagline: "Tradition of excellence", city: "Varanasi", achievementLines: [], usps: ["1:20 teacher ratio"], competitorNames: ["Sunbeam"], positioningOthers: "Others push AC buses", ctaUrl: "https://bhbinternational.school/apply" });
assert.match(buildMarketingUserPrompt(facts), /Achievements: none selected — do not invent results/);
assert.match(buildMarketingUserPrompt(facts), /for contrast only, never name them/);
assert.match(buildMarketingSystemPrompt({ kind: "social_post", direct: [{ language: "hi", register: "warm" }], positioning: true }), /NEVER name, hint at or disparage/);
assert.match(buildMarketingSystemPrompt({ kind: "greeting", direct: [{ language: "en", register: "warm" }], positioning: false }), /Hard limit 400 characters/);

// Parser + flags.
assert.equal(parseMarketingVariants("{}"), null);
const vs = parseMarketingVariants(JSON.stringify({ variants: [{ language: "en", register: "warm", subject: "", text: "Admissions open! 100% result last year. Beat Sunbeam. Fees ₹40,000." }, { language: "xx", text: "" }] }));
assert.ok(vs && vs.length === 1);
const fl = flagMarketingVariant(vs![0], facts, "social_post");
assert.ok(fl.ungroundedNumbers.includes("₹40,000") && fl.ungroundedNumbers.some((n) => n.startsWith("100")), JSON.stringify(fl));
assert.deepEqual(fl.forbiddenNames, ["Sunbeam"]);
assert.ok(fl.sensitiveClaims.length >= 1);
assert.equal(fl.overLimit, false);
// Numbers present in facts are not flagged; sensitive phrase present in facts is allowed.
const facts2 = cleanMarketingFacts({ ...facts, achievementLines: ["Board result 2025-26 — Class X: Pass %: 100; Distinctions: 42"] });
const ok = flagMarketingVariant({ language: "en", register: "warm", subject: "", text: "Class X: 100% pass, 42 distinctions in 2025-26." }, facts2, "social_post");
assert.deepEqual(ok.ungroundedNumbers, []);

console.log("OK — marketingContentAi.selftest.ts");
