/**
 * Deciding leave from WhatsApp.
 *
 * The gate is the SAME rule the leave API uses — assertLeaveApprover lets
 * leadership through and refuses everyone else — resolved here from the
 * sender's designation via staffHomeKind, because a WhatsApp number has no
 * login session to carry RBAC. Reusing the rule rather than writing a
 * second one is the point: two rules for who may grant leave is one rule
 * that will drift.
 *
 * Seeing the queue is not deciding it, so LEAVE lists for any staff member
 * and only LEAVE OK / LEAVE NO need the authority.
 */

import "server-only";

import { getServerTenantContext } from "@/lib/serverTenant";
import { loadServerMasters } from "@/lib/api/v1/auth";
import { staffHomeKind } from "@/lib/staffHomeKind";
import type { StaffRecord } from "@/lib/foundationMasters";
import {
  composeLeaveDecisionReply,
  composeLeaveList,
  composeLeaveNeedsIndex,
  composeLeaveNotAllowed,
  parseLeaveCommand,
  type LeavePendingLine,
} from "@/lib/leaveCommandEngine";

export type LeaveCommandOutcome =
  | { handled: false }
  | { handled: true; text: string };

/** The undecided queue, oldest start date first — the order the list shows. */
async function pendingQueue(): Promise<
  { line: LeavePendingLine; requestId: string }[]
> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const masters = await loadServerMasters();
  const nameOf = new Map(
    (masters.staff ?? []).map((s) => [s.id, s.fullName || s.id]),
  );

  const [{ data: rows, error }, { data: types }] = await Promise.all([
    ctx.sb
      .from("staff_leave_requests")
      .select("id, staff_id, type_code, from_date, to_date, days, status")
      // pending_l2 is a request that cleared level one and is still
      // undecided; leaving it out would hide exactly what a principal is
      // being asked to settle.
      .in("status", ["pending", "pending_l2"])
      .eq("tenant_id", ctx.tenantId)
      .order("from_date", { ascending: true }),
    ctx.sb.from("staff_leave_types").select("code, name").eq("tenant_id", ctx.tenantId),
  ]);
  if (error) {
    console.warn("[leaveCommand] queue read failed", error.message);
    return [];
  }
  const typeName = new Map(
    (types || []).map((t) => [String(t.code), String(t.name || t.code)]),
  );

  return (rows || []).map((r, i) => ({
    requestId: String(r.id),
    line: {
      index: i + 1,
      name: nameOf.get(String(r.staff_id)) || String(r.staff_id),
      typeLabel: typeName.get(String(r.type_code)) || String(r.type_code),
      fromDate: String(r.from_date || ""),
      toDate: String(r.to_date || ""),
      days: Number(r.days) || 0,
    },
  }));
}

async function mayDecide(staff: StaffRecord | null): Promise<boolean> {
  if (!staff) return false;
  const masters = await loadServerMasters();
  const designation =
    (masters.designations ?? []).find((d) => d.id === (staff.designationId || ""))
      ?.name || "";
  return (
    staffHomeKind({
      roleCode: "",
      designation,
      stream: staff.stream || "",
      teachesClasses: false,
    }) === "leadership"
  );
}

export async function handleLeaveCommand(opts: {
  text: string;
  staff: StaffRecord | null;
  by: string;
}): Promise<LeaveCommandOutcome> {
  const cmd = parseLeaveCommand(opts.text);
  if (cmd.kind === "not_a_command") return { handled: false };

  const queue = await pendingQueue();

  if (cmd.kind === "list") {
    return { handled: true, text: composeLeaveList(queue.map((q) => q.line)) };
  }
  if (cmd.kind === "needs_index") {
    return {
      handled: true,
      text: composeLeaveNeedsIndex(cmd.decision, queue.length),
    };
  }

  if (!(await mayDecide(opts.staff))) {
    return { handled: true, text: composeLeaveNotAllowed() };
  }

  const target = queue[cmd.index - 1];
  if (!target) {
    return {
      handled: true,
      text: composeLeaveNeedsIndex(cmd.decision, queue.length),
    };
  }

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return {
      handled: true,
      text: composeLeaveDecisionReply({
        ok: false,
        decision: cmd.decision,
        name: target.line.name,
        typeLabel: target.line.typeLabel,
        fromDate: target.line.fromDate,
        toDate: target.line.toDate,
        error: "the ERP is not reachable just now",
      }),
    };
  }

  // Only from a still-undecided row: two people replying at once must not
  // both record a decision, and the second one is told it was already
  // settled rather than silently overwriting the first.
  const { data, error } = await ctx.sb
    .from("staff_leave_requests")
    .update({
      status: cmd.decision,
      decided_by: opts.by || "whatsapp",
      decided_at: new Date().toISOString(),
      decision_note: `Decided on WhatsApp by ${opts.by || "leadership"}`,
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", target.requestId)
    .in("status", ["pending", "pending_l2"])
    .select("id");

  const changed = (data || []).length > 0;
  return {
    handled: true,
    text: composeLeaveDecisionReply({
      ok: !error && changed,
      decision: cmd.decision,
      name: target.line.name,
      typeLabel: target.line.typeLabel,
      fromDate: target.line.fromDate,
      toDate: target.line.toDate,
      error: error
        ? error.message
        : changed
          ? ""
          : "somebody decided it first — open Staff → Leave to see who",
    }),
  };
}
