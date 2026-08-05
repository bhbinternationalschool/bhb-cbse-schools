/**
 * Align header session cookie with Masters "current" academic year.
 */

import {
  currentAcademicYearCode,
  syncWorkspaceAcademicYear,
} from "@/lib/masters";

export const WORKSPACE_AY_ALIGNED_KEY = "bhb_workspace_ay_aligned_v1";

export function clearWorkspaceSessionAlignFlag(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(WORKSPACE_AY_ALIGNED_KEY);
}

/** Once per browser tab after login — sync cookie to Masters current AY. */
export async function alignWorkspaceSessionFromMasters(
  cookieAy: string,
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (sessionStorage.getItem(WORKSPACE_AY_ALIGNED_KEY) === "1") return false;

  const mastersCurrent = currentAcademicYearCode();
  if (!mastersCurrent) return false;

  if (mastersCurrent === cookieAy) {
    sessionStorage.setItem(WORKSPACE_AY_ALIGNED_KEY, "1");
    return false;
  }

  const ok = await syncWorkspaceAcademicYear(mastersCurrent);
  if (ok) sessionStorage.setItem(WORKSPACE_AY_ALIGNED_KEY, "1");
  return ok;
}
