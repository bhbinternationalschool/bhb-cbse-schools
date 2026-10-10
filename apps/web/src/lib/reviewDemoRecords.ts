/**
 * The one family in this roster that is not a family.
 *
 * Google Play requires working demo credentials in the listing's App access
 * section, and re-checks them on EVERY update, not just the first — so the
 * household the review login signs into has to keep existing for as long as
 * the app is on Play. It cannot be a real family: a reviewer would be
 * looking at a real child's fees, attendance and photographs.
 *
 * So a fictional one lives in production SIS. What was missing is any way
 * for the ERP to know that, and on 2026-09-12 it was costing the school:
 *
 *   * ₹25,400 of dues nobody owes, in a cached open-dues figure of
 *     ₹12,32,369 — twenty due rows against a household with no receipts;
 *   * two students in every count, class list and report;
 *   * five failed WhatsApp sends to 9000000001, the last that same
 *     afternoon, until Meta marked the number as not on WhatsApp.
 *
 * The answer is not to delete the family — that breaks the next update's
 * review — but to say plainly which record it is, so everything that
 * REPORTS ON THE SCHOOL skips it while the parent app and the review login
 * carry on seeing it exactly as before. That is the one place it is meant
 * to exist.
 *
 * The marker is the record's own identity, not a flag somebody must
 * remember to set: the household code, and the admission-number prefix the
 * two children were seeded with. Both are visible to the browser and the
 * server alike, which a REVIEW_LOGIN_* env var is not.
 *
 * When the listing no longer needs a demo login, delete the family and
 * unset the three REVIEW_LOGIN_* variables; this module then matches
 * nothing and costs nothing.
 */

/** The household code the review family was seeded with. */
export const REVIEW_DEMO_HOUSEHOLD_CODE = "DEMO-REVIEW";

/** Admission numbers of the review family's children. */
export const REVIEW_DEMO_ADMISSION_PREFIX = "BHB-DEMO-";

export function isReviewDemoHousehold(hh: { code?: string | null } | null | undefined): boolean {
  return (hh?.code || "").trim().toUpperCase() === REVIEW_DEMO_HOUSEHOLD_CODE;
}

export function isReviewDemoStudent(s: { admissionNo?: string | null } | null | undefined): boolean {
  return (s?.admissionNo || "").trim().toUpperCase().startsWith(REVIEW_DEMO_ADMISSION_PREFIX);
}

/**
 * Household ids belonging to the review family, from a roster.
 *
 * Taken from the households AND from the children, so a child seeded with a
 * demo admission number is still recognised if the household code were ever
 * edited — and so that a reader holding only students can filter too.
 */
export function reviewDemoHouseholdIds(state: {
  households?: { id: string; code?: string | null }[];
  students?: { householdId?: string | null; admissionNo?: string | null }[];
}): Set<string> {
  const ids = new Set<string>();
  for (const h of state.households ?? []) if (isReviewDemoHousehold(h)) ids.add(h.id);
  for (const s of state.students ?? []) {
    if (isReviewDemoStudent(s) && s.householdId) ids.add(s.householdId);
  }
  return ids;
}

/**
 * The roster as the school should be reported on: the review family removed.
 *
 * Never use this for the parent app, the review login, or anything that
 * answers "show me THIS household" — only for counts, money, call lists and
 * outbound audiences.
 */
export function withoutReviewDemo<
  H extends { id: string; code?: string | null },
  S extends { householdId?: string | null; admissionNo?: string | null },
>(state: { households?: H[]; students?: S[] }): { households: H[]; students: S[] } {
  const demo = reviewDemoHouseholdIds(state);
  return {
    households: (state.households ?? []).filter((h) => !demo.has(h.id)),
    students: (state.students ?? []).filter(
      (s) => !isReviewDemoStudent(s) && !(s.householdId && demo.has(s.householdId)),
    ),
  };
}
