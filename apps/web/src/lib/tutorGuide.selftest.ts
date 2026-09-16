/**
 * Self-test: the tutor guide only teaches what the tutor does.
 * Run: npx tsx apps/web/src/lib/tutorGuide.selftest.ts
 *
 * A guide is a promise. If it tells a parent to type EXAMPLES and the tutor
 * does not know that word, the parent's first try fails and the free day —
 * given away to build a habit — builds the opposite one. So:
 *
 *  - every *WORD* the guide tells a parent to type must parse as a tutor
 *    command in waTutorBotEngine, exactly as a parent would type it;
 *  - prices and the free-hint count come from the live plan list — a school
 *    that changes its prices must not have a guide quoting the old ones;
 *  - TUTOR 2 is offered only to a family with a second child to switch to;
 *  - the whole first-tap message fits WhatsApp's 4,096-character limit.
 */

import assert from "node:assert/strict";

import { composeTutorGuide } from "./tutorGuide";
import { parseWaTutorCommand } from "./waTutorBotEngine";
import type { TutorPlan } from "./tutorPlans";

console.log("tutorGuide.selftest.ts");

const plans: TutorPlan[] = [
  { code: "day", label: "1 day", days: 1, pricePaise: 4900 },
  { code: "week", label: "7 days", days: 7, pricePaise: 19900 },
  { code: "month", label: "30 days", days: 30, pricePaise: 49900 },
];

for (const hindi of [true, false]) {
  const guide = composeTutorGuide({
    hindi,
    childNames: ["Ansh", "Arav"],
    freeHintsPerDay: 20,
    plans,
    multipleChildren: true,
  });
  const lang = hindi ? "hi" : "en";

  /* ── 1. Every command it teaches is one the tutor understands ─────── */

  const commands = [...guide.matchAll(/\*([A-Z]{2,}(?: [A-Z0-9]+)?)\*/g)].map((m) => m[1]!);
  assert.ok(commands.length >= 8, `${lang}: expected the full command list, found ${commands.join(", ")}`);

  for (const cmd of commands) {
    if (cmd === "MENU") continue; // the parent bot's word, not the tutor's
    const parsed = parseWaTutorCommand(cmd, false);
    assert.notEqual(
      parsed.kind,
      "none",
      `${lang}: the guide says type *${cmd}*, but the tutor does not understand it`,
    );
  }
  // The specific shapes that matter most.
  assert.equal(parseWaTutorCommand("TEACH भिन्न", false).kind, "mode");
  assert.equal(parseWaTutorCommand("TUTOR 2", false).kind, "child");
  assert.equal(parseWaTutorCommand("TUTOR OFF", true).kind, "close");
  assert.equal(parseWaTutorCommand("PASS", false).kind, "plans");

  /* ── 2. Prices and hints come from what it was given ──────────────── */

  assert.ok(guide.includes("₹49"), `${lang}: day pass price`);
  assert.ok(guide.includes("₹199") && guide.includes("₹499"), `${lang}: week and month`);
  assert.ok(guide.includes("20"), `${lang}: the free hint count`);

  const repriced = composeTutorGuide({
    hindi,
    childNames: ["Ansh"],
    freeHintsPerDay: 10,
    plans: [{ code: "day", label: "1 day", days: 1, pricePaise: 2900 }],
    multipleChildren: false,
  });
  assert.ok(repriced.includes("₹29"), `${lang}: a changed price is quoted`);
  assert.ok(!repriced.includes("₹49"), `${lang}: the old price is not`);
  assert.ok(repriced.includes("10"), `${lang}: a changed hint count is quoted`);

  /* ── 3. TUTOR 2 only for a family with a second child ─────────────── */

  assert.ok(guide.includes("TUTOR 2"), `${lang}: two children → how to switch`);
  assert.ok(!repriced.includes("TUTOR 2"), `${lang}: one child → no switch line`);

  /* ── 4. It names what is new and real ─────────────────────────────── */

  assert.ok(guide.includes("NCERT"), `${lang}: answers name the NCERT book and chapter`);
  assert.ok(guide.includes("DIKSHA"), `${lang}: videos from DIKSHA`);

  /* ── 5. It fits in one WhatsApp message with the welcome above it ─── */

  const welcome = `🎁 ${"x".repeat(160)}\n\n${guide}`;
  assert.ok(welcome.length < 4096, `${lang}: ${welcome.length} characters — WhatsApp's limit is 4,096`);
}

/* ── 6. No plans configured → no price line, never a blank one ─────── */

const noPlans = composeTutorGuide({
  hindi: true,
  childNames: ["Ansh"],
  freeHintsPerDay: 20,
  plans: [],
  multipleChildren: false,
});
assert.ok(!noPlans.includes("PASS"), "no passes on sale → do not tell the family to type PASS");
assert.ok(!/:\s*—/.test(noPlans), "and no empty price list");

console.log("  ok — every command it teaches, the tutor understands");
