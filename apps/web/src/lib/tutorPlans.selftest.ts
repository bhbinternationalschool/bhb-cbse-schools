/**
 * Self-test: the parent tutor's allowance policy, passes and prompts.
 * Run: npx tsx apps/web/src/lib/tutorPlans.selftest.ts
 */
import assert from "node:assert/strict";
import {
  buildTutorSystemPrompt,
  DEFAULT_TUTOR_PLANS,
  formatPaise,
  parseCount,
  parseTutorPlans,
  passValidLabel,
  passWindow,
  TUTOR_MODES,
  tutorMode,
  tutorVerdict,
  type TutorAllowance,
} from "@/lib/tutorPlans";

const now = new Date("2026-09-05T10:00:00.000Z");
const base: TutorAllowance = {
  freeHintsPerDay: 20,
  freeUsedToday: 0,
  pass: null,
  passMessagesPerDay: 60,
  passUsedToday: 0,
};
const live = { planCode: "tutor_week", planLabel: "1 week", startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-09-08T18:29:59.999Z" };
const dead = { ...live, endsAt: "2026-09-04T18:29:59.999Z" };

// --- verdicts
{
  assert.deepEqual(tutorVerdict("hint", base, now), { allowed: true, charge: "free" });
  const spent = { ...base, freeUsedToday: 20 };
  const v = tutorVerdict("hint", spent, now);
  assert.equal(v.allowed, false, "the 21st free hint is refused");
  assert.ok(!v.allowed && v.needsPass);
  assert.deepEqual(tutorVerdict("hint", { ...spent, pass: live }, now), { allowed: true, charge: "pass" }, "a pass keeps hints flowing past the cap");
  const paid = tutorVerdict("teach", base, now);
  assert.equal(paid.allowed, false, "teaching is never free");
  assert.ok(!paid.allowed && paid.needsPass && paid.reason.includes("Teach a topic"));
  assert.deepEqual(tutorVerdict("teach", { ...base, pass: live }, now), { allowed: true, charge: "pass" });
  const expired = tutorVerdict("teach", { ...base, pass: dead }, now);
  assert.ok(!expired.allowed && expired.needsPass, "an expired pass is no pass");
  const ceiling = tutorVerdict("teach", { ...base, pass: live, passUsedToday: 60 }, now);
  assert.ok(!ceiling.allowed && !ceiling.needsPass, "fair use trips without asking for another pass");
  assert.ok(!ceiling.allowed && ceiling.reason.includes("midnight"));
  assert.equal(tutorVerdict("hint", { ...base, freeHintsPerDay: 0 }, now).allowed, false, "a zero allowance means hints need a pass too");
}

// --- modes
{
  assert.equal(TUTOR_MODES.filter((m) => !m.paid).length, 1, "exactly one free mode");
  assert.equal(tutorMode("nonsense").code, "hint", "unknown modes fall back to hints, never to a paid mode");
  assert.equal(tutorMode(undefined).code, "hint");
}

// --- plans
{
  assert.deepEqual(parseTutorPlans(undefined), [...DEFAULT_TUTOR_PLANS]);
  assert.deepEqual(parseTutorPlans("not json"), [...DEFAULT_TUTOR_PLANS], "garbage keeps the defaults");
  assert.deepEqual(parseTutorPlans("[]"), [...DEFAULT_TUTOR_PLANS], "an empty list must not sell nothing");
  assert.deepEqual(parseTutorPlans('[{"code":"x","days":0,"pricePaise":100}]'), [...DEFAULT_TUTOR_PLANS], "a zero-day pass is rejected whole");
  const custom = parseTutorPlans('[{"code":"d3","label":"3 days","days":3,"pricePaise":9900},{"code":"q90","days":90,"pricePaise":99900}]');
  assert.deepEqual(custom, [
    { code: "d3", label: "3 days", days: 3, pricePaise: 9900 },
    { code: "q90", label: "90 days", days: 90, pricePaise: 99900 },
  ]);
  assert.equal(parseCount("5", 20), 5);
  assert.equal(parseCount("x", 20), 20);
  assert.equal(parseCount("-1", 20), 20);
  assert.equal(formatPaise(4900), "₹49");
  assert.equal(formatPaise(123456), "₹1,234.56");
}

// --- pass windows (IST day ends)
{
  // Bought 9 pm IST on 5 Sep (15:30Z): a 1-day pass lasts till the end of 6 Sep IST.
  const w = passWindow(1, null, new Date("2026-09-05T15:30:00.000Z"));
  assert.equal(w.startsAt, "2026-09-05T15:30:00.000Z");
  assert.equal(w.endsAt, "2026-09-06T18:29:59.999Z", "ends at 23:59:59 IST on the last day");
  assert.equal(passValidLabel(w.endsAt), "Valid till 6 Sep");
  // Bought while a pass runs till 8 Sep: the new week starts after it.
  const stacked = passWindow(7, live.endsAt, now);
  assert.equal(stacked.startsAt, live.endsAt, "starts when the current pass ends");
  assert.equal(passValidLabel(stacked.endsAt), "Valid till 15 Sep");
  // An expired old pass does not push the start out.
  assert.equal(passWindow(7, dead.endsAt, now).startsAt, now.toISOString());
  assert.equal(passValidLabel("2026-12-31T18:29:59.999Z"), "Valid till 31 Dec");
}

// --- prompts
{
  const hint = buildTutorSystemPrompt("hint", { childName: "Amay", className: "LKG A" }, "BHB");
  assert.ok(hint.includes("HINTS, not answers"));
  assert.ok(hint.includes("Child: Amay."));
  assert.ok(!hint.includes("Subject:"), "absent context is absent, not 'undefined'");
  const teach = buildTutorSystemPrompt("teach", {}, "BHB");
  assert.ok(teach.includes("short lesson"));
  assert.ok(!teach.includes("HINTS, not answers"), "paid modes are allowed to answer");
  assert.ok(teach.includes("Never invent facts about the school"), "guard rails apply to every mode");
  const score = buildTutorSystemPrompt("score", { homeworkBody: "x".repeat(5000) }, "BHB");
  assert.ok(score.length < 5000, "assignment text is capped");
}

console.log("tutorPlans.selftest: ok");
