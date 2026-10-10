/**
 * Version check for a mark sheet write.
 *
 * A sheet's version is its `updatedAt`. The browser edits from the version
 * it last saw and sends that along; the server compares it with what is
 * stored and refuses the write when they differ, because someone else saved
 * in between. Kept free of server imports so the rule can be unit-tested.
 */

/** Are two stored timestamps the same instant? Postgres returns `+00:00`,
 * the browser stores `Z`; string equality would call every sheet stale. */
export function sameInstant(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a === b;
  return Math.abs(ta - tb) < 1;
}
