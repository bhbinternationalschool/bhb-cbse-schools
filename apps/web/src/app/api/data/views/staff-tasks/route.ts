/**
 * GET /api/data/views/staff-tasks — the task board: managers and reviewers
 * (Staff · edit/approve, module grant OR the staff.tasks function grant)
 * see every task; anyone else only the tasks assigned to them (handler and
 * rules: lib/staffTasks.server.ts; the writes are /api/staff/tasks).
 *
 * A static segment beside /api/data/[collection]: Next.js prefers it.
 */
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { staffTasksViewGet } from "@/lib/staffTasks.server";
import { staffTasksDeps } from "@/lib/staffTasksDeps.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return staffTasksViewGet(req, {
    ...staffTasksDeps,
    // Any holder of Staff · view (every staff role); the handler scopes the
    // answer — the board for managers/reviewers, own tasks otherwise.
    requireStaff: (r) => requireStaffPermission(r, "staff", "view"),
  });
}
