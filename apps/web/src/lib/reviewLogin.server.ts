/**
 * App-store review access — one place that decides what a reviewer may skip.
 *
 * Google Play and App Store reviewers cannot receive a WhatsApp OTP: the
 * number listed in the store's "Sign in details" is a fictional one, and no
 * phone answers it. So a fixed mobile+code pair signs into one designated
 * demonstration household.
 *
 * Both halves of the login have to know about it, and until now only one did.
 * `/api/auth/otp/verify` accepted the fixed code, but `/api/auth/otp/request`
 * — the reviewer's FIRST tap — still tried to send a real WhatsApp message and
 * returned 502 when that send failed. A reviewer who cannot get past "Send
 * OTP" rejects the app, which is exactly what happened on 17 Sep 2026.
 *
 * The three env vars are read together and the whole mechanism stays off
 * unless all three are set, so a half-configured environment cannot open a
 * login that skips verification.
 */

export type ReviewLogin = {
  mobile: string;
  code: string;
  householdId: string;
};

/** The configured review login, or null when any part is missing. */
export function readReviewLogin(env: NodeJS.ProcessEnv = process.env): ReviewLogin | null {
  const mobile = env.REVIEW_LOGIN_MOBILE?.trim();
  const code = env.REVIEW_LOGIN_CODE?.trim();
  const householdId = env.REVIEW_LOGIN_HOUSEHOLD_ID?.trim();
  if (!mobile || !code || !householdId) return null;
  return { mobile, code, householdId };
}

/**
 * Is this the review mobile? Used by the OTP *request* route to skip the
 * WhatsApp send — not to sign anyone in. Knowing the number alone grants
 * nothing: the code still has to match at verify.
 */
export function isReviewLoginMobile(
  mobile: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const review = readReviewLogin(env);
  return !!review && mobile.trim() === review.mobile;
}

/** Is this the review mobile AND its fixed code? Only this signs a session. */
export function isReviewLoginPair(
  mobile: string,
  code: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const review = readReviewLogin(env);
  return !!review && mobile.trim() === review.mobile && code.trim() === review.code;
}
