/**
 * Run: npx tsx src/lib/waFailureReason.selftest.ts
 *
 * The whole point of this classifier is keeping two failures apart, so most
 * of these assertions are about NOT confusing them.
 */
import assert from "node:assert/strict";
import {
  classifyWaFailure,
  waFailureBlamesNumber,
  waFailureLabel,
} from "./waFailureReason";

console.log("waFailureReason.selftest.ts");

// --- the two that matter, in Meta's own words ----------------------------
{
  const bad = classifyWaFailure("Message undeliverable");
  assert.equal(bad.kind, "not_on_whatsapp");
  assert.equal(bad.numberAtFault, true);
  assert.equal(bad.retryable, false, "resending to a non-WhatsApp number is pointless");

  const window = classifyWaFailure("Re-engagement message");
  assert.equal(window.kind, "needs_template");
  assert.equal(
    window.numberAtFault,
    false,
    "a 24h-window failure says nothing about the number — the office must not go and 'correct' a good one",
  );
  assert.equal(window.retryable, true);
}

// --- both are real rows in this school's delivery log --------------------
{
  assert.equal(waFailureLabel("Message undeliverable"), "Not on WhatsApp");
  assert.equal(
    waFailureLabel("Re-engagement message"),
    "Needs an approved template",
  );
}

// --- our own send-path strings classify the same way ---------------------
{
  assert.equal(
    classifyWaFailure(
      "Outside Meta's 24h session window — send an approved template instead",
    ).kind,
    "needs_template",
  );
  assert.equal(
    classifyWaFailure(
      "Outside Meta's 24h session window — a document needs an open conversation",
    ).kind,
    "needs_template",
  );
  assert.equal(
    classifyWaFailure("Contact has opted out (STOP)").kind,
    "opted_out",
  );
  assert.equal(classifyWaFailure("Invalid mobile").kind, "invalid_mobile");
}

// --- numeric codes, with or without surrounding text --------------------
{
  assert.equal(classifyWaFailure("131026").kind, "not_on_whatsapp");
  assert.equal(classifyWaFailure("(#131047) Re-engagement").kind, "needs_template");
  assert.equal(classifyWaFailure("131031 account locked").kind, "provider_problem");
}

// --- ordering: the word "message" appears in both, so the specific test
//     for re-engagement has to win -------------------------------------
{
  assert.equal(
    classifyWaFailure("Re-engagement message undeliverable").kind,
    "needs_template",
    "a string containing both must not be read as a bad number",
  );
}

// --- only number-faults land on a fix-the-number list --------------------
{
  assert.equal(waFailureBlamesNumber("Message undeliverable"), true);
  assert.equal(waFailureBlamesNumber("Invalid mobile"), true);
  assert.equal(waFailureBlamesNumber("Re-engagement message"), false);
  assert.equal(waFailureBlamesNumber("Contact has opted out (STOP)"), false);
  assert.equal(waFailureBlamesNumber("Template paused"), false);
  assert.equal(waFailureBlamesNumber(""), false);
  assert.equal(waFailureBlamesNumber(null), false);
}

// --- an unrecognised reason is never guessed into a number fault ---------
{
  const u = classifyWaFailure("something nobody has seen before");
  assert.equal(u.kind, "unknown");
  assert.equal(u.numberAtFault, false);
  assert.equal(u.label, "Failed");
}

// --- every verdict carries advice; a label with no next step is useless -
{
  for (const raw of [
    "Message undeliverable",
    "Re-engagement message",
    "Contact has opted out (STOP)",
    "Template paused",
    "Invalid mobile",
    "131031 account locked",
    "",
  ]) {
    const v = classifyWaFailure(raw);
    assert.ok(v.advice.length > 20, `advice missing for "${raw}"`);
    assert.ok(v.label.length > 0, `label missing for "${raw}"`);
  }
}

console.log("OK — waFailureReason.selftest.ts");
