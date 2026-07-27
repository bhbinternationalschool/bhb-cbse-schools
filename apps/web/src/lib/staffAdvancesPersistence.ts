import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  advancesStateIsEmpty,
  loadAdvances,
  writeAdvancesLocalRaw,
  type AdvanceState,
} from "@/lib/staffAdvance";

const blob = createDomainBlobPersistence<AdvanceState>({
  table: "staff_advances_state",
  metaKey: "bhb_staff_advances_v1_remote_meta",
  label: "staffAdvances",
  isEmpty: advancesStateIsEmpty,
  loadLocal: loadAdvances,
  writeLocalRaw: writeAdvancesLocalRaw,
});

export const staffAdvancesRemoteEnabled = blob.remoteEnabled;
export const scheduleStaffAdvancesSync = blob.scheduleSync;
export const ensureStaffAdvancesHydrated = blob.ensureHydrated;
export const resetStaffAdvancesPersistenceCache = blob.resetCache;
