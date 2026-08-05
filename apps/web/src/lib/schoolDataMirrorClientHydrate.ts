/**
 * Pull school mirror from server BEFORE pushing local seed data.
 * Fixes new-browser overwrite of Supabase masters/SIS/fees.
 */

import { fetchSchoolMirror } from "@/lib/schoolDataMirror";

const META_KEY = "bhb_client_mirror_hydrate_v1";
let hydratedOnce = false;

function readMeta(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return "";
    return String((JSON.parse(raw) as { updatedAt?: string }).updatedAt || "");
  } catch {
    return "";
  }
}

function writeMeta(updatedAt: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(META_KEY, JSON.stringify({ updatedAt }));
}

/**
 * Pull mirror slices when remote is newer or local desk is empty.
 * Call once on AppShell mount before pushFullSchoolMirrorToServer.
 */
export async function ensureClientSchoolMirrorHydrated(): Promise<boolean> {
  if (typeof window === "undefined" || hydratedOnce) return false;
  hydratedOnce = true;

  const remote = await fetchSchoolMirror();
  if (!remote?.updatedAt) return false;

  const remoteAt = remote.updatedAt;
  const localAt = readMeta();
  const remoteIsNewer = !localAt || remoteAt > localAt;

  let changed = false;

  const { deskSkipMirrorBlobSliceClient } = await import("@/lib/deskCutover");

  if (remote.masters && !deskSkipMirrorBlobSliceClient("masters")) {
    const { hydrateMastersFromMirror } = await import("@/lib/masters");
    if (hydrateMastersFromMirror(remote.masters, remoteAt, remoteIsNewer)) {
      changed = true;
    }
  }

  if (remote.sis && !deskSkipMirrorBlobSliceClient("sis")) {
    const { hydrateSisFromMirror } = await import("@/lib/sis");
    if (hydrateSisFromMirror(remote.sis, remoteAt, remoteIsNewer)) {
      changed = true;
    }
  }

  if (remote.fees && !deskSkipMirrorBlobSliceClient("fees")) {
    const { hydrateFeesFromMirror } = await import("@/lib/fees");
    if (hydrateFeesFromMirror(remote.fees, remoteAt, remoteIsNewer)) {
      changed = true;
    }
  }

  if (remote.payments && !deskSkipMirrorBlobSliceClient("payments")) {
    const { hydratePaymentsFromMirror } = await import("@/lib/payments");
    if (hydratePaymentsFromMirror(remote.payments, remoteAt, remoteIsNewer)) {
      changed = true;
    }
  }

  if (remote.admissions && !deskSkipMirrorBlobSliceClient("admissions")) {
    const { hydrateAdmissionsFromMirror } = await import("@/lib/admissions");
    if (hydrateAdmissionsFromMirror(remote.admissions, remoteAt, remoteIsNewer)) {
      changed = true;
    }
  }

  writeMeta(remoteAt);
  return changed;
}

export {
  ensureAllDeskHydrated,
  ensureDeskHydratedPriority,
  startDeskHydrationBackground,
} from "@/lib/deskHydrationSchedule";
