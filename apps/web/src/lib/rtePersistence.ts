import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  rteStateIsEmpty,
  loadRte,
  writeRteLocalRaw,
  type RteState,
} from "@/lib/rteEws";

const blob = createDomainBlobPersistence<RteState>({
  table: "rte_state",
  metaKey: "bhb_rte_ews_v1_remote_meta",
  label: "rte",
  isEmpty: rteStateIsEmpty,
  loadLocal: loadRte,
  writeLocalRaw: writeRteLocalRaw,
});

export const scheduleRteSync = blob.scheduleSync;
export const ensureRteHydrated = blob.ensureHydrated;
export const resetRtePersistenceCache = blob.resetCache;
