import type { ApiAuthContext } from "@/lib/api/v1/auth";
import type { ComplaintTicket } from "@/lib/complaints";
import { scopeAllows, staffSectionScope, type StaffScope } from "@/lib/api/v1/staffScope";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadSis, type SisStudent } from "@/lib/sis";

/** A teacher sees tickets assigned to them or about a child in their sections. */
export function complaintInScope(
  ctx: ApiAuthContext,
  scope: StaffScope,
  t: ComplaintTicket,
  studentById: Map<string, SisStudent>,
): boolean {
  if (scope.unrestricted) return true;
  if (t.assignedToStaffId && t.assignedToStaffId === ctx.session.staffId) return true;
  const st = t.studentId ? studentById.get(t.studentId) : undefined;
  return !!st && scopeAllows(scope, st.classId, st.sectionId);
}

export const OPEN_STATUSES = new Set(["open", "assigned", "in_progress"]);

/**
 * The complaint filter for one request: everything for principal / office,
 * else complaintInScope. Shared by the older whole-desk routes (module-state
 * "complaints", /api/wa/complaints) so a teacher's browser gets the same
 * tickets from them as from /api/v1/staff/complaints — until 2026-09-29
 * those two handed every ticket in the school to anyone with complaints.view.
 */
export async function complaintScopeFilter(
  ctx: ApiAuthContext,
): Promise<{ unrestricted: boolean; allows: (t: ComplaintTicket) => boolean }> {
  const scope = await staffSectionScope(ctx);
  if (scope.unrestricted) return { unrestricted: true, allows: () => true };
  await ensureSchoolMirrorHydrated();
  await ensureSisHydratedServer();
  const studentById = new Map(loadSis().students.map((s) => [s.id, s]));
  return {
    unrestricted: false,
    allows: (t) => complaintInScope(ctx, scope, t, studentById),
  };
}
