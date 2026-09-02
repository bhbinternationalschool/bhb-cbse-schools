/**
 * The photography notice is a PROMISE, and the code has to keep it.
 *
 * The website publishes a pupil's photograph on a blanket consent given
 * through the admission terms. That is only defensible while the terms
 * actually say so and the school can actually do what they say. This asserts
 * the two halves still agree: what the parent is told, and what
 * mayPublishMedia does.
 */
import assert from "node:assert/strict";
import { photographyNoticeText, dpdpNoticeText } from "@/lib/admissionsEnquiryForm";
import { mayPublishMedia } from "@/lib/website";

function run() {
  const text = photographyNoticeText("BHB International School");

  // Names the school, so a parent knows who is asking.
  assert.match(text, /BHB International School/);
  // Says what is taken and where it goes.
  assert.match(text, /photographs and video/i);
  assert.match(text, /website/i);
  // Says what will NOT happen. DPDP s.9 forbids targeted advertising to
  // children; silence on it invites the assumption.
  assert.match(text, /not sold/i);
  assert.match(text, /advertisers/i);
  // The refusal right, in plain words, with no price attached.
  assert.match(text, /tell the school office/i);
  assert.match(text, /need not give a reason/i);
  assert.match(text, /makes no difference to your child/i);

  // THE PROMISE: withdrawal reaches pictures already published. This is the
  // sentence the code has to honour.
  assert.match(text, /already published/i);
  assert.equal(
    mayPublishMedia({ consentStatus: "withdrawn" }),
    false,
    "the notice promises a withdrawal takes published pictures down — mayPublishMedia must refuse",
  );
  assert.equal(mayPublishMedia({ consentStatus: "granted" }), true);
  assert.equal(
    mayPublishMedia({ consentStatus: "pending" }),
    false,
    "silence is not consent",
  );

  // The two notices stay separate. The enquiry form must NOT carry the
  // photography wording: nobody is enrolled there and no photograph will be
  // taken, so consent collected would be for something that will not happen.
  const dpdp = dpdpNoticeText("BHB International School");
  assert.doesNotMatch(dpdp, /photograph/i, "the enquiry notice must not ask for photo consent");

  console.log("photographyNotice selftest: ok");
}

run();
