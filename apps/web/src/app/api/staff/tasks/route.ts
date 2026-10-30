/**
 * /api/staff/tasks — GET is the same answer as the staff-tasks view (a
 * screen deep-link convenience), POST assigns a task. Assigners only, the
 * director's 30 Oct rule: Staff · approve module holders (owner, principal)
 * or an explicit staff.tasks · create grant — NOT a broad Staff · edit
 * (admin/office hold that; they are not assigners). Handler:
 * lib/staffTasks.server.ts.
 */
import { requireStaffApi, requireStaffPermissionOrFeature } from "@/lib/apiRouteAuth.server";
import { staffTasksPost, staffTasksViewGet } from "@/lib/staffTasks.server";
import { staffTasksDeps } from "@/lib/staffTasksDeps.server";
import { withBuildCheck } from "@/lib/staleBuild.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withBuildCheck((req: Request) =>
  staffTasksViewGet(req, { ...staffTasksDeps, requireStaff: (r) => requireStaffApi(r) }),
);
export const POST = withBuildCheck((req: Request) =>
  staffTasksPost(req, {
    ...staffTasksDeps,
    assignAuth: (r) => requireStaffPermissionOrFeature(r, "staff", "approve", "staff.tasks", "create"),
  }),
);
