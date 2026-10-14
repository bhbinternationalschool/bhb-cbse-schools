/**
 * Office QR screens — which are real devices and which are leftovers
 * (director, 14 Oct 2026: "the 'Office tablet' entry keeps growing daily").
 *
 * A screen is OLD when nothing has used it for 7 days, or when it has not
 * been seen for a day and a screen with the same name was switched on after
 * it was last used — the same tablet, switched on again. A screen seen in
 * the last 24 hours is never old: two real tablets with one name both stay.
 */

export type PunchScreenRow = {
  id: string;
  label: string;
  created_at: string;
  last_seen_at: string | null;
};

export const DAY_MS = 24 * 60 * 60_000;
export const UNUSED_AFTER_MS = 7 * DAY_MS;

/** When the screen was last used — never seen counts from when it was made. */
export function lastActivityMs(s: PunchScreenRow): number {
  const seen = s.last_seen_at ? Date.parse(s.last_seen_at) : NaN;
  const made = Date.parse(s.created_at);
  return Number.isFinite(seen) ? Math.max(seen, made || 0) : made || 0;
}

const sameLabel = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** True when nobody needs this screen any more (see the header). */
export function isOldScreen(s: PunchScreenRow, all: PunchScreenRow[], nowMs: number): boolean {
  const last = lastActivityMs(s);
  if (nowMs - last < DAY_MS) return false;
  if (nowMs - last >= UNUSED_AFTER_MS) return true;
  return all.some((o) => o.id !== s.id && sameLabel(o.label, s.label) && Date.parse(o.created_at) > last);
}

/** The office's list: screens in use first, leftovers apart. */
export function splitScreens<T extends PunchScreenRow>(rows: T[], nowMs: number): { inUse: T[]; old: T[] } {
  const inUse: T[] = [];
  const old: T[] = [];
  for (const r of rows) (isOldScreen(r, rows, nowMs) ? old : inUse).push(r);
  const byRecent = (a: T, b: T) => lastActivityMs(b) - lastActivityMs(a);
  return { inUse: inUse.sort(byRecent), old: old.sort(byRecent) };
}

/**
 * Switching on a screen named `label`: the other screens with that name.
 * Nothing is switched off for this — a second real tablet with the same name,
 * idle over a holiday, looks exactly like a leftover. The panel only offers
 * them to an admin, who confirms (review of #637).
 */
export function sameNameScreens<T extends PunchScreenRow>(rows: T[], label: string, newId: string): T[] {
  return rows
    .filter((r) => r.id !== newId && sameLabel(r.label, label))
    .sort((a, b) => lastActivityMs(b) - lastActivityMs(a));
}
