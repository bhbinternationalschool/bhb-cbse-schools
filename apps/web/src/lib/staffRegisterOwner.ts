/**
 * Who may change the staff attendance register (director, 15 Oct 2026):
 * "only the owner can edit the staff attendance register". Everyone else —
 * principal, admin, office — reads it.
 *
 * "Owner" is what it is everywhere else in the ERP (lib/rbacEditGuard): a
 * protected super admin, or a person holding the owner role in Masters →
 * Roles. Nothing is guessed from a designation.
 *
 * What counts as a change: any mark the save would add, alter or remove on
 * a register — status, in/out time, note, punch way. Staff punching for
 * THEMSELVES (QR, app, WhatsApp GPS, survey day, outdoor duty) and leave
 * approval write through their own server routes and are not register edits;
 * they are unaffected.
 *
 * The server applies this on every staff register save
 * (app/api/school-data/staff-attendance-registers POST); the screen only
 * hides what would be refused.
 *
 * Pure: no I/O (exercised by staffRegisterOwner.selftest.ts).
 */
import type { MastersState } from "@/lib/masters";
import { resolveSessionRoles, type RbacState, type SessionLike } from "@/lib/rbac";
import type { StaffAttendanceMark, StaffAttendanceRegister } from "@/lib/staffAttendance";
import { isProtectedSuperAdminEmail } from "@/lib/superAdmin";

export const STAFF_REGISTER_OWNER_ONLY =
  "Only the owner can change the staff attendance register. You can view it; your own punch is saved on its own.";

/** A protected super admin, or anyone holding the owner role. */
export function isStaffRegisterOwner(
  session: SessionLike,
  rbac: RbacState,
  masters: MastersState | null | undefined,
): boolean {
  if (isProtectedSuperAdminEmail(session.email)) return true;
  try {
    return resolveSessionRoles(rbac, session, masters ?? null).some((r) => r.code === "owner");
  } catch {
    return false;
  }
}

function markKey(m: StaffAttendanceMark): string {
  return [m.status || "", m.inTime || "", m.outTime || "", m.note || "", m.punchWay || ""].join("|");
}

/**
 * The marks a staff register save would change, as "date staffId" — empty
 * when the save changes no mark (e.g. an office save of the punch rules that
 * carries the registers exactly as stored).
 *
 * Only the registers the save will write are compared: with `stamps`, those
 * named in it (lib/staffAttendanceNormalized pushes nothing else); without,
 * all of them. A register is matched to the stored one by id, else by
 * session + date. Marks the save drops from a register it carries marks for
 * are changes too: the push removes them.
 */
export function staffRegisterMarkChanges(
  stored: StaffAttendanceRegister[],
  incoming: StaffAttendanceRegister[],
  stamps?: Record<string, string>,
): string[] {
  const byId = new Map(stored.map((r) => [r.id, r]));
  const byDay = new Map(stored.map((r) => [`${r.academicYearCode}|${r.date}`, r]));
  const out: string[] = [];
  for (const r of incoming ?? []) {
    if (!r || typeof r !== "object") continue;
    if (stamps && !(r.id in stamps)) continue;
    const prev = byId.get(r.id) ?? byDay.get(`${r.academicYearCode}|${r.date}`);
    // A different register already holds that day: the push keeps the stored
    // one and skips this copy, so it changes nothing.
    if (!byId.has(r.id) && prev) continue;
    const before = new Map((prev?.marks ?? []).map((m) => [m.staffId, markKey(m)]));
    const marks = Array.isArray(r.marks) ? r.marks : [];
    const seen = new Set<string>();
    for (const m of marks) {
      if (!m || typeof m.staffId !== "string") continue;
      seen.add(m.staffId);
      if (before.get(m.staffId) !== markKey(m)) out.push(`${r.date} ${m.staffId}`);
    }
    if (marks.length > 0) {
      for (const id of before.keys()) if (!seen.has(id)) out.push(`${r.date} ${id}`);
    }
  }
  return out;
}
