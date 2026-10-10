/**
 * Refusing a push that would delete most of a desk.
 *
 * On 18 Sep 2026 the exam papers desk went from 80 papers and 2,097 banked
 * questions to a single empty paper, one minute after a script had filled it.
 * Nothing was wrong with the script: somebody pressed "New paper" in a browser
 * whose local copy of that desk had never loaded, and the push replaced the
 * slice with the one paper that tab knew about. The same shape took out the
 * transport desk in August and the fee receipt lines twice in September.
 *
 * `pushDeskSliceToDb` already refuses a payload that carries *no* slice keys —
 * "unknown is not empty". That does not help here. This payload carried
 * `papers: [one paper]`, an explicit array, which is exactly what a real edit
 * looks like. The difference between an edit and an accident is not the shape
 * of the payload; it is the **size of the drop**.
 *
 * So: a push that removes most of what a desk holds is refused unless the
 * caller says it means it. Deleting a paper, a rule, a row — anything of
 * ordinary size — passes untouched, because the rule only fires when a large
 * share disappears at once.
 *
 * This is deliberately a blunt instrument. It cannot tell a genuine "clear out
 * last year" from an accident, so it refuses both and names the way through.
 * Losing a school's work silently is far worse than making a rare bulk delete
 * say so out loud.
 */

/** Below this many rows lost, nothing is refused: small desks edit freely. */
export const SHRINK_MIN_ROWS_LOST = 20;
/** Above this share of the desk disappearing at once, a push must be meant. */
export const SHRINK_MAX_SHARE_LOST = 0.5;

export type ShrinkVerdict = {
  /** The push may proceed. */
  ok: boolean;
  /** Why it was refused, phrased for whoever has to act on it. */
  reason?: string;
  /** What the numbers were, for the log. */
  storedRows?: number;
  incomingRows?: number;
};

/**
 * @param storedRows   rows the desk currently holds, from its sync meta.
 *                     Negative or zero means unknown or empty — never refuse,
 *                     because a first write has nothing to compare against.
 * @param incomingRows rows this push would leave behind.
 * @param allowShrink  the caller has said it means to delete this much.
 */
export function judgeDeskShrink(
  storedRows: number,
  incomingRows: number,
  allowShrink = false,
): ShrinkVerdict {
  if (allowShrink) return { ok: true };
  if (!Number.isFinite(storedRows) || storedRows <= 0) return { ok: true };
  if (!Number.isFinite(incomingRows) || incomingRows < 0) return { ok: true };

  const lost = storedRows - incomingRows;
  if (lost <= 0) return { ok: true };
  if (lost < SHRINK_MIN_ROWS_LOST) return { ok: true };

  const share = lost / storedRows;
  if (share <= SHRINK_MAX_SHARE_LOST) return { ok: true };

  return {
    ok: false,
    storedRows,
    incomingRows,
    reason:
      `Refusing to sync: this would leave ${incomingRows} of ${storedRows} rows, ` +
      `deleting ${lost} (${Math.round(share * 100)}%). A desk usually shrinks ` +
      `this much because the browser pushing it never loaded what was already ` +
      `there — reload the page and try again. If the deletion is meant, repeat ` +
      `it with allowShrink.`,
  };
}
