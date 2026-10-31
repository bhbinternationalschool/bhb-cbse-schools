/**
 * POST /api/staff/tasks/evidence — multipart { taskId, file }.
 *
 * One piece of evidence (photo or PDF) for a staff task. The upload is
 * stored first; the caller then names the returned attachment ref in a
 * progress or submit PATCH, so evidence never appears on a task whose state
 * change was refused. Access: requireStaffApi, then the assignee or a board
 * holder under the director's 30 Oct rule (Staff · approve module holders,
 * or an explicit staff.tasks grant — the same gates staffTasksDeps.server.ts
 * names, wired inline here like the sibling routes so the RBAC completeness
 * scan sees them). The task must still be open: evidence for a done or
 * cancelled task is a mistake, not a record. Handler:
 * lib/staffTaskEvidenceUpload.server.ts (staffTaskEvidencePost).
 * Registered under the staff.tasks function in
 * lib/rbacFeatureCatalog/people.ts.
 */
import { requireStaffApi } from "@/lib/apiRouteAuth.server";
import { featureGrantHeld, hasPermission } from "@/lib/rbac";
import { staffTasksDeps } from "@/lib/staffTasksDeps.server";
import {
  staffTaskEvidencePost,
  staffTaskEvidenceStore,
  type StaffTaskEvidencePostDeps,
} from "@/lib/staffTaskEvidenceUpload.server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const deps: StaffTaskEvidencePostDeps = {
    requireStaff: (req) => requireStaffApi(req),
    readTasks: staffTasksDeps.readTasks,
    // The 30 Oct rule, exactly as staffTasksDeps.holds: Staff · approve
    // (owner, principal) or an explicit staff.tasks grant — a broad
    // Staff · edit (admin, office) is NOT board access. Fails closed when
    // the saved roles could not be read.
    canManage: (c) =>
      c.rbacKnown !== false &&
      (hasPermission(c.session, c.masters, "staff", "approve", c.rbac) ||
        featureGrantHeld(c.session, c.masters, "staff.tasks", "create", c.rbac)),
    canReview: (c) =>
      c.rbacKnown !== false &&
      (hasPermission(c.session, c.masters, "staff", "approve", c.rbac) ||
        featureGrantHeld(c.session, c.masters, "staff.tasks", "approve", c.rbac)),
    selfStaffId: staffTasksDeps.selfStaffId,
    store: staffTaskEvidenceStore,
  };
  return staffTaskEvidencePost(request, deps);
}
