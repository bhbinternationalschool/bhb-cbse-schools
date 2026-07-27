/**
 * Attendance remote sync — jsonb blob on attendance_state.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  attendanceStateIsEmpty,
  loadAttendance,
  writeAttendanceLocalRaw,
  type AttendanceState,
} from "@/lib/attendance";

const blob = createDomainBlobPersistence<AttendanceState>({
  table: "attendance_state",
  metaKey: "bhb_attendance_v1_remote_meta",
  label: "attendance",
  isEmpty: attendanceStateIsEmpty,
  loadLocal: loadAttendance,
  writeLocalRaw: writeAttendanceLocalRaw,
});

export const attendanceRemoteEnabled = blob.remoteEnabled;
export const scheduleAttendanceSync = blob.scheduleSync;
export const ensureAttendanceHydrated = blob.ensureHydrated;
export const resetAttendancePersistenceCache = blob.resetCache;
