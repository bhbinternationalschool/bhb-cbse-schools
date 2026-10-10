/**
 * May this receipt be dated earlier than today?
 *
 * The two surfaces disagreed completely before this existed. The web counter
 * had a free date box — any date at all, past or future, the only block being
 * a day that had already been day-closed. The mobile app had no date field and
 * hard-coded today, so money handed over on Saturday could not be recorded as
 * Saturday. One of them was too loose and the other too tight, and neither was
 * the school's decision.
 *
 * Now it is a Masters setting, and this is the single rule both surfaces and
 * the server ask. Keeping it here, pure and self-tested, is the point: a rule
 * about dating money that lives in three places will eventually mean three
 * different things.
 *
 * What is NOT negotiable, whatever the setting says:
 *   - no future dates — a receipt cannot record money not yet taken;
 *   - no dates inside a closed day — that is the day-close's job;
 *   - nothing before the running session began, because a receipt landing in
 *     last year's closed book will never reconcile against it.
 */

export type FeeBackdatePolicy = {
  /**
   * May ordinary counter staff date a receipt earlier than today?
   *
   * Off by default. Owner, admin and principal can back-date either way —
   * this decides whether everybody else can too. Off is the honest default
   * for a school that has not thought about it yet: same-day only is the
   * behaviour nobody has to audit.
   */
  allowForAllStaff: boolean;
};

export const DEFAULT_FEE_BACKDATE_POLICY: FeeBackdatePolicy = {
  allowForAllStaff: false,
};

export function normalizeFeeBackdatePolicy(
  raw?: Partial<FeeBackdatePolicy> | null,
): FeeBackdatePolicy {
  return {
    allowForAllStaff: raw?.allowForAllStaff === true,
  };
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export type BackdateVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Which collections this rule governs.
 *
 * Only the ones a person types. A `payment_link` receipt carries the date the
 * gateway says the parent paid, which can legitimately be days old when a
 * webhook is replayed or a settlement is reconciled late — refusing it would
 * reject real money over a policy about data entry.
 */
export function backdatePolicyApplies(source: string | undefined): boolean {
  return source === undefined || source === "counter" || source === "manual_book";
}

export function feeBackdateVerdict(input: {
  /** The date the receipt will carry. */
  collectionDate: string;
  /** Today, in the school's own timezone — never `new Date()` inside here. */
  today: string;
  /** 1 April of the running session. */
  sessionStartOn: string;
  policy: FeeBackdatePolicy;
  /** Owner, admin or principal — may back-date whatever the setting says. */
  mayOverride: boolean;
  /** That date has a submitted or approved day-close. */
  dayClosed?: boolean;
}): BackdateVerdict {
  const date = (input.collectionDate || "").trim();
  if (!YMD.test(date)) {
    return { ok: false, reason: "Enter a collection date as YYYY-MM-DD" };
  }
  if (!YMD.test(input.today)) {
    // Refusing is the safe branch: without a trustworthy "today" there is no
    // way to tell a back-date from a same-day receipt.
    return { ok: false, reason: "Cannot establish today's date" };
  }

  if (date > input.today) {
    return {
      ok: false,
      reason: "A receipt cannot be dated in the future — money is not taken yet",
    };
  }
  if (input.dayClosed) {
    return {
      ok: false,
      reason: `Day ${date} is already closed — reopen the day-close or pick another date`,
    };
  }
  if (date === input.today) return { ok: true };

  // Everything below is a genuine back-date.
  if (YMD.test(input.sessionStartOn) && date < input.sessionStartOn) {
    return {
      ok: false,
      reason:
        `${date} is before the running session began (${input.sessionStartOn}). ` +
        "A receipt in a closed session will not reconcile against its book.",
    };
  }
  if (input.policy.allowForAllStaff || input.mayOverride) return { ok: true };
  return {
    ok: false,
    reason:
      "Back-dated receipts are switched off for this school. " +
      "Use today's date, or ask the principal, admin or owner to enter it.",
  };
}

/**
 * The earliest date the picker should offer, so the counter is told the limit
 * before it types rather than after. Returns "" when nothing is allowed
 * earlier than today, which the caller reads as "pin the field to today".
 */
export function earliestCollectionDate(input: {
  today: string;
  sessionStartOn: string;
  policy: FeeBackdatePolicy;
  mayOverride: boolean;
}): string {
  if (!input.policy.allowForAllStaff && !input.mayOverride) return input.today;
  return YMD.test(input.sessionStartOn) ? input.sessionStartOn : input.today;
}
