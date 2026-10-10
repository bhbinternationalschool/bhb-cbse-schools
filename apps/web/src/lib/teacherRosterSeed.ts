/**
 * Demo-roster detection.
 *
 * This module used to carry a staff roster imported from a Teacher.xlsx —
 * 33 real people, with mobiles, dates of birth, home addresses, basic pay,
 * and eight Aadhaar and three PAN numbers — as a committed JSON file, to
 * seed a fresh install. The seeding was hollowed out at some point
 * (`buildTeacherRosterOntoMasters` had been reduced to `return state`) and
 * the data was left behind: imported, assigned to a const, and read by
 * nothing.
 *
 * The file is gone. Real staff come from the database; a fresh install
 * gets the demo roster in `defaultFoundationSlice` and the school replaces
 * it from Staff. Nothing needs a copy of anyone's identity numbers checked
 * into the repository to do that.
 *
 * What remains is the one piece that was still doing work: recognising the
 * built-in demo roster, so callers can tell "nobody has entered staff yet"
 * apart from "this school has twelve staff".
 */

import type { StaffRecord } from "@/lib/foundationMasters";
import type { MastersState } from "@/lib/masters";

/** Demo EMP-001… roster from defaultFoundationSlice. */
export function looksLikeDemoStaffRoster(staff: StaffRecord[]): boolean {
  if (!staff.length) return false;
  const demoHit = staff.some(
    (s) =>
      s.empCode.toUpperCase() === "EMP-001" &&
      /priya\s+sharma/i.test(s.fullName),
  );
  if (demoHit) return true;
  const allEmpDemo =
    staff.length <= 12 &&
    staff.every(
      (s) =>
        /^EMP-0\d{2}$/i.test(s.empCode) &&
        /^98000000\d{2}$/.test(s.mobile.replace(/\D/g, "")),
    );
  return allEmpDemo;
}

/**
 * Kept as the identity function its callers already relied on: the roster
 * it once built no longer exists, and a school's real staff are not
 * something this app should invent.
 */
export function buildTeacherRosterOntoMasters(
  state: MastersState,
): MastersState {
  return state;
}

/** Was a one-time swap of demo staff for the Teacher.xlsx roster. */
export function migrateDemoStaffToTeacherRoster(
  state: MastersState,
): MastersState {
  return state;
}
