/**
 * Idle logout across every tab of one browser.
 *
 * The 30-minute idle logout (lib/workspaceSyncPolicy) used to run a separate
 * timer in each tab, and one tab's logout clears the session for all of them.
 * A Comms tab left open in the background therefore signed the director out
 * while they were keying vouchers in the Accounts tab — three saves refused
 * at 16:48 and two at 19:37 on 13 Oct 2026, each a few minutes after their
 * last entry.
 *
 * Every tab now records its activity in one shared place, and a tab whose own
 * timer runs out logs out only when NO tab has seen activity for the whole
 * period. The period itself is unchanged.
 */

export const WORKSPACE_LAST_ACTIVITY_KEY = "bhb-workspace-last-activity";

/** Writing the shared stamp on every mousemove would be wasteful; a few seconds of slack is invisible against 30 minutes. */
export const ACTIVITY_WRITE_THROTTLE_MS = 5_000;

/**
 * How long until this browser counts as idle, given the latest activity this
 * tab saw and the latest any tab recorded. 0 = log out now.
 *
 * A shared stamp from the future (another tab's clock is the same clock, but
 * a hand-edited or corrupt value is possible) never postpones logout beyond
 * one full period from now.
 */
export function idleRemainingMs(opts: {
  now: number;
  localLastActivity: number;
  sharedLastActivity: number | null;
  limitMs: number;
}): number {
  const { now, localLastActivity, limitMs } = opts;
  const shared =
    opts.sharedLastActivity != null && Number.isFinite(opts.sharedLastActivity)
      ? Math.min(opts.sharedLastActivity, now)
      : 0;
  const last = Math.max(localLastActivity, shared);
  return Math.max(0, last + limitMs - now);
}

/** The shared stamp, or null when storage is unavailable or holds nothing usable. */
export function readSharedLastActivity(storage: Pick<Storage, "getItem"> | null | undefined): number | null {
  try {
    const raw = storage?.getItem(WORKSPACE_LAST_ACTIVITY_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Record activity for every tab; storage failures leave this tab's own timer in charge. */
export function writeSharedLastActivity(
  storage: Pick<Storage, "setItem"> | null | undefined,
  at: number,
): void {
  try {
    storage?.setItem(WORKSPACE_LAST_ACTIVITY_KEY, String(at));
  } catch {
    /* private mode / quota: per-tab behaviour */
  }
}
