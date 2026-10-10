/**
 * Opt-in photo consent. The one rule everything else hangs off:
 *
 *      SILENCE IS NOT CONSENT.
 *
 * The school moved off a blanket term to a separate, optional tick. If any
 * path below ever turns "not asked" into "granted", a child's photograph goes
 * on the public internet without the family having agreed.
 */
import assert from "node:assert/strict";
import {
  mayPublishForHousehold,
  mediaConsentForHousehold,
  normalizePhotoConsent,
  photoConsentLabel,
} from "@/lib/photoConsent";
import { mayPublishMedia } from "@/lib/website";
import { photographyNoticeText, dpdpNoticeText } from "@/lib/admissionsEnquiryForm";

function run() {
  // Never asked → NOT publishable. This is the whole change.
  assert.equal(mediaConsentForHousehold(""), "pending");
  assert.equal(mayPublishForHousehold(""), false, "silence is not consent");
  assert.equal(mayPublishMedia({ consentStatus: mediaConsentForHousehold("") }), false);

  // Said yes → publishable.
  assert.equal(mediaConsentForHousehold("granted"), "granted");
  assert.equal(mayPublishForHousehold("granted"), true);
  assert.equal(mayPublishMedia({ consentStatus: mediaConsentForHousehold("granted") }), true);

  // Said no → the same protection as objecting later. The timing of a
  // refusal must not change what it is worth.
  assert.equal(mediaConsentForHousehold("refused"), "withdrawn");
  assert.equal(mayPublishForHousehold("refused"), false);
  assert.equal(mayPublishMedia({ consentStatus: mediaConsentForHousehold("refused") }), false);

  // Anything unrecognised is NOT-ASKED, never granted. A stray value from an
  // old row or a bad import must fail safe.
  for (const junk of [undefined, null, "yes", "true", true, 1, "GRANTED", {}]) {
    assert.equal(normalizePhotoConsent(junk), "", `${String(junk)} must not read as an answer`);
    assert.equal(mayPublishForHousehold(normalizePhotoConsent(junk)), false);
  }
  assert.equal(normalizePhotoConsent("granted"), "granted");
  assert.equal(normalizePhotoConsent("refused"), "refused");

  // The office must never see a bare empty string.
  assert.equal(photoConsentLabel(""), "Not asked yet");
  assert.match(photoConsentLabel("granted"), /Yes/);
  assert.match(photoConsentLabel("refused"), /No/);

  // The wording is an ASK, not a notice of what already happens — and it must
  // say that declining is free. That sentence is what makes the consent valid.
  const text = photographyNoticeText("BHB International School");
  assert.match(text, /^I agree that BHB International School may use/);
  assert.match(text, /unticked is completely fine/i);
  assert.match(text, /makes no difference to my child/i);
  assert.match(text, /not sold/i);
  assert.match(text, /advertisers/i);
  // Still promises retrospective effect, and mayPublishMedia still honours it.
  assert.match(text, /already published/i);
  assert.equal(mayPublishMedia({ consentStatus: "withdrawn" }), false);

  // The enquiry form must not carry it: nobody is enrolled there.
  assert.doesNotMatch(dpdpNoticeText("BHB International School"), /photograph/i);

  console.log("photoConsent selftest: ok");
}

run();
