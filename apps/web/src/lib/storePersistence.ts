import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  loadStore,
  storeStateIsEmpty,
  writeStoreLocalRaw,
  type StoreState,
} from "@/lib/store";

const blob = createDomainBlobPersistence<StoreState>({
  table: "store_state",
  metaKey: "bhb_store_v1_remote_meta",
  label: "store",
  isEmpty: storeStateIsEmpty,
  loadLocal: loadStore,
  writeLocalRaw: writeStoreLocalRaw,
});

export const storeRemoteEnabled = blob.remoteEnabled;
export const scheduleStoreSync = blob.scheduleSync;
export const ensureStoreHydrated = blob.ensureHydrated;
export const resetStorePersistenceCache = blob.resetCache;
