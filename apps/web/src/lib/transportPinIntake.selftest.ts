/**
 * Self-test: reading a family's reply to "where does your child wait?"
 * Run: npx tsx apps/web/src/lib/transportPinIntake.selftest.ts
 *
 * Two rules this exists to protect:
 *   - "I will send it" is not a pin. The share button sends the WORDS
 *     "लोकेशन भेजें", and closing the request on that abandons a parent who
 *     was about to send one.
 *   - A no is recognised and kept, including the short Roman-script no most
 *     people actually type. The message promises we will not ask again, and
 *     a refusal we fail to read is a promise broken.
 */

import assert from "node:assert/strict";

import {
  MAX_PIN_KM_FROM_SCHOOL,
  checkPinPlausible,
  classifyPinReply,
  joinNames,
  pinDeclinedMessage,
  pinHowToMessage,
  pinSavedMessage,
  pinTooFarMessage,
} from "./transportPinIntake";

console.log("transportPinIntake.selftest.ts");

const SCHOOL = { lat: 25.4354328, lng: 82.9439863 };

/* ── A location always wins ── */
{
  assert.equal(classifyPinReply({ text: "", hasLocation: true }), "pin");
  // Words alongside the pin do not change what it is.
  assert.equal(classifyPinReply({ text: "अभी नहीं", hasLocation: true }), "pin");
  assert.equal(classifyPinReply({ text: "yahi hai", hasLocation: true }), "pin");
}

/* ── The share button is an intention, not an answer ── */
{
  // This is the literal text Meta sends when the quick reply is tapped.
  assert.equal(
    classifyPinReply({ text: "लोकेशन भेजें", hasLocation: false }),
    "will_share",
  );
  assert.equal(classifyPinReply({ text: "Share location", hasLocation: false }), "will_share");
  for (const t of ["ok", "OK", "ठीक है", "haan", "हाँ", "yes", "bhej raha hoon", "location"]) {
    assert.equal(
      classifyPinReply({ text: t, hasLocation: false }),
      "will_share",
      `"${t}" should read as an intention to send`,
    );
  }
}

/* ── A no, in the forms people actually type ── */
{
  // The literal refusal button.
  assert.equal(classifyPinReply({ text: "अभी नहीं", hasLocation: false }), "decline");
  for (const t of ["नहीं", "नही", "ना", "Not now", "no", "No", "nahi", "nahin", "nai"]) {
    assert.equal(
      classifyPinReply({ text: t, hasLocation: false }),
      "decline",
      `"${t}" should read as a refusal`,
    );
  }

  // "nahi bhejna hai" contains "bhej". Reading that as an intention to send
  // would keep pestering a family who has just said no — so refusal is
  // matched before intention.
  assert.equal(
    classifyPinReply({ text: "nahi bhejna hai", hasLocation: false }),
    "decline",
  );
  assert.equal(
    classifyPinReply({ text: "don't want to share", hasLocation: false }),
    "decline",
  );
}

/* ── Everything else belongs to the ordinary bot ── */
{
  for (const t of ["bus kitne baje aayegi", "fees kitni hai", "छुट्टी चाहिए", ""]) {
    assert.equal(
      classifyPinReply({ text: t, hasLocation: false }),
      "unrelated",
      `"${t}" must fall through to the normal bot`,
    );
  }
}

/* ── A pin from outside the area the buses serve ── */
{
  // Ayar, next to the school.
  const near = checkPinPlausible({ lat: 25.4368, lng: 82.9451 }, SCHOOL);
  assert.equal(near.ok, true);
  if (near.ok) assert.ok(near.kmFromSchool < 2);

  // Lucknow — a parent reading the message while travelling.
  const far = checkPinPlausible({ lat: 26.8467, lng: 80.9462 }, SCHOOL);
  assert.equal(far.ok, false);
  if (!far.ok) {
    assert.equal(far.reason, "too-far");
    assert.ok((far.kmFromSchool ?? 0) > MAX_PIN_KM_FROM_SCHOOL);
  }

  // The null island is a tracker with no fix, not a boarding point.
  const zero = checkPinPlausible({ lat: 0, lng: 0 }, SCHOOL);
  assert.equal(zero.ok, false);
  if (!zero.ok) assert.equal(zero.reason, "not-a-coordinate");

  const nan = checkPinPlausible({ lat: Number.NaN, lng: 82.9 }, SCHOOL);
  assert.equal(nan.ok, false);
  if (!nan.ok) assert.equal(nan.reason, "not-a-coordinate");

  // The furthest real rider village is about 30 km, so that must pass.
  const thirty = checkPinPlausible({ lat: 25.4354328 + 30 / 111.32, lng: 82.9439863 }, SCHOOL);
  assert.equal(thirty.ok, true, "a 30 km village is a real rider, not an error");
}

/* ── The confirmation names the children, which is what makes it fixable ── */
{
  const one = pinSavedMessage({ childNames: ["Aarav"], kmFromSchool: 4.2, language: "hi" });
  assert.match(one, /Aarav/);
  assert.match(one, /4\.2/);
  assert.match(one, /अलग-अलग/, "it must invite a correction");

  const two = pinSavedMessage({
    childNames: ["Aarav", "Isha"],
    kmFromSchool: 4.2,
    language: "hi",
  });
  assert.match(two, /Aarav और Isha/, "both children named, so one pin for both is visible");

  const three = pinSavedMessage({
    childNames: ["Aarav", "Isha", "Rehan"],
    kmFromSchool: 1,
    language: "en",
  });
  assert.match(three, /Aarav, Isha and Rehan/);

  assert.equal(joinNames([], "hi"), "");
  assert.equal(joinNames(["Solo"], "en"), "Solo");
}

/* ── The promises in the request are kept in the replies ── */
{
  const declined = pinDeclinedMessage("hi");
  assert.match(declined, /कोई बदलाव नहीं/, "transport is unchanged");
  assert.match(declined, /दोबारा नहीं पूछेंगे/, "and we will not ask again");

  const howTo = pinHowToMessage("hi");
  assert.match(howTo, /Location/, "names the WhatsApp menu item they must find");
  assert.match(howTo, /📎/);

  const tooFar = pinTooFarMessage({ kmFromSchool: 412, language: "hi" });
  assert.match(tooFar, /412/);
  // It must not accuse them of being wrong — they may simply be travelling.
  assert.match(tooFar, /बाहर/);

  for (const fn of [pinDeclinedMessage, pinHowToMessage]) {
    assert.ok(fn("en").length > 40, "the English side is written, not a stub");
    assert.notEqual(fn("en"), fn("hi"));
  }
}

console.log("  ✓ transport pin intake — an intention is not a pin, and a no is kept");
