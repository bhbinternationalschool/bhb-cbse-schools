import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  loadStaffAttendance,
  staffAttendanceStateIsEmpty,
  writeStaffAttendanceLocalRaw,
  type StaffAttendanceState,
} from "@/lib/staffAttendance";

const blob = createDomainBlobPersistence<StaffAttendanceState>({
  table: "staff_attendance_state",
  metaKey: "bhb_staff_attendance_v1_remote_meta",
  label: "staffAttendance",
  isEmpty: staffAttendanceStateIsEmpty,
  loadLocal: loadStaffAttendance,
  writeLocalRaw: writeStaffAttendanceLocalRaw,
});

export const staffAttendanceRemoteEnabled = blob.remoteEnabled;
export const scheduleStaffAttendanceSync = blob.scheduleSync;
export const ensureStaffAttendanceHydrated = blob.ensureHydrated;
export const resetStaffAttendancePersistenceCache = blob.resetCache;
