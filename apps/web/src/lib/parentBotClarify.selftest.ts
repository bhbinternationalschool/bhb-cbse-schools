/**
 * Self-test: the bot asking back instead of giving up.
 * Run: npx tsx src/lib/parentBotClarify.selftest.ts
 *
 * The director's question (21 Sep 2026): can the bot "provide answer or if
 * can not not provide answer then ask and guide how they can ask". It had
 * only two outcomes — answer, or "I don't have that information" and a queue
 * for the office. A father who wrote "Transport ka" got the second.
 *
 * What must hold:
 *  - a kind the model did not send, or sent wrongly, never counts as
 *    permission to speak;
 *  - the clarifying reply leads with the parent's own question, not a menu;
 *  - it names only keywords the bot actually recognises, or it is a promise
 *    the school breaks;
 *  - an empty question falls back to the honest "I don't have that" line
 *    rather than sending a parent an empty message.
 */

import assert from "node:assert/strict";

import {
  composeSisClarifyReply,
  composeSisUngroundedReply,
  detectSisBotIntent,
  readParentBotReplyKind,
} from "./sisParentBotEngine";
import { GUIDE_KEYWORDS } from "./parentBotGuide";

console.log("parentBotClarify.selftest.ts");

/* ── Only the two permissive words let the model's text through ──── */
{
  assert.equal(readParentBotReplyKind("answer"), "answer");
  assert.equal(readParentBotReplyKind("clarify"), "clarify");
  assert.equal(readParentBotReplyKind("Answer"), "answer", "case is the model's business, not ours");
  assert.equal(readParentBotReplyKind(" CLARIFY "), "clarify");

  // Everything else is the school's fixed line and a person.
  for (const raw of ["unknown", "", "   ", "yes", "true", "grounded", "ANSWERED", null, undefined, 1, {}, []]) {
    assert.equal(readParentBotReplyKind(raw), "unknown", `not permission to speak: ${JSON.stringify(raw)}`);
  }
}

/* ── The question comes first; the guidance is a footnote ────────── */
{
  const asked = "आप ट्रांसपोर्ट की फीस जानना चाहते हैं या बस का समय?";
  const hi = composeSisClarifyReply(asked, true);
  assert.ok(hi.startsWith(asked), "the parent's own question leads");
  assert.ok(hi.includes("*DUES*") && hi.includes("*MENU*"), hi);
  assert.ok(!hi.includes("I don't have"), "this is not a give-up");

  const en = composeSisClarifyReply("Do you mean the transport fee, or the bus timing?", false);
  assert.ok(en.startsWith("Do you mean"), en);
  assert.ok(en.includes("*HUMAN*"), "a person is always one word away");

  // Short. This arrives when a parent is already not being understood, and
  // the full list lives behind MENU.
  assert.ok(hi.length < 400 && en.length < 400, "the nudge stays small");
}

/* ── Every keyword it names is one the bot answers ───────────────── */
{
  // The same rule waParentGuide.selftest applies to the guide: a keyword
  // printed here that no handler recognises is a promise the school breaks
  // the first time a parent types it.
  for (const text of [composeSisClarifyReply("Q?", true), composeSisClarifyReply("Q?", false)]) {
    for (const word of text.match(/\*([A-Z]+)\*/g) ?? []) {
      const keyword = word.replace(/\*/g, "");
      assert.ok(
        (GUIDE_KEYWORDS as readonly string[]).includes(keyword),
        `${keyword} is offered but is not in the guide`,
      );
      if (keyword !== "MENU") {
        assert.notEqual(
          detectSisBotIntent(keyword),
          "unknown",
          `${keyword} is offered but the bot does not recognise it`,
        );
      }
    }
  }
}

/* ── No question, no nudge ───────────────────────────────────────── */
{
  // A model that returns kind=clarify with nothing in it must not send a
  // parent a bare menu with no question — that is the old dead end wearing
  // a hat. The honest line goes instead, and the caller escalates.
  assert.equal(composeSisClarifyReply("", true), composeSisUngroundedReply(true));
  assert.equal(composeSisClarifyReply("   ", false), composeSisUngroundedReply(false));
}

console.log("  ok");
