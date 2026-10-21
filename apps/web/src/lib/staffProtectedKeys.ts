/**
 * The protected keys of a staff record (sis_staff.profile), as plain
 * constants — imported by the collection registry (answer redaction) and by
 * lib/staffProtectedFields (the rules). Data-layer 2.2b; see that file.
 */

/** Must equal `_sis_staff_sensitive_keys()` in SQL (asserted by the self-test). */
export const STAFF_SENSITIVE_PROFILE_KEYS = [
  "bankName",
  "bankBranch",
  "bankAccountNo",
  "bankIfsc",
  "bankAccountName",
  "upiId",
  "aadhaarNo",
  "panNo",
  "basicPay",
  "visitingPay",
] as const;

export const STAFF_LOGIN_PROFILE_KEYS = ["loginUsername", "loginPassword"] as const;

/** Never leaves the server in any answer (list, conflict, anything). */
export const STAFF_NEVER_SENT_PROFILE_KEYS = ["loginPassword"] as const;

/**
 * Removed from every CONFLICT answer (`stored`) for sis_staff: the stored row
 * goes back to whoever's write was refused — which may be anyone with
 * staff · edit — so it carries none of these (review of 2.2a, item 1).
 */
export const STAFF_ANSWER_REDACTED_PROFILE_KEYS = [
  ...STAFF_SENSITIVE_PROFILE_KEYS,
  ...STAFF_LOGIN_PROFILE_KEYS,
] as const;

