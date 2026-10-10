/**
 * Self-test: the AI tutor's Markdown, as WhatsApp will show it.
 * Run: npx tsx apps/web/src/lib/waMarkdown.selftest.ts
 *
 * What must hold:
 *  - the real reply SHANVI's mother was sent on 22 Sep 2026 comes out with
 *    no "**", no "###" and no "---" left in it;
 *  - bold survives as WhatsApp bold — a single asterisk — rather than being
 *    stripped, because the praise is the point of the message;
 *  - text with no Markdown in it is returned untouched. A tutor's reply is
 *    full of maths, and a converter that guesses at asterisks eats a
 *    multiplication sign.
 */

import assert from "node:assert/strict";

import { whatsappFromMarkdown } from "./waMarkdown";

console.log("waMarkdown.selftest.ts");

/* ── 1. The real message, as it was sent ────────────────────────────── */

// MANMOHAN DIXIT / SHANVI DIXIT (UKG), 22 Sep 2026 19:32 IST — verbatim,
// the evening before her Hindi Rhymes paper.
const real = [
  "शाबाश शानवी! आपका उत्तर **बिल्कुल सही** है! ",
  "",
  '**कारण:** कविता की सही पंक्ति है — "मछली जल की **रानी** है, जीवन उसका पानी है।"',
  "",
  "---",
  "",
  "### कल के अर्धवार्षिक पेपर के लिए मुख्य बातें (Exam Preparation Tips):",
  "",
  "**1. दोहराने के लिए मुख्य बातें (Key Points to Revise):**",
  "* मुख्य कविताओं की पंक्तियाँ याद रखें: 'मछली जल की रानी है'।",
  "* कविताओं के हाव-भाव (actions) के साथ बोलने का अभ्यास करें।",
].join("\n");

const shown = whatsappFromMarkdown(real);

assert.ok(!shown.includes("**"), "no double asterisk reaches the phone");
assert.ok(!shown.includes("###"), "no hash heading reaches the phone");
assert.ok(!/^\s*---\s*$/m.test(shown), "no rule line reaches the phone");

// The emphasis is kept, in WhatsApp's own spelling of it.
assert.ok(shown.includes("*बिल्कुल सही*"), "the praise is still bold");
assert.ok(shown.includes("*रानी*"), "bold inside a sentence too");
assert.ok(shown.includes("*कारण:*"), "a bold run at the start of a line");
assert.ok(
  shown.includes("*कल के अर्धवार्षिक पेपर के लिए मुख्य बातें (Exam Preparation Tips):*"),
  "the heading becomes a bold line, not a lost line",
);
assert.ok(shown.includes("• मुख्य कविताओं"), "a star bullet becomes a bullet");
assert.ok(shown.includes("• कविताओं के हाव-भाव"), "both of them");
assert.ok(!/\n{3,}/.test(shown), "dropping the rule leaves no hole");

// Nothing the mother needs to read has gone missing.
for (const kept of ["शाबाश शानवी", "जीवन उसका पानी है", "हाव-भाव (actions)"]) {
  assert.ok(shown.includes(kept), `kept: ${kept}`);
}

/* ── 2. Two bold runs on one line stay two ──────────────────────────── */

assert.equal(
  whatsappFromMarkdown("**Enter** key और **Space bar** अलग हैं"),
  "*Enter* key और *Space bar* अलग हैं",
);

/* ── 3. Plain text, and maths, are left exactly alone ───────────────── */

for (const untouched of [
  "एक वयस्क के 32 दांत होते हैं।",
  "4 * 5 = 20",
  "2 * 3 * 4 का गुणनफल निकालिए",
  "*पहले से WhatsApp bold* — छूना नहीं है",
  "5 - 3 = 2",
  "Answer: a - b + c",
]) {
  assert.equal(whatsappFromMarkdown(untouched), untouched, `untouched: ${untouched}`);
}

// An unclosed "**" must not swallow the rest of the reply.
assert.equal(
  whatsappFromMarkdown("**शुरू\nअगली पंक्ति"),
  "**शुरू\nअगली पंक्ति",
);

/* ── 4. Empty in, empty out ─────────────────────────────────────────── */

assert.equal(whatsappFromMarkdown(""), "");
assert.equal(whatsappFromMarkdown("   "), "   ");

console.log("  ok — the tutor's Markdown reaches the phone as WhatsApp formatting");
