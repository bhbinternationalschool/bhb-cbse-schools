/**
 * Self-test: APAAR consent on WhatsApp — two buttons instead of a printed form.
 * Run: npx tsx src/lib/apaarConsent.selftest.ts   (from apps/web)
 */
import assert from "node:assert/strict";

import {
  APAAR_CONSENT_NO_ID,
  APAAR_CONSENT_YES_ID,
  apaarConsentButtons,
  apaarConsentPending,
  composeApaarConsentAsk,
  composeApaarConsentThanks,
  isApaarConsentRequest,
  parseApaarConsentReply,
} from "./apaarConsent";

console.log("apaarConsent.selftest.ts");

/* Only a tap is consent. */
assert.equal(parseApaarConsentReply(APAAR_CONSENT_YES_ID), "given");
assert.equal(parseApaarConsentReply(APAAR_CONSENT_NO_ID), "refused");
for (const b of [...apaarConsentButtons(true), ...apaarConsentButtons(false)]) {
  assert.ok(b.title.length <= 20, `Meta's 20-character button limit: ${b.title}`);
  assert.ok(parseApaarConsentReply(b.title), `a client that sends the title still counts: ${b.title}`);
}
for (const no of ["haan", "yes", "हाँ", "ok", "APAAR", "no fees", ""]) {
  assert.equal(parseApaarConsentReply(no), null, `typed text is never consent: ${no}`);
}

/* "APAAR" brings the question back; nothing else does. */
for (const yes of ["APAAR", "apaar id", "APAAR सहमति", "Apaar?"]) assert.ok(isApaarConsentRequest(yes), yes);
for (const no of ["apaar id kya hai", "APAAR ID bani?", "fees"]) assert.equal(isApaarConsentRequest(no), false, no);

/* The question carries the consent itself — voluntary, withdrawable, no form. */
const hi = composeApaarConsentAsk({ guardianName: "SUJEET SINGH", childNames: ["VIDHI SINGH", "RUDRANSH SINGH"], hindi: true });
assert.match(hi, /VIDHI SINGH, RUDRANSH SINGH/);
assert.match(hi, /मैं, SUJEET SINGH,/);
assert.match(hi, /शिक्षा मंत्रालय \/ UDISE\+ \/ DigiLocker/, "what is shared and with whom");
assert.match(hi, /वापस ली जा सकती है/, "consent can be withdrawn");
assert.match(hi, /प्रिंट या हस्ताक्षर करने की ज़रूरत नहीं/);
assert.ok(!/अनिवार्य|compulsory|mandatory/i.test(hi), "APAAR is voluntary");
assert.ok(hi.length <= 1024, "Meta's interactive body limit");
const en = composeApaarConsentAsk({ guardianName: "", childNames: ["VIDHI SINGH"], hindi: false });
assert.match(en, /VIDHI SINGH does not have an APAAR ID/);
assert.match(en, /withdrawn at any time/);
assert.ok(en.length <= 1024);

/* The answer, said back. "No" is final and respected. */
assert.match(composeApaarConsentThanks({ answer: "given", childNames: ["VIDHI SINGH"], hindi: true }), /सहमति दर्ज हो गई/);
const refused = composeApaarConsentThanks({ answer: "refused", childNames: ["VIDHI SINGH"], hindi: false });
assert.match(refused, /no APAAR ID will be made/);
assert.match(refused, /send \*APAAR\*/, "how to change their mind");

/* Who is still to be asked. */
const kids = [
  { status: "active", apaarId: "", apaarConsent: "" },
  { status: "active", apaarId: "123456789012", apaarConsent: "" },
  { status: "active", apaarId: "", apaarConsent: "refused" },
  { status: "active", apaarId: "", apaarConsent: "given" },
  { status: "left", apaarId: "", apaarConsent: "" },
];
assert.equal(apaarConsentPending(kids).length, 1, "no ID, no answer, still here");

console.log("  ok");
