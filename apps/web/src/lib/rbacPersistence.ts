import { createDeskSlicePersistence } from "@/lib/createDeskSlicePersistence";
import {
  loadRbac,
  rbacStateIsEmpty,
  writeRbacLocalRaw,
  type RbacState,
} from "@/lib/rbac";

const desk = createDeskSlicePersistence<RbacState>({
  moduleId: "rbac",
  blobMetaKey: "bhb_rbac_v1_remote_meta",
  label: "rbac",
  isEmpty: rbacStateIsEmpty,
  loadLocal: loadRbac,
  writeLocalRaw: writeRbacLocalRaw,
  hasRemoteData: (b) => (Array.isArray(b.roles) ? b.roles.length : 0) > 0,
});

export const scheduleRbacSync = desk.scheduleSync;
/** Pull the rbac slice; tells open screens when roles/assignments changed
 * so their tab lists are worked out again (components/shell/useAccessData). */
export async function ensureRbacHydrated(): Promise<boolean> {
  const changed = await desk.ensureHydrated();
  if (changed && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("bhb-rbac-updated"));
  }
  return changed;
}
export const resetRbacPersistenceCache = desk.resetCache;
