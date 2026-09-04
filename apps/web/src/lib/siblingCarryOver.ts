/**
 * When a second child of the same family is admitted, the office should not
 * type the parents' details again.
 *
 * The address, the email, the parents' Aadhaar and PAN, their occupation —
 * these are facts about the PARENTS, not about the child. A family with three
 * children at the school has one address and one father's Aadhaar, and typing
 * it three times produces three chances to get it wrong and no way to tell
 * which is right.
 *
 * Two rules make this safe rather than merely convenient.
 *
 * 1. NEVER OVERWRITE. Only a blank field is filled. Whatever the office typed
 *    on this child's form is what they meant; an inherited value must never
 *    quietly replace it.
 *
 * 2. PARENT-LEVEL FACTS ONLY. The child's own Aadhaar, DOB, PEN, photograph
 *    and category belong to that child alone. Copying a sibling's identity
 *    number onto a new child would be a fabricated record, not a convenience,
 *    and it would travel into UDISE and RTE claims where nobody would catch
 *    it.
 *
 * On confidence: the trustworthy signal is not a name match, it is that the
 * child is joining a household the school ALREADY holds. That decision has
 * been made — by a mobile match or an explicit sibling link — before this runs.
 * Two families in one village really can share both parent names, and a wrong
 * address is visible and harmless where a wrong Aadhaar is neither. So
 * identity numbers cross only on a household link, never on names alone.
 */

/** Facts about the parents, safe to share between their children. */
export const PARENT_LEVEL_FIELDS = [
  "fatherAadhaarLast4",
  "motherAadhaarLast4",
  "fatherAadhaarNumber",
  "motherAadhaarNumber",
  "fatherPan",
  "motherPan",
  "fatherOccupation",
  "motherOccupation",
  "fatherQualification",
  "motherQualification",
  "fatherPhotoUrl",
  "motherPhotoUrl",
  "motherTongue",
  "religion",
] as const;

/**
 * Identity numbers. They are parent-level too, but they only cross on a
 * household link — see the note above about names in a village.
 */
export const IDENTITY_FIELDS = new Set<string>([
  "fatherAadhaarLast4",
  "motherAadhaarLast4",
  "fatherAadhaarNumber",
  "motherAadhaarNumber",
  "fatherPan",
  "motherPan",
]);

/**
 * Fields that must NEVER be carried, listed so the omission is deliberate
 * rather than an oversight. Each is about the CHILD.
 */
export const NEVER_CARRY = [
  "aadhaarNumber",
  "aadhaarLast4",
  "aadhaarVerification",
  "dob",
  "gender",
  "photoUrl",
  "penStatus",
  "penNumber",
  "admissionNo",
  "srn",
  "classId",
  "sectionId",
  "rollNo",
] as const;

export type CarryConfidence =
  /** Same household — the school has already decided these are one family. */
  | "household"
  /** Both parent names match, but nothing corroborates it. */
  | "names_only";

export type CarriedField = { field: string; from: string };

export type CarryResult<T> = {
  /** The draft with blanks filled in. */
  student: T;
  /** What was inherited and from which sibling — for the office to see. */
  carried: CarriedField[];
  /** Identity numbers deliberately NOT carried, and why. */
  withheld: string[];
};

function blank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

/**
 * Fill this child's blank parent-level fields from a sibling already on roll.
 *
 * `siblings` should be that family's active students, most recently updated
 * first — the newest record is the one the office has looked at most lately,
 * and so the one most likely to be right.
 */
export function carryOverFromSibling<T extends Record<string, unknown>>(input: {
  student: T;
  siblings: Record<string, unknown>[];
  confidence: CarryConfidence;
}): CarryResult<T> {
  const carried: CarriedField[] = [];
  const withheld: string[] = [];
  const next: Record<string, unknown> = { ...input.student };

  for (const field of PARENT_LEVEL_FIELDS) {
    if (!blank(next[field])) continue;

    const donor = input.siblings.find((s) => !blank(s[field]));
    if (!donor) continue;

    if (IDENTITY_FIELDS.has(field) && input.confidence !== "household") {
      // A name match is a hint, not an identification. Say what was held
      // back rather than filling it and hoping.
      withheld.push(field);
      continue;
    }

    next[field] = donor[field];
    carried.push({
      field,
      from: String(donor.fullName ?? donor.admissionNo ?? donor.id ?? "sibling"),
    });
  }

  return { student: next as T, carried, withheld };
}

/**
 * A line for the student's notes, so an inherited value is never mistaken for
 * one somebody checked.
 */
export function carryOverNote(result: CarryResult<unknown>): string {
  if (result.carried.length === 0) return "";
  const from = [...new Set(result.carried.map((c) => c.from))].join(", ");
  const what = result.carried.map((c) => c.field).join(", ");
  return `Parent details copied from sibling record (${from}): ${what}. Check before relying on them.`;
}

/**
 * Where the family lives and how to reach them.
 *
 * Household-level, and the safest thing to inherit: an address that is wrong
 * is visible on the first letter that comes back, and it costs nothing but a
 * correction. That is why these cross on a NAME match while the identity
 * numbers above do not.
 *
 * Contact numbers are excluded on purpose. The mobile is how a family is
 * IDENTIFIED here — enrolment matches households on it — so copying one
 * between families would merge two records that are not the same family, and
 * send another household's fee reminders to the wrong phone.
 */
export const HOUSEHOLD_CARRY_FIELDS = [
  "email",
  "address",
  "locality",
  "landmark",
  "city",
  "state",
  "pincode",
] as const;

export function carryOverHousehold<T extends Record<string, unknown>>(input: {
  household: T;
  /** The matched family's household, if one was found. */
  donor: Record<string, unknown> | undefined;
}): { household: T; carried: string[] } {
  if (!input.donor) return { household: input.household, carried: [] };
  const next: Record<string, unknown> = { ...input.household };
  const carried: string[] = [];
  for (const field of HOUSEHOLD_CARRY_FIELDS) {
    if (!blank(next[field])) continue;
    if (blank(input.donor[field])) continue;
    next[field] = input.donor[field];
    carried.push(field);
  }
  return { household: next as T, carried };
}
