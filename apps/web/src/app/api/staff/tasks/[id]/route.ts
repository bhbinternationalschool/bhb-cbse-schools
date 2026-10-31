/**
 * PATCH /api/staff/tasks/<id> — progress and submit (the assignee or a
 * manager), review (reviewers: Staff · approve or the staff.tasks · approve
 * grant), cancel (assigners). Every body names the rev the screen loaded;
 * a stale base is a 409 with the stored task. Handler:
 * lib/staffTasks.server.ts.
 */
import {
  requireStaffApi,
  requireStaffPermissionOrFeature,
} from "@/lib/apiRouteAuth.server";
import { staffTasksGetOne, staffTasksPatch } from "@/lib/staffTasks.server";
import { staffTasksDeps } from "@/lib/staffTasksDeps.server";
import { withBuildCheck } from "@/lib/staleBuild.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withBuildCheck((req: Request, ctx: { params: Promise<{ id: string }> }) =>
  ctx.params.then(({ id }) => staffTasksGetOne(req, staffTasksDeps, id)),
);

export const PATCH = withBuildCheck((req: Request, ctx: { params: Promise<{ id: string }> }) =>
  ctx.params.then(({ id }) =>
    staffTasksPatch(req, {
      ...staffTasksDeps,
      requireStaff: (r) => requireStaffApi(r),
      assignAuth: (r) => requireStaffPermissionOrFeature(r, "staff", "approve", "staff.tasks", "create"),
      reviewAuth: (r) => requireStaffPermissionOrFeature(r, "staff", "approve", "staff.tasks", "approve"),
    }, id),
  ),
);
