/**
 * How desk masters combine with the older blob copy on the server.
 *
 * Kept in its own module (no server-only imports) so the rule can be
 * tested directly — it decides what the server believes a class id is,
 * and getting it wrong silently reintroduces the dead-id bug that this
 * whole repair was about.
 */

import type { MastersState } from "@/lib/masters";

/**
 * Desk masters win, slice by slice — but only where the desk actually
 * has that slice. masters_desk_slices carries no staff, students,
 * departments or designations (staff is merged in separately, from its
 * own tables), so replacing the blob masters wholesale would blank them.
 * An empty desk slice therefore leaves the blob's copy alone.
 */
export function mergeDeskMastersOverBlob(
  blob: MastersState | null,
  desk: MastersState,
): MastersState {
  if (!blob) return desk;
  const merged: MastersState = { ...blob, version: desk.version };
  for (const key of Object.keys(desk) as (keyof MastersState)[]) {
    if (key === "version") continue;
    const value = desk[key];
    const hasValue = Array.isArray(value)
      ? value.length > 0
      : value !== null && value !== undefined;
    if (hasValue) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}
