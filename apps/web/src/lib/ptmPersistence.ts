import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  ptmStateIsEmpty,
  loadPtm,
  writePtmLocalRaw,
  type PtmState,
} from "@/lib/ptm";

const blob = createDomainBlobPersistence<PtmState>({
  table: "ptm_state",
  metaKey: "bhb_ptm_v1_remote_meta",
  label: "ptm",
  isEmpty: ptmStateIsEmpty,
  loadLocal: loadPtm,
  writeLocalRaw: writePtmLocalRaw,
});

export const schedulePtmSync = blob.scheduleSync;
export const ensurePtmHydrated = blob.ensureHydrated;
export const resetPtmPersistenceCache = blob.resetCache;
