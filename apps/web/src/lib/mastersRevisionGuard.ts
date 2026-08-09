/**
 * Optimistic locking for the masters push — Phase 1 pilot of the
 * server-authoritative data layer (docs/ENTERPRISE_UPGRADE_PLAN.md).
 *
 * The overwrite guard (mastersWriteGuard.ts) stops a client replacing the
 * class-id generation wholesale. This guard closes the remaining hole: two
 * devices holding the SAME generation, where the second push silently
 * overwrites the first (last-write-wins). The client sends the desk
 * revision it hydrated at (`baseUpdatedAt`); a push whose base no longer
 * matches the stored revision is refused as stale, and the client
 * rehydrates instead of clobbering the newer state.
 *
 * Follows the sis_push_guarded rollout rule: a missing base is allowed
 * (deployed browsers predating this change must keep saving) but reported,
 * so enforcement can tighten once legacy clients drain.
 *
 * Revisions are instants, not strings: the client's base comes back from a
 * JSON API while the stored value round-trips through timestamptz, so the
 * same moment arrives spelled differently ("...Z" vs "...+00:00").
 * Comparison is by epoch milliseconds. Unparseable input degrades to the
 * unversioned path rather than locking a tenant out of saving.
 *
 * Pure and import-free so it can be exercised directly; see
 * mastersRevisionGuard.selftest.ts.
 */

export type MastersRevisionVerdict =
  | { allow: true; reason: "bootstrap" | "unversioned" | "match" }
  | { allow: false; reason: "stale"; storedUpdatedAt: string; message: string };

export function guardMastersRevision(
  baseUpdatedAt: string | null | undefined,
  storedUpdatedAt: string | null | undefined,
): MastersRevisionVerdict {
  const stored = (storedUpdatedAt ?? "").trim();
  // Nothing stored yet — first write for this tenant; nothing to protect.
  if (!stored) return { allow: true, reason: "bootstrap" };

  const base = (baseUpdatedAt ?? "").trim();
  if (!base) return { allow: true, reason: "unversioned" };

  const baseMs = Date.parse(base);
  const storedMs = Date.parse(stored);
  if (!Number.isFinite(baseMs) || !Number.isFinite(storedMs)) {
    return { allow: true, reason: "unversioned" };
  }

  if (baseMs === storedMs) return { allow: true, reason: "match" };

  return {
    allow: false,
    reason: "stale",
    storedUpdatedAt: stored,
    message:
      "Masters changed on another device after this one loaded them. " +
      "Refusing the save so the newer version is not overwritten — " +
      "the screen will refresh with the current data; re-apply your change.",
  };
}
