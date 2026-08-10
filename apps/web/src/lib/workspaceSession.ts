/**
 * Align header session cookie with Masters "current" academic year.
 */

import {
  resolvedAcademicYearCode,
  syncWorkspaceAcademicYear,
} from "@/lib/masters";

export const WORKSPACE_AY_ALIGNED_KEY = "bhb_workspace_ay_aligned_v1";

export function clearWorkspaceSessionAlignFlag(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(WORKSPACE_AY_ALIGNED_KEY);
}

/** Sync header session cookie when it differs from Masters current AY. */
export async function alignWorkspaceSessionFromMasters(
  cookieAy: string,
): Promise<boolean> {
  if (typeof window === "undefined") return false;

  const { isDeskHydrated } = await import("@/lib/deskHydrateGuard");
  if (!isDeskHydrated("masters")) return false;

  // Strict: null when Masters holds no academic years. The loose
  // currentAcademicYearCode() would hand back DEFAULT_AY here, and this
  // function writes its answer into the signed SERVER session cookie — so a
  // frozen desk with no years PATCHed a fabricated "2025-26" onto the server
  // and the whole school ran in a session that ended 2026-03-31. A guess must
  // never leave the browser.
  const mastersCurrent = resolvedAcademicYearCode();
  if (!mastersCurrent) return false; // unknown: leave the session alone
  if (mastersCurrent === cookieAy) {
    sessionStorage.setItem(WORKSPACE_AY_ALIGNED_KEY, "1");
    return false;
  }

  const ok = await syncWorkspaceAcademicYear(mastersCurrent);
  if (ok) sessionStorage.setItem(WORKSPACE_AY_ALIGNED_KEY, "1");
  return ok;
}

/** Core desk + staff hydrate, then align header session to Masters current AY. */
export async function bootstrapWorkspaceSession(
  pathname: string,
  cookieAy: string,
): Promise<"ready" | "refresh"> {
  if (typeof window === "undefined") return "ready";

  const { ensureDeskHydratedPriority } = await import(
    "@/lib/schoolDataMirrorClientHydrate"
  );
  const { ensureStaffHydrated } = await import("@/lib/staffPersistence");

  await ensureDeskHydratedPriority(pathname);
  await ensureStaffHydrated();

  const changed = await alignWorkspaceSessionFromMasters(cookieAy);
  return changed ? "refresh" : "ready";
}
