import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  moduleRegistryStateIsEmpty,
  readModuleRegistryStorage,
  writeModuleRegistryLocalRaw,
  type ModuleRegistryState,
} from "@/lib/moduleRegistry";

const blob = createDomainBlobPersistence<ModuleRegistryState>({
  table: "module_registry_state",
  metaKey: "bhb_module_registry_v1_remote_meta",
  label: "moduleRegistry",
  isEmpty: moduleRegistryStateIsEmpty,
  loadLocal: readModuleRegistryStorage,
  writeLocalRaw: writeModuleRegistryLocalRaw,
});

export const scheduleModuleRegistrySync = blob.scheduleSync;
export const ensureModuleRegistryHydrated = blob.ensureHydrated;
export const resetModuleRegistryPersistenceCache = blob.resetCache;
