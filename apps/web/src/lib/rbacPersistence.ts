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
export const ensureRbacHydrated = desk.ensureHydrated;
export const resetRbacPersistenceCache = desk.resetCache;
