/**
 * GET /api/staff/tasks/evidence/<bucket path> — one staff-task evidence
 * file. Gate: requireStaffApi, then the task-level read rule (assignee,
 * assigner, or a board holder under the director's 30 Oct rule — Staff ·
 * approve or an explicit staff.tasks grant, as staffTasksDeps.server.ts).
 * Task evidence never goes through the staff-wide /api/file route, which
 * refuses the staff-tasks/ prefix. Registered under the staff.tasks
 * function in lib/rbacFeatureCatalog/people.ts.
 */
import { requireStaffApi } from "@/lib/apiRouteAuth.server";
import { featureGrantHeld, hasPermission } from "@/lib/rbac";
import { getServerTenantContext } from "@/lib/serverTenant";
import { staffTasksDeps } from "@/lib/staffTasksDeps.server";
import {
  staffTaskEvidenceFileGet,
  type StaffTaskEvidenceFileDeps,
} from "@/lib/staffTaskEvidenceFile.server";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, ctx: RouteCtx) {
  const { path: segments } = await ctx.params;
  const deps: StaffTaskEvidenceFileDeps = {
    requireStaff: (req) => requireStaffApi(req),
    // The 30 Oct rule, exactly as staffTasksDeps.holds: Staff · approve
    // (owner, principal) or an explicit staff.tasks grant — a broad
    // Staff · edit (admin, office) is NOT board access.
    canManage: (c) =>
      c.rbacKnown !== false &&
      (hasPermission(c.session, c.masters, "staff", "approve", c.rbac) ||
        featureGrantHeld(c.session, c.masters, "staff.tasks", "create", c.rbac)),
    canReview: (c) =>
      c.rbacKnown !== false &&
      (hasPermission(c.session, c.masters, "staff", "approve", c.rbac) ||
        featureGrantHeld(c.session, c.masters, "staff.tasks", "approve", c.rbac)),
    selfStaffId: staffTasksDeps.selfStaffId,
    readTasks: staffTasksDeps.readTasks,
    download: async (path) => {
      const tenant = await getServerTenantContext();
      if (!tenant) return { ok: false };
      const { data, error } = await tenant.sb.storage.from("school-files").download(path);
      if (error || !data) return { ok: false };
      return { ok: true, data: await data.arrayBuffer() };
    },
  };
  return staffTaskEvidenceFileGet(request, deps, (segments ?? []).join("/"));
}
