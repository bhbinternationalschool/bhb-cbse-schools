/**
 * Bulk recipient lists for the owner broadcast action bar. Client-side only
 * — reads already-loaded local state, same as every other bulk-list helper
 * in this codebase (e.g. lib/playbook.ts's listLiveDefaulters). Opt-out
 * filtering happens server-side in the broadcast route (wa_contact_state is
 * Supabase-only), not here.
 */
import { loadSis, householdWhatsApp } from "@/lib/sis";
import { loadMasters } from "@/lib/masters";

/** Deduped WhatsApp numbers for every household with one on file. */
export function listAllHouseholdWaNumbers(): string[] {
  const sis = loadSis();
  const seen = new Set<string>();
  for (const hh of sis.households) {
    const mobile = householdWhatsApp(hh);
    if (mobile) seen.add(mobile);
  }
  return Array.from(seen);
}

/** Deduped mobiles for every active staff member. */
export function listAllStaffMobiles(): string[] {
  const masters = loadMasters();
  const seen = new Set<string>();
  for (const s of masters.staff ?? []) {
    if (s.status !== "active") continue;
    const mobile = (s.mobile || "").trim();
    if (mobile) seen.add(mobile);
  }
  return Array.from(seen);
}
