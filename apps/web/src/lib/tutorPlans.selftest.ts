/**
 * Self-test: the parent tutor's allowance policy, passes and prompts.
 * Run: npx tsx apps/web/src/lib/tutorPlans.selftest.ts
 */
import assert from "node:assert/strict";
import {
  buildTutorSystemPrompt,
  classLevelGuide,
  DEFAULT_TUTOR_PLANS,
  formatPaise,
  parseCount,
  parseTutorLanguage,
  parseTutorPlans,
  prefersHindi,
  videoSearchQuery,
  passValidLabel,
  passWindow,
  TUTOR_MODES,
  tutorMode,
  tutorVerdict,
  type TutorAllowance,
} from "@/lib/tutorPlans";

const now = new Date("2026-09-05T10:00:00.000Z");
const base: TutorAllowance = {
  studentId: "stu_1",
  studentName: "Amay",
  classLabel: "LKG A",
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

// --- class level guide
{
  assert.ok(classLevelGuide("LKG A").startsWith("Pre-primary"));
  assert.ok(classLevelGuide("Nursery").startsWith("Pre-primary"));
  assert.ok(classLevelGuide("II A").startsWith("Classes I–II"));
  assert.ok(classLevelGuide("Class 2").startsWith("Classes I–II"));
  assert.ok(classLevelGuide("IV").startsWith("Classes III–V"));
  assert.ok(classLevelGuide("VIII B").startsWith("Classes VI–VIII"));
  assert.ok(classLevelGuide("7").startsWith("Classes VI–VIII"));
  assert.ok(classLevelGuide("").startsWith("Pre-primary"), "unknown falls to the lowest level, never a higher one");
}

// --- prompts
{
  const hint = buildTutorSystemPrompt("hint", { childName: "Amay", className: "LKG A" }, "BHB");
  assert.ok(hint.includes("HINTS, not answers"));
  assert.ok(hint.includes("Child: Amay."));
  assert.ok(hint.includes("set up for Amay, who is in LKG A"), "the prompt is pinned to the child's class");
  assert.ok(hint.includes("Pre-primary"), "and carries that class's level guide");
  assert.ok(hint.includes("needs their own pass"), "siblings are sent to their own tutor");
  const two = buildTutorSystemPrompt("teach", { childName: "Dipti", className: "II A" }, "BHB");
  assert.ok(two.includes("Classes I–II") && !two.includes("Pre-primary"));
  assert.ok(buildTutorSystemPrompt("hint", {}, "BHB", "hi").includes("Devanagari"), "Hindi replies are asked for in Devanagari");
  assert.ok(buildTutorSystemPrompt("hint", {}, "BHB", "en").includes("simple English"));
  assert.ok(buildTutorSystemPrompt("hint", {}, "BHB").includes("Match the parent's language"), "auto follows the parent");
  const both = buildTutorSystemPrompt("hint", {}, "BHB", "both");
  assert.ok(both.includes("TWO parts") && both.includes("'हिंदी'") && both.includes("'English'"), "both = Hindi then English");
  assert.ok(both.includes("NCERT") && both.includes("state-board"), "CBSE/NCERT only, state boards excluded");
  assert.ok(!hint.includes("Subject:"), "absent context is absent, not 'undefined'");
  const teach = buildTutorSystemPrompt("teach", {}, "BHB");
  assert.ok(teach.includes("short lesson"));
  assert.ok(!teach.includes("HINTS, not answers"), "paid modes are allowed to answer");
  assert.ok(teach.includes("Never invent facts about the school"), "guard rails apply to every mode");
  const score = buildTutorSystemPrompt("score", { homeworkBody: "x".repeat(5000) }, "BHB");
  assert.ok(score.length < 5000, "assignment text is capped");
}

// --- language + videos
{
  assert.equal(parseTutorLanguage("hi"), "hi");
  assert.equal(parseTutorLanguage("both"), "both");
  assert.equal(parseTutorLanguage("fr"), "auto");
  assert.equal(parseTutorLanguage(undefined), "auto");
  assert.ok(prefersHindi("both") && prefersHindi("hi") && !prefersHindi("en") && !prefersHindi("auto"));
  assert.equal(videoSearchQuery("  fractions   ", "III A", "en"), "fractions class III CBSE NCERT explained for kids");
  assert.equal(videoSearchQuery("भिन्न", "III A", "hi"), "भिन्न class III CBSE NCERT हिंदी में समझाइए");
  assert.equal(videoSearchQuery("fractions", "III A", "both"), "fractions class III CBSE NCERT हिंदी में समझाइए", "both → Hindi videos");
  assert.equal(videoSearchQuery("counting", "", "en"), "counting CBSE NCERT explained for kids", "no class → no empty level word");
  assert.ok(videoSearchQuery("x".repeat(200), "LKG", "en").length < 80 + 50, "topic is capped at 80 chars");
}

console.log("tutorPlans.selftest: ok");
