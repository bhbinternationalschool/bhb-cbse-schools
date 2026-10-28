import { loadServerRbacIfKnown } from "@/lib/api/v1/auth";
import { attendanceExemptStaffIds } from "@/lib/staffAttendance";
import { readStaffAttendanceSettings } from "@/lib/staffAttendanceDeskAncillary.server";
import type { RbacState } from "@/lib/rbac";

/**
 * Who keeps no attendance, read for this request from the database (the
 * office's list) and the roles (owner / admin as main role).
 *
 * `known: false` = either could not be read. The caller must then say the
 * figure is not loaded — never count the exempt staff as absent, and never
 * show 0.
 */
export async function readStaffTodayExempt(rbac?: RbacState | null): Promise<{ known: boolean; ids: Set<string> }> {
  const [settings, roles] = await Promise.all([
    readStaffAttendanceSettings(),
    rbac === undefined ? loadServerRbacIfKnown().catch(() => null) : Promise.resolve(rbac),
  ]);
  if (!settings.ok || !roles) {
    return { known: false, ids: new Set(settings.settings.exemptStaffIds ?? []) };
  }
  const ids = attendanceExemptStaffIds(settings.settings, {
    roles: roles.roles.map((r) => ({ id: r.id, code: r.code })),
    assignments: roles.assignments.map((a) => ({ staffId: a.staffId, roleId: a.roleId, isPrimary: a.isPrimary })),
  });
  return { known: true, ids };
}
