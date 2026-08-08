/**
 * Login bootstrap — clear stale browser desks, then hydrate from DB on first ERP load.
 */

import { clearWorkspaceSessionAlignFlag } from "@/lib/workspaceSession";
import { FRESH_LOGIN_SESSION_KEY } from "@/lib/workspaceSyncPolicy";
import { resetDeskHydrated } from "@/lib/deskHydrateGuard";

const DESK_PREFIX = "bhb_";

const LOCAL_STORAGE_KEEP = new Set<string>(["bhb_tenant_data_wipe_seen_v1"]);

export function markFreshLoginSession(): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(FRESH_LOGIN_SESSION_KEY, "1");
}

export function consumeFreshLoginSession(): boolean {
  if (typeof window === "undefined") return false;
  if (sessionStorage.getItem(FRESH_LOGIN_SESSION_KEY) !== "1") return false;
  sessionStorage.removeItem(FRESH_LOGIN_SESSION_KEY);
  return true;
}

export function clearWorkspaceLocalStorage(): void {
  if (typeof window === "undefined") return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(DESK_PREFIX) && !LOCAL_STORAGE_KEEP.has(key)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

export async function resetAllWorkspacePersistenceCaches(): Promise<void> {
  resetDeskHydrated();
  const { resetClientSchoolMirrorHydrated } = await import(
    "@/lib/schoolDataMirrorClientHydrate"
  );
  resetClientSchoolMirrorHydrated();

  await Promise.allSettled([
    import("@/lib/mastersPersistence").then((m) => m.resetMastersPersistenceCache()),
    import("@/lib/sisPersistence").then((m) => m.resetSisPersistenceCache()),
    import("@/lib/staffPersistence").then((m) => m.resetStaffPersistenceCache()),
    import("@/lib/feesPersistence").then((m) => m.resetFeesPersistenceCache()),
    import("@/lib/admissionsPersistence").then((m) =>
      m.resetAdmissionsPersistenceCache(),
    ),
    import("@/lib/paymentsPersistence").then((m) =>
      m.resetPaymentsPersistenceCache(),
    ),
    import("@/lib/attendancePersistence").then((m) =>
      m.resetAttendancePersistenceCache(),
    ),
    import("@/lib/examsPersistence").then((m) => m.resetExamsPersistenceCache()),
    import("@/lib/homeworkPersistence").then((m) =>
      m.resetHomeworkPersistenceCache(),
    ),
    import("@/lib/ptmPersistence").then((m) => m.resetPtmPersistenceCache()),
    import("@/lib/studentLeavePersistence").then((m) =>
      m.resetStudentLeavePersistenceCache(),
    ),
    import("@/lib/timetablePersistence").then((m) =>
      m.resetTimetablePersistenceCache(),
    ),
    import("@/lib/schoolCommsPersistence").then((m) =>
      m.resetSchoolCommsPersistenceCache(),
    ),
    import("@/lib/storePersistence").then((m) => m.resetStorePersistenceCache()),
    import("@/lib/purchasePersistence").then((m) =>
      m.resetPurchasePersistenceCache(),
    ),
    import("@/lib/accountsPersistence").then((m) =>
      m.resetAccountsPersistenceCache(),
    ),
    import("@/lib/payrollPersistence").then((m) =>
      m.resetPayrollPersistenceCache(),
    ),
    import("@/lib/transportPersistence").then((m) =>
      m.resetTransportPersistenceCache(),
    ),
    import("@/lib/trustPersistence").then((m) => m.resetTrustPersistenceCache()),
    import("@/lib/vaultPersistence").then((m) => m.resetVaultPersistenceCache()),
    import("@/lib/rtePersistence").then((m) => m.resetRtePersistenceCache()),
    import("@/lib/notificationsPersistence").then((m) =>
      m.resetNotificationsPersistenceCache(),
    ),
    import("@/lib/curriculumPersistence").then((m) =>
      m.resetCurriculumPersistenceCache(),
    ),
  ]);
}

export async function prepareWorkspaceAfterLogin(): Promise<void> {
  clearWorkspaceLocalStorage();
  clearWorkspaceSessionAlignFlag();
  await resetAllWorkspacePersistenceCaches();
  markFreshLoginSession();
}

export async function flushAllDeskSyncPending(): Promise<void> {
  await Promise.allSettled([
    import("@/lib/mastersNormalizedClient").then((m) =>
      m.flushMastersDeskSyncPending(),
    ),
  ]);
}

export { WORKSPACE_INACTIVITY_MS } from "@/lib/workspaceSyncPolicy";
