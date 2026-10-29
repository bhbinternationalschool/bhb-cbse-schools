/**
 * Load the two desk slices the Substitution panel needs to detect absent /
 * on-leave teachers for a date: the staff-attendance register and the HR
 * leave list.
 *
 * TimetableWorkspace hydrates only masters + the timetable, so on the
 * timetable screen these slices are empty and the absent list came up blank
 * (bug, 29 Oct 2026). This hydrates them the same way the Staff attendance
 * panel and Leave approvals screens do, then hands the panel the data to feed
 * into `absentTeachersFromData`.
 *
 * Kept out of the panel component on purpose: the ensure*Hydrated() calls
 * belong in lib/, not in a screen (see the `ensure_hydrated_component_files`
 * ratchet). `ok: false` means the desk read failed — the panel must say
 * "could not load", not "nobody absent".
 */

import type { LeaveRequest } from "@/lib/staffHr";
import type { StaffAttendanceState } from "@/lib/staffAttendance";

export type SubstitutionAbsenceLoad =
  | { ok: true; attState: StaffAttendanceState; leaveRequests: LeaveRequest[] }
  | { ok: false };

export async function loadSubstitutionAbsence(): Promise<SubstitutionAbsenceLoad> {
  if (typeof window === "undefined") return { ok: false };

  const [
    { ensureStaffAttendanceHydrated },
    { ensureStaffHrHydrated },
    { withHydrationSlot, isDeskHydrated },
    { loadStaffAttendance },
    { loadStaffHr },
  ] = await Promise.all([
    import("@/lib/staffAttendancePersistence"),
    import("@/lib/staffHrPersistence"),
    import("@/lib/deskHydrateGuard"),
    import("@/lib/staffAttendance"),
    import("@/lib/staffHr"),
  ]);

  await Promise.all([
    withHydrationSlot(() => ensureStaffAttendanceHydrated()),
    withHydrationSlot(() => ensureStaffHrHydrated()),
  ]);

  // isDeskHydrated is set only after a successful desk read (an empty DB still
  // counts as success). If either is still false the read failed, so the
  // caller must distinguish "could not load" from "genuinely nobody absent".
  if (!isDeskHydrated("staff_attendance") || !isDeskHydrated("staff_hr")) {
    return { ok: false };
  }

  return {
    ok: true,
    attState: loadStaffAttendance(),
    leaveRequests: loadStaffHr().leaveRequests,
  };
}
