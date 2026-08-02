import { createDeskSlicePersistence } from "@/lib/createDeskSlicePersistence";
import {
  advancesStateIsEmpty,
  loadAdvances,
  writeAdvancesLocalRaw,
  type AdvanceState,
} from "@/lib/staffAdvance";

const desk = createDeskSlicePersistence<AdvanceState>({
  moduleId: "staff_advances",
  blobMetaKey: "bhb_staff_advances_v1_remote_meta",
  label: "staffAdvances",
  isEmpty: advancesStateIsEmpty,
  loadLocal: loadAdvances,
  writeLocalRaw: writeAdvancesLocalRaw,
  hasRemoteData: (b) =>
    (Array.isArray(b.advances) ? b.advances.length : 0) > 0,
});

export const staffAdvancesRemoteEnabled = desk.remoteEnabled;
export const scheduleStaffAdvancesSync = desk.scheduleSync;
export const ensureStaffAdvancesHydrated = desk.ensureHydrated;
export const resetStaffAdvancesPersistenceCache = desk.resetCache;
