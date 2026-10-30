/**
 * Serve one staff-task evidence file (30 Oct 2026): the same task-level
 * read rule as GET /api/staff/tasks/<id> — the assignee, the assigner, a
 * manager or a reviewer — applied on EVERY download. The generic /api/file
 * route is staff-wide, so task evidence never goes through it: a guessed or
 * copied /api/file/staff-tasks/... URL must not open another staff member's
 * evidence (/api/file refuses the staff-tasks/ prefix outright). Paths
 * outside staff-tasks/<taskId>/ are refused here too.
 *
 * Dependencies are injected so the self-test drives the rule — other-staff
 * denial, assignee / assigner / manager / reviewer access — without a
 * database or storage.
 */
import { NextResponse } from "next/server";
import type { ApiAuthContext } from "@/lib/api/v1/auth";
import type { RouteAuthResult } from "@/lib/apiRouteAuth.server";
import { contentTypeFor, sanitizeMediaPath } from "@/lib/media";
import type { StaffTaskRow } from "@/lib/staffTasksShared";

export type StaffTaskEvidenceFileDeps = {
  requireStaff: (req: Request) => Promise<RouteAuthResult>;
  canManage: (ctx: ApiAuthContext) => boolean;
  canReview: (ctx: ApiAuthContext) => boolean;
  selfStaffId: (ctx: ApiAuthContext) => string | null;
  readTasks: () => Promise<StaffTaskRow[] | null>;
  download: (path: string) => Promise<{ ok: true; data: ArrayBuffer } | { ok: false }>;
};

export async function staffTaskEvidenceFileGet(
  req: Request,
  deps: StaffTaskEvidenceFileDeps,
  rawPath: string,
): Promise<Response> {
  const auth = await deps.requireStaff(req);
  if (!auth.ok) return auth.response;

  const path = sanitizeMediaPath(rawPath);
  const m = path.match(/^staff-tasks\/([^/]+)\/[^/]+$/);
  if (!m) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const tasks = await deps.readTasks();
  if (!tasks) {
    return NextResponse.json({ error: "Tasks could not be read" }, { status: 503 });
  }
  const task = tasks.find((t) => t.id === m[1]);
  if (!task) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const ctx = auth.ctx;
  const selfId = auth.viaMirrorSecret ? null : deps.selfStaffId(ctx);
  const allowed =
    auth.viaMirrorSecret ||
    deps.canManage(ctx) ||
    deps.canReview(ctx) ||
    (!!selfId && (task.assigneeStaffId === selfId || task.assignedBy === selfId));
  if (!allowed) {
    return NextResponse.json({ error: "This task is not yours" }, { status: 403 });
  }
  // Only types this bucket is allowed to hold can come back out of it.
  const contentType = contentTypeFor("school-files", path);
  if (!contentType) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const file = await deps.download(path);
  if (!file.ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return new NextResponse(file.data, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
