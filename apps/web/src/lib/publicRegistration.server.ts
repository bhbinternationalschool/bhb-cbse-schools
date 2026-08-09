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
import type { SchoolMirrorBundle } from "@/lib/schoolDataMirror";
import { fetchServerBlob } from "@/lib/serverBlob";

/**
 * masters_desk_slices is the source of truth; the school_mirror_state blob is
 * the pre-cutover fallback. Neither is ever replaced by generated defaults.
 */
async function resolveMasters(): Promise<{
  masters: MastersState;
  source: "desk" | "mirror";
} | null> {
  try {
    const { bundle } = await fetchMastersDeskFromDb();
    if (bundle.classes.length > 0) {
      return { masters: deskBundleToMastersState(bundle), source: "desk" };
    }
  } catch (e) {
    console.warn("[publicRegistration] masters desk read failed", e);
  }

  try {
    const blob = await fetchServerBlob<SchoolMirrorBundle>(
      "school_mirror_state",
    );
    const masters = blob.state?.masters as MastersState | null;
    if (masters && (masters.classes?.length ?? 0) > 0) {
      return { masters, source: "mirror" };
    }
  } catch (e) {
    console.warn("[publicRegistration] mirror blob read failed", e);
  }

  return null;
}

export async function loadPublicRegistrationConfig(): Promise<PublicRegistrationConfig> {
  const resolved = await resolveMasters();
  if (!resolved) return UNAVAILABLE_REGISTRATION_CONFIG;
  const { masters, source } = resolved;

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
    source,
  };
}
