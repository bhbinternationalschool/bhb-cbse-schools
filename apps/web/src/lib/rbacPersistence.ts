import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  loadRbac,
  rbacStateIsEmpty,
  writeRbacLocalRaw,
  type RbacState,
} from "@/lib/rbac";

const blob = createDomainBlobPersistence<RbacState>({
  table: "rbac_state",
  metaKey: "bhb_rbac_v1_remote_meta",
  label: "rbac",
  isEmpty: rbacStateIsEmpty,
  loadLocal: loadRbac,
  writeLocalRaw: writeRbacLocalRaw,
});

export const scheduleRbacSync = blob.scheduleSync;
export const ensureRbacHydrated = blob.ensureHydrated;
export const resetRbacPersistenceCache = blob.resetCache;
