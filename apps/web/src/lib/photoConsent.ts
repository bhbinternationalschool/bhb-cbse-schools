/**
 * May the school publish a photograph of this family's child?
 *
 * The school moved from a BLANKET consent buried in the admission terms to a
 * SEPARATE, OPTIONAL tick on the registration form (2026-09-02). The
 * difference is not cosmetic. Under the DPDP Act 2023 consent must be free,
 * specific, informed and unambiguous, and for a child it must come from the
 * parent. A tick the family cannot register without is hard to call free; a
 * tick they can leave alone, with nothing riding on it, is the real thing.
 *
 * The consequence that matters and must never be softened:
 *
 *      SILENCE IS NOT CONSENT.
 *
 * A family who was never asked, or who left the box alone, has not agreed.
 * The old model defaulted a pupil photograph to `granted` and relied on
 * someone objecting; opt-in inverts that, so an unanswered family's picture
 * is simply not publishable. Every state below is therefore explicit — there
 * is no branch where "we don't know" becomes "yes".
 */

import type { ConsentStatus } from "@/lib/website";

/**
 * What one family has actually said.
 *
 * `""` is NOT-ASKED and is a real, distinct answer: it is how the school
 * knows to ask, and it must never be recorded as a refusal either. Same
 * convention as the household's communication preferences, which already
 * warn that a fallback must not be stored as the family's choice.
 */
export type PhotoConsent = "" | "granted" | "refused";

export function normalizePhotoConsent(v: unknown): PhotoConsent {
  return v === "granted" || v === "refused" ? v : "";
}

/**
 * The consent status a photograph of this family's child carries.
 *
 * Deliberately total, and deliberately dull: three answers in, three out,
 * no default branch. A `switch` with a fallthrough is how "not asked" would
 * one day quietly become "granted" again.
 */
export function mediaConsentForHousehold(answer: PhotoConsent): ConsentStatus {
  switch (answer) {
    case "granted":
      return "granted";
    case "refused":
      // `withdrawn` is the status the renderer already refuses everywhere,
      // including on pages the picture was placed on earlier. A family that
      // says no at registration gets exactly the same protection as one that
      // objects later — the timing of the refusal changes nothing.
      return "withdrawn";
    default:
      return "pending";
  }
}

/** What to show the office, so nobody has to interpret an empty string. */
export function photoConsentLabel(answer: PhotoConsent): string {
  switch (answer) {
    case "granted":
      return "Yes — photographs may be used";
    case "refused":
      return "No — do not use photographs";
    default:
      return "Not asked yet";
  }
}

/**
 * Whether a photograph may be published, from the family's answer alone.
 *
 * A convenience over mediaConsentForHousehold for callers that only want the
 * yes/no. Kept as one expression of the rule rather than two, so the two can
 * never disagree.
 */
export function mayPublishForHousehold(answer: PhotoConsent): boolean {
  return mediaConsentForHousehold(answer) === "granted";
}
