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
/** Pull the rbac slice into this tab's page copy. */
export async function ensureRbacHydrated(): Promise<boolean> {
  const changed = await desk.ensureHydrated();
  return changed;
}
export const resetRbacPersistenceCache = desk.resetCache;
