/**
 * Which academic year is it? Answered from the calendar, not from a flag.
 *
 * Stage 3 of the server-authoritative migration. The rule the ERP needs is
 * that a session which has ended cannot still be "current": 2025-26 ended on
 * 2026-03-31, and the school ran four months past that inside it, because
 * nothing ever compared the year to today's date.
 *
 * Dates decide. `status` is honoured only as a deliberate override, and only
 * when it does not contradict the calendar — a year marked `current` whose
 * `endsOn` has passed is a stale flag someone forgot to move, which is exactly
 * what happened here. Disagreements are reported rather than silently
 * resolved, because either answer can be the right one and only a human knows
 * which.
 *
 * When no year covers today the answer is `null`. That is a real state — the
 * next year has not been created yet — and it must reach a setup screen, not
 * be papered over with a guess. See [[erp-unknown-must-not-become-fact]]:
 * DEFAULT_AY standing in for "I don't know" is what put a fabricated year into
 * the signed session cookie on 2026-08-10.
 *
 * Deliberate deviation from the plan: the plan promotes the typed
 * `academic_years` table to system of record. That table belongs to the
 * abandoned relational schema the director chose to leave alone (it holds 0
 * rows and has no code references), so `masters_desk_academic_years` is the
 * system of record instead. Same outcome, one schema.
 */

export type AcademicYearInput = {
  code: string;
  startsOn?: string | null;
  endsOn?: string | null;
  status?: string | null;
  isActive?: boolean | null;
};

export type AcademicYearResolution = {
  /** The year to use, or null when today falls outside every defined year. */
  code: string | null;
  reason:
    | "date" // today falls inside this year
    | "status" // no year covers today, but one is explicitly marked current
    | "none"; // nothing covers today and nothing is marked current
  /**
   * Set when the calendar and the `status` flag disagree. Both values are
   * carried so the caller can show the choice rather than pick silently.
   */
  conflict?: { byDate: string; byStatus: string; message: string };
};

/** Inclusive, date-only comparison. Avoids timezone drift on ISO timestamps. */
function coversDay(y: AcademicYearInput, today: string): boolean {
  const from = (y.startsOn ?? "").slice(0, 10);
  const to = (y.endsOn ?? "").slice(0, 10);
  if (!from || !to) return false;
  return from <= today && today <= to;
}

/**
 * Resolve the active academic year.
 *
 * `today` is passed in rather than read from the clock so this is testable and
 * so a server can resolve on its own date rather than a browser's — a phone
 * with a skewed clock must not be able to change the school's session.
 */
export function resolveAcademicYear(
  years: readonly AcademicYearInput[] | null | undefined,
  today: string,
): AcademicYearResolution {
  const active = (years ?? []).filter((y) => y.isActive !== false && !!y.code);
  if (active.length === 0) return { code: null, reason: "none" };

  const day = today.slice(0, 10);
  const byDate = active.find((y) => coversDay(y, day))?.code ?? null;
  const byStatus =
    active.find((y) => (y.status ?? "").toLowerCase() === "current")?.code ?? null;

  if (byDate) {
    if (byStatus && byStatus !== byDate) {
      return {
        code: byDate,
        reason: "date",
        conflict: {
          byDate,
          byStatus,
          message:
            `The calendar says ${byDate} (today is ${day}), but ${byStatus} is ` +
            `still marked "current" in Masters. Using ${byDate}. Update the ` +
            `status in Masters to make this deliberate.`,
        },
      };
    }
    return { code: byDate, reason: "date" };
  }

  // Nothing covers today: between sessions, or next year not created yet.
  // An explicit `current` is the best available answer, but it is a flag and
  // not a fact, so it is reported as such.
  if (byStatus) return { code: byStatus, reason: "status" };

  return { code: null, reason: "none" };
}

/**
 * The year to use for a session when resolution is inconclusive.
 *
 * Derived from what Masters actually defines — the latest year by start date —
 * never a hardcoded constant. DEFAULT_AY ("2025-26") was the hardcoded answer,
 * and it stayed correct-looking for a year and then quietly wasn't: the school
 * ran four months inside a session that had ended.
 *
 * Returns null when Masters defines no years at all. That is not a case to
 * paper over: a school with no academic year cannot scope a single query, and
 * the honest response is to say so.
 */
export function fallbackAcademicYear(
  years: readonly AcademicYearInput[] | null | undefined,
): string | null {
  const active = (years ?? []).filter((y) => y.isActive !== false && !!y.code);
  if (active.length === 0) return null;
  return active
    .slice()
    .sort((a, b) =>
      (b.startsOn ?? "").localeCompare(a.startsOn ?? "") ||
      b.code.localeCompare(a.code),
    )[0]!.code;
}
