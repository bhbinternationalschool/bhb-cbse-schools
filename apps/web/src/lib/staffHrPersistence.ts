import { createDeskSlicePersistence } from "@/lib/createDeskSlicePersistence";
import {
  loadStaffHr,
  staffHrStateIsEmpty,
  writeStaffHrLocalRaw,
  type StaffHrState,
} from "@/lib/staffHr";

const desk = createDeskSlicePersistence<StaffHrState>({
  moduleId: "staff_hr",
  blobMetaKey: "bhb_staff_hr_v1_remote_meta",
  label: "staffHr",
  isEmpty: staffHrStateIsEmpty,
  loadLocal: loadStaffHr,
  writeLocalRaw: writeStaffHrLocalRaw,
  hasRemoteData: (b) =>
    (Array.isArray(b.leaveTypes) ? b.leaveTypes.length : 0) > 0,
});

export const staffHrRemoteEnabled = desk.remoteEnabled;
export const scheduleStaffHrSync = desk.scheduleSync;
export const ensureStaffHrHydrated = desk.ensureHydrated;
export const resetStaffHrPersistenceCache = desk.resetCache;
