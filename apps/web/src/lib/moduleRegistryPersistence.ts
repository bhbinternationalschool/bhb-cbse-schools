import { createDeskSlicePersistence } from "@/lib/createDeskSlicePersistence";
import {
  moduleRegistryStateIsEmpty,
  readModuleRegistryStorage,
  writeModuleRegistryLocalRaw,
  type ModuleRegistryState,
} from "@/lib/moduleRegistry";

const desk = createDeskSlicePersistence<ModuleRegistryState>({
  moduleId: "module_registry",
  blobMetaKey: "bhb_module_registry_v1_remote_meta",
  label: "moduleRegistry",
  isEmpty: moduleRegistryStateIsEmpty,
  loadLocal: readModuleRegistryStorage,
  writeLocalRaw: writeModuleRegistryLocalRaw,
  hasRemoteData: (b) =>
    b.enabled != null && Object.keys(b.enabled as object).length > 0,
});

export const scheduleModuleRegistrySync = desk.scheduleSync;
export const ensureModuleRegistryHydrated = desk.ensureHydrated;
export const resetModuleRegistryPersistenceCache = desk.resetCache;
