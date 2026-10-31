/**
 * The real dependencies of the staff tasks handlers (./staffTasks.server.ts):
 * the session guards every /api/staff route uses, reads of the tenant's task
 * tables through the service client, the write kernel (desk_write_guarded)
 * for every change, and the RBAC helpers that decide the director's
 * 30 Oct rule — assign: Staff · edit OR an explicit staff.tasks · create
 * grant; review: Staff · approve OR the staff.tasks · approve grant.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import type { ApiAuthContext } from "@/lib/api/v1/auth";
import {
  requireStaffApi,
  requireStaffPermissionOrFeature,
} from "@/lib/apiRouteAuth.server";
import { writeRows } from "@/lib/data/server/repo";
import { getServerTenantContext } from "@/lib/serverTenant";
import { notify } from "@/lib/notify/notify.server";
import { featureGrantHeld, hasPermission } from "@/lib/rbac";
import { resolveSessionStaff } from "@/lib/staffResolve";
import {
  staffTaskFromRow,
  staffTaskUpdateFromRow,
  type StaffTaskUpdate,
} from "@/lib/staffTasksShared";
import type { StaffTasksDeps } from "@/lib/staffTasks.server";

const TASK_COLUMNS =
  "id, title, detail, assignee_staff_id, assigned_by, assigned_by_label, priority, due_on, status, progress_pct, evidence_required, reviewed_by, reviewed_at, review_note, created_at, updated_at";
const UPDATE_COLUMNS = "id, task_id, author_staff_id, pct, note, attachments, created_at";

/**
 * The director's 30 Oct rule, exactly: assigning and reviewing belong to the
 * owner and the principal — the only built-in roles holding Staff · approve
 * (admin holds staff view/create/edit/delete/export, office view/edit,
 * teachers view only; lib/rbac.ts defaultBuiltInRoles) — or to someone the
 * office EXPLICITLY gives the staff.tasks function in the RBAC editor.
 * A broad Staff · edit module grant (admin, office) is NOT assign authority.
 * Fails closed when the saved roles could not be read.
 */
function holds(ctx: ApiAuthContext, featureAction: "create" | "approve"): boolean {
  if (ctx.rbacKnown === false) return false;
  return (
    hasPermission(ctx.session, ctx.masters, "staff", "approve", ctx.rbac) ||
    featureGrantHeld(ctx.session, ctx.masters, "staff.tasks", featureAction, ctx.rbac)
  );
}

/** A staff display name from the session's masters; "" when unknown. */
function label(ctx: ApiAuthContext, staffId: string): string {
  if (!staffId) return "";
  const hit = (ctx.masters.staff ?? []).find((s) => s.id === staffId);
  return hit?.fullName ?? "";
}

export const staffTasksDeps: StaffTasksDeps = {
  requireStaff: (req) => requireStaffApi(req),
  assignAuth: (req) => requireStaffPermissionOrFeature(req, "staff", "approve", "staff.tasks", "create"),
  reviewAuth: (req) => requireStaffPermissionOrFeature(req, "staff", "approve", "staff.tasks", "approve"),

  readTasks: async () => {
    const ctx = await getServerTenantContext();
    if (!ctx) return null;
    const { data, error } = await ctx.sb
      .from("staff_tasks")
      .select(TASK_COLUMNS)
      .eq("tenant_id", ctx.tenantId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(500);
    if (error) return null;
    return (data ?? []).map(staffTaskFromRow).filter((r): r is NonNullable<typeof r> => !!r);
  },

  readUpdates: async (taskId: string) => {
    const ctx = await getServerTenantContext();
    if (!ctx) return null;
    const { data, error } = await ctx.sb
      .from("staff_task_updates")
      .select(UPDATE_COLUMNS)
      .eq("tenant_id", ctx.tenantId)
      .eq("task_id", taskId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) return null;
    return (data ?? []).map(staffTaskUpdateFromRow).filter((r): r is StaffTaskUpdate => !!r);
  },

  writeTasks: (ops) => writeRows("staff_tasks", ops),
  writeUpdates: (ops) => writeRows("staff_task_updates", ops),

  canManage: (ctx) => holds(ctx, "create"),
  canReview: (ctx) => holds(ctx, "approve"),
  selfStaffId: (ctx) => resolveSessionStaff(ctx.session, ctx.masters)?.id ?? null,
  staffLabel: label,
  now: () => new Date(),
  newId: (prefix) => `${prefix}_${randomUUID()}`,
  notify: (ev) => notify(ev),
};
