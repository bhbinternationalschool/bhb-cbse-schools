import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  loadStaffHr,
  staffHrStateIsEmpty,
  writeStaffHrLocalRaw,
  type StaffHrState,
} from "@/lib/staffHr";

const blob = createDomainBlobPersistence<StaffHrState>({
  table: "staff_hr_state",
  metaKey: "bhb_staff_hr_v1_remote_meta",
  label: "staffHr",
  isEmpty: staffHrStateIsEmpty,
  loadLocal: loadStaffHr,
  writeLocalRaw: writeStaffHrLocalRaw,
});

export const staffHrRemoteEnabled = blob.remoteEnabled;
export const scheduleStaffHrSync = blob.scheduleSync;
export const ensureStaffHrHydrated = blob.ensureHydrated;
export const resetStaffHrPersistenceCache = blob.resetCache;
