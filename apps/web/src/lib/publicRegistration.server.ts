/**
 * Config for the public /register page, resolved on the server from Supabase.
 *
 * /register is unauthenticated: the visitor's browser has no masters in
 * localStorage, and the server mirror is often cold for that request. Calling
 * loadMasters() there falls through to defaultMasters(), which mints fresh
 * random ids on every render — a parent then submits a classSoughtId that
 * resolves to no class, and the registration fee head / collections UPI are
 * equally invented. Resolve the real masters here instead, and fail closed
 * (no classes, no fee head) when the DB has nothing to serve.
 */

import {
  registrationFeeHeads,
  resolveSchoolCollectionsUpi,
} from "@/lib/admissions";
import type { MastersState } from "@/lib/masters";
import {
  deskBundleToMastersState,
  fetchMastersDeskFromDb,
} from "@/lib/mastersNormalized.server";
import {
  UNAVAILABLE_REGISTRATION_CONFIG,
  type PublicRegistrationConfig,
} from "@/lib/publicRegistration";

/**
 * masters_desk_slices is the only source of truth, and there is deliberately
 * no fallback. The school_mirror_state blob still holds the pre-re-seed
 * generation of class ids — 20260809110000_remap_blob_ids_to_desk_ids.sql
 * keeps it that way on purpose, because it is that migration's mapping
 * source. Serving those ids to a parent would recreate the exact orphaned
 * classSoughtId this module exists to prevent, so a cold or empty desk fails
 * closed instead.
 */
async function resolveMasters(): Promise<MastersState | null> {
  try {
    const { bundle } = await fetchMastersDeskFromDb();
    if (bundle.classes.length > 0) return deskBundleToMastersState(bundle);
  } catch (e) {
    console.warn("[publicRegistration] masters desk read failed", e);
  }
  return null;
}

export async function loadPublicRegistrationConfig(): Promise<PublicRegistrationConfig> {
  const masters = await resolveMasters();
  if (!masters) return UNAVAILABLE_REGISTRATION_CONFIG;

  const classes = (masters.classes ?? [])
    .filter((c) => c.isActive)
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((c) => ({ id: c.id, name: c.name }));

  const head = registrationFeeHeads(masters)[0];
  const { vpa, payeeName } = resolveSchoolCollectionsUpi(masters);

  return {
    classes,
    feeHead: head ? { id: head.id, name: head.name } : null,
    upi: { vpa, payeeName },
    source: "desk",
  };
}
