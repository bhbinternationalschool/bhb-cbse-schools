/**
 * Never save a desk this page has not loaded from the server (12 Oct 2026).
 *
 * Desks live in page memory and load per route. Until a desk loads, its
 * store hands out a placeholder — empty, or seeded defaults that look like
 * real data (default leave types, punch settings, salary structures…). A
 * save made from that copy carries no row versions/stamps and no known ids:
 * removals are never sent, edits are refused as "changed elsewhere", and
 * fields without versions (settings) are written straight over the real
 * ones. So a save before load is refused here: the desk is loaded, and the
 * person is told to make the change again on the real copy.
 *
 * Browser only, and only with a database — server writers and the offline
 * dev build save as before.
 */

import { hasDeskLoaded } from "@/lib/deskHydrateGuard";
import { isSupabaseConfigured } from "@/lib/supabase/client";

const lastNotice = new Map<string, number>();
const NOTICE_EVERY_MS = 20_000;

/** True = the save was refused (the caller returns without saving). */
export function refuseSaveBeforeLoad(module: string, load: () => Promise<unknown>): boolean {
  if (typeof window === "undefined" || !isSupabaseConfigured()) return false;
  if (hasDeskLoaded(module)) return false;
  const now = Date.now();
  if (now - (lastNotice.get(module) ?? 0) > NOTICE_EVERY_MS) {
    lastNotice.set(module, now);
    window.dispatchEvent(new CustomEvent("bhb-desk-not-loaded", { detail: { id: module } }));
  }
  void load();
  return true;
}
