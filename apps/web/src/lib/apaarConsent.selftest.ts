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
  parentPartOfApaar,
  parseApaarConsentReply,
} from "./apaarConsent";
import { apaarReadiness } from "./udiseCompliance";
import type { SisStudent } from "./sis";

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

/* A "yes" is not yet an ID: what is still missing is said at once. */
{
  const need = [
    { name: "VIDHI SINGH", waitingFor: ["aadhaar_recheck" as const, "pen" as const] },
    { name: "AARAV", waitingFor: ["child_aadhaar" as const] },
    { name: "RIYA", waitingFor: ["pen" as const] },
  ];
  const hi = composeApaarConsentThanks({ answer: "given", childNames: ["VIDHI SINGH", "AARAV", "RIYA"], hindi: true, stillNeeded: need });
  assert.match(hi, /सहमति दर्ज हो गई/);
  assert.match(hi, /\*AARAV\*: बच्चे के आधार कार्ड की साफ़ फ़ोटो/);
  assert.match(hi, /\*VIDHI SINGH\*: बच्चे का आधार कार्ड दोबारा/);
  assert.ok(!/RIYA\*:/.test(hi), "the PEN is the school's job — never put to a parent");
  assert.ok(!/PEN/.test(parentPartOfApaar(need, false).join("\n")));
  assert.match(hi, /नज़दीकी आधार केंद्र/, "a child with no Aadhaar at all");
  const done = composeApaarConsentThanks({ answer: "given", childNames: ["RIYA"], hindi: false, stillNeeded: [] });
  assert.match(done, /will create the APAAR ID/);

  // Readiness, as the office sees it.
  const base = { apaarId: "", pen: "21329329851", aadhaarNumber: "234123412346", aadhaarLast4: "2346", udiseAadhaarValidationStatus: "", apaarConsent: "given", fatherAadhaarNumber: "999988887777" } as unknown as SisStudent;
  const cfg = { parentAadhaarRequiredForApaar: false } as Parameters<typeof apaarReadiness>[1];
  assert.deepEqual(apaarReadiness(base, cfg), { ready: true, waitingFor: [] });
  assert.deepEqual(apaarReadiness({ ...base, aadhaarNumber: "", aadhaarLast4: "" }, cfg).waitingFor, ["child_aadhaar"]);
  assert.deepEqual(apaarReadiness({ ...base, udiseAadhaarValidationStatus: "Validation failed" }, cfg).waitingFor, ["aadhaar_recheck"]);
  assert.deepEqual(apaarReadiness({ ...base, pen: "" }, cfg).waitingFor, ["pen"]);
  assert.equal(apaarReadiness({ ...base, apaarConsent: "" } as SisStudent, cfg).ready, false, "no consent, never ready");
}

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
