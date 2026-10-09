/**
 * Attendance deletions the desk has to name (see deskNamedDeletes.ts).
 *
 * Its own module, not attendanceNormalizedClient: attendance.ts imports this,
 * and the sync client pulls in syncRetryStatus, which listens on `window` as
 * it loads.
 */

import { recordDeskDeletion } from "@/lib/deskNamedDeletes";

export const ATTENDANCE_DESK = "attendance";

/** Registers, nudges or exceptions the desk removed; the next push deletes them by id. */
export function recordAttendanceDeletion(
  table:
    | "attendance_desk_registers"
    | "attendance_desk_absent_nudges"
    | "attendance_desk_exceptions",
  ids: string[],
) {
  if (typeof window === "undefined" || ids.length === 0) return;
  recordDeskDeletion(ATTENDANCE_DESK, table, ids);
}
