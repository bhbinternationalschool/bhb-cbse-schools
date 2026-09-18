/**
 * Self-test: the app-store review login opens exactly one door, and both
 * halves of the login agree about it.
 * Run: npx tsx apps/web/src/lib/reviewLogin.selftest.ts
 *
 * Play rejected version 12 on 17 Sep 2026 saying the login credentials were
 * wrong. They were not. The review bypass lived only in /api/auth/otp/verify;
 * the reviewer's FIRST tap goes to /api/auth/otp/request, which tried to send
 * a real WhatsApp OTP to a fictional number and returned 502 when that send
 * failed. `parent_otp_codes` had never held a single row for that number, so
 * the step had never once completed in production.
 *
 * The two properties that have to hold together:
 *
 *  1. The request route skips the WhatsApp send for the review mobile — so the
 *     reviewer can never be stranded by Meta refusing a message.
 *  2. Knowing that mobile grants NOTHING on its own. A session still needs the
 *     fixed code, and the whole mechanism stays off unless all three env vars
 *     are set — a half-configured environment must not open a login that skips
 *     verification.
 */

import assert from "node:assert/strict";

import {
  readReviewLogin,
  isReviewLoginMobile,
  isReviewLoginPair,
} from "./reviewLogin.server";

const FULL = {
  REVIEW_LOGIN_MOBILE: "9000000001",
  REVIEW_LOGIN_CODE: "183771",
  REVIEW_LOGIN_HOUSEHOLD_ID: "hh_zzdemo01",
} as unknown as NodeJS.ProcessEnv;

// 1. Configured: the reviewer's first tap is recognised, and the pair signs in.
assert.deepEqual(readReviewLogin(FULL), {
  mobile: "9000000001",
  code: "183771",
  householdId: "hh_zzdemo01",
});
assert.equal(isReviewLoginMobile("9000000001", FULL), true);
assert.equal(isReviewLoginPair("9000000001", "183771", FULL), true);

// Whitespace from a form field must not defeat either check.
assert.equal(isReviewLoginMobile("  9000000001 ", FULL), true);
assert.equal(isReviewLoginPair(" 9000000001", "183771 ", FULL), true);

// 2. The mobile alone is not a credential — the wrong code stays out.
assert.equal(isReviewLoginPair("9000000001", "000000", FULL), false);
assert.equal(isReviewLoginPair("9000000001", "", FULL), false);

// 3. A real parent's number is untouched by any of this.
assert.equal(isReviewLoginMobile("9876543210", FULL), false);
assert.equal(isReviewLoginPair("9876543210", "183771", FULL), false);

// 4. Half-configured is OFF — every subset must refuse, or a missing env var
//    would leave a code-free login open on some environment.
for (const missing of [
  "REVIEW_LOGIN_MOBILE",
  "REVIEW_LOGIN_CODE",
  "REVIEW_LOGIN_HOUSEHOLD_ID",
] as const) {
  const partial = { ...FULL } as Record<string, string | undefined>;
  delete partial[missing];
  const env = partial as unknown as NodeJS.ProcessEnv;
  assert.equal(readReviewLogin(env), null, `${missing} missing must disable it`);
  assert.equal(isReviewLoginMobile("9000000001", env), false);
  assert.equal(isReviewLoginPair("9000000001", "183771", env), false);
}

// 5. Empty strings count as unset — an env var set to "" is not configuration.
const blank = {
  REVIEW_LOGIN_MOBILE: "9000000001",
  REVIEW_LOGIN_CODE: "   ",
  REVIEW_LOGIN_HOUSEHOLD_ID: "hh_zzdemo01",
} as unknown as NodeJS.ProcessEnv;
assert.equal(readReviewLogin(blank), null);
assert.equal(isReviewLoginPair("9000000001", "   ", blank), false);

// 6. Unconfigured (the default everywhere except production) is fully off.
const none = {} as NodeJS.ProcessEnv;
assert.equal(readReviewLogin(none), null);
assert.equal(isReviewLoginMobile("9000000001", none), false);
assert.equal(isReviewLoginPair("9000000001", "183771", none), false);

console.log("reviewLogin.selftest: all checks passed");
