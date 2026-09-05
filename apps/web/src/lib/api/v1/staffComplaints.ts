import type { ApiAuthContext } from "@/lib/api/v1/auth";
import type { ComplaintTicket } from "@/lib/complaints";
import { scopeAllows, type StaffScope } from "@/lib/api/v1/staffScope";
import type { SisStudent } from "@/lib/sis";

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
