/**
 * Staff → Leave rules: the year's leave policy and the approver chain.
 *
 * GET  ?ay=2026-27  the policy (null = the year has none yet), the desk's
 *                   leave types, the approvers, and the two-level setting
 * POST {action, …}
 *   seed              start the year's policy from the desk's types/allotments
 *   save_type         {ay, type: {typeCode, defaultDays, halfDayAllowed,
 *                     sandwich, carryForwardCap, insufficientMode}}
 *   save_allocation   {ay, typeCode, staffCategory | staffId, days, note}
 *   delete_allocation {id}
 *   add_approver      {scopeKind, scopeId, level, approverStaffId}
 *   remove_approver   {id}
 *   sync_preview      {ay}  what "Apply to balances" would change on the desk
 *   sync_commit       {ay}  do it (desk allotted / carried forward)
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { writeAudit } from "@/lib/audit.server";
import { readStaffHrServer, saveStaffHrServer } from "@/lib/api/v1/staffLeave";
import { ApiError } from "@/lib/api/v1/errors";
import { normalizeLeaveSettings } from "@/lib/staffHr";
import {
  addApprover,
  buildLeaveBook,
  deleteAllocation,
  readApproverRules,
  readLeavePolicy,
  removeApprover,
  saveAllocation,
  savePolicyType,
  seedPolicyFromDesk,
} from "@/lib/staffLeaveRules.server";
import { applyDeskSync, planDeskSync, type ApproverScopeKind, type LeavePolicyType } from "@/lib/staffLeaveRules";

export const runtime = "nodejs";

const AY = /^\d{4}-\d{2}$/;

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "staff", "view");
  if (!auth.ok) return auth.response;
  const ay = new URL(req.url).searchParams.get("ay") || auth.ctx.session.academicYearCode;
  if (!AY.test(ay)) return bad("Unknown academic year");
  const [policy, approvers, hr] = await Promise.all([readLeavePolicy(ay), readApproverRules(), readStaffHrServer()]);
  // Each part says when it could not be read — never shown as "none".
  if (!policy.ok) return bad(`Could not read the leave policy: ${policy.error}`, 503);
  if (!approvers.ok) return bad(`Could not read the leave approvers: ${approvers.error}`, 503);
  if (!hr.ok) return bad("Could not read the leave desk — try again", 503);
  return NextResponse.json({
    ok: true,
    ay,
    policy: policy.value,
    approvers: approvers.value,
    deskTypes: hr.state.leaveTypes.map((t) => ({ code: t.code, name: t.name, paid: t.paid })),
    twoLevelApproval: normalizeLeaveSettings(hr.state.leaveSettings).twoLevelApproval,
  });
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "staff", "edit");
  if (!auth.ok) return auth.response;
  if (auth.viaMirrorSecret) return bad("Leave rules are changed by a person", 403);
  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return bad("Invalid JSON");
  }
  const { ctx } = auth;
  const by = ctx.session.fullName || ctx.session.email || "staff";
  const action = String(b.action || "");
  const ay = String(b.ay || "");
  const audit = (summary: string, after: unknown, entityId = ay) =>
    writeAudit({ session: ctx.session, module: "staff", action: "edit", entityType: "staff_leave_policy", entityId, summary, after });

  try {
    switch (action) {
      case "seed": {
        if (!AY.test(ay)) return bad("Unknown academic year");
        const hr = await readStaffHrServer();
        if (!hr.ok) return bad("Could not read the leave desk — nothing was saved", 503);
        const r = await seedPolicyFromDesk({ ay, state: hr.state, masters: ctx.masters, by });
        if (!r.ok) return bad(r.error);
        await audit(`Leave policy ${ay} started from the desk (${r.types} types, ${r.overrides} staff allotments)`, r);
        return NextResponse.json(r);
      }
      case "save_type": {
        if (!AY.test(ay)) return bad("Unknown academic year");
        const t = (b.type ?? {}) as Partial<LeavePolicyType>;
        const type: LeavePolicyType = {
          typeCode: String(t.typeCode || "").toUpperCase(),
          defaultDays: Number(t.defaultDays),
          halfDayAllowed: t.halfDayAllowed !== false,
          sandwich: t.sandwich === true,
          carryForwardCap: Number(t.carryForwardCap),
          insufficientMode: t.insufficientMode === "lwp" ? "lwp" : "block",
        };
        const hr = await readStaffHrServer();
        if (!hr.ok) return bad("Could not read the leave desk — nothing was saved", 503);
        if (!hr.state.leaveTypes.some((x) => x.code === type.typeCode)) return bad("That leave type is not on the leave desk");
        const r = await savePolicyType(ay, type, by);
        if (!r.ok) return bad(r.error);
        await audit(`Leave policy ${ay}: ${type.typeCode} rules saved`, type);
        return NextResponse.json(r);
      }
      case "save_allocation": {
        if (!AY.test(ay)) return bad("Unknown academic year");
        const staffId = b.staffId ? String(b.staffId) : null;
        const staffCategory = b.staffCategory ? String(b.staffCategory) : null;
        if (staffId && !(ctx.masters.staff ?? []).some((s) => s.id === staffId)) return bad("Unknown member of staff");
        const a = { typeCode: String(b.typeCode || "").toUpperCase(), staffId, staffCategory, days: Number(b.days), note: String(b.note || "") };
        const r = await saveAllocation(ay, a, by);
        if (!r.ok) return bad(r.error);
        await audit(`Leave policy ${ay}: ${a.typeCode} ${a.days} day(s) for ${staffCategory ?? staffId}`, a);
        return NextResponse.json(r);
      }
      case "delete_allocation": {
        const id = String(b.id || "");
        const r = await deleteAllocation(id);
        if (!r.ok) return bad(r.error);
        await audit("Leave policy allocation removed", { id }, id);
        return NextResponse.json(r);
      }
      case "add_approver": {
        const scopeKind = String(b.scopeKind || "") as ApproverScopeKind;
        const approverStaffId = String(b.approverStaffId || "");
        if (!(ctx.masters.staff ?? []).some((s) => s.id === approverStaffId)) return bad("Unknown approver");
        const rule = { scopeKind, scopeId: String(b.scopeId || ""), level: (Number(b.level) === 2 ? 2 : 1) as 1 | 2, approverStaffId };
        const r = await addApprover(rule, by);
        if (!r.ok) return bad(r.error);
        await audit(`Leave approver added (${scopeKind}${rule.scopeId ? ` ${rule.scopeId}` : ""}, level ${rule.level})`, rule, approverStaffId);
        return NextResponse.json(r);
      }
      case "remove_approver": {
        const id = String(b.id || "");
        const r = await removeApprover(id);
        if (!r.ok) return bad(r.error);
        await audit("Leave approver removed", { id }, id);
        return NextResponse.json(r);
      }
      case "sync_preview":
      case "sync_commit": {
        if (!AY.test(ay)) return bad("Unknown academic year");
        const hr = await readStaffHrServer();
        if (!hr.ok) return bad("Could not read the leave desk — nothing was changed", 503);
        const book = await buildLeaveBook({ ay, masters: ctx.masters, state: hr.state });
        if (!book.ok) return bad(`Could not read the leave policy: ${book.error}`, 503);
        if (!book.value) return bad(`${ay} has no leave policy yet`);
        const plan = planDeskSync({ ay, state: hr.state, book: book.value.book });
        if (action === "sync_preview" || plan.changes.length === 0) {
          return NextResponse.json({ ok: true, committed: false, ...plan });
        }
        const next = applyDeskSync(hr.state, { ay, changes: plan.changes, changedBy: by, now: new Date().toISOString() });
        await saveStaffHrServer(next);
        await audit(`Leave policy ${ay} applied to ${plan.changes.length} desk balance(s)`, { changes: plan.changes.length, refused: plan.refused.length });
        return NextResponse.json({ ok: true, committed: true, ...plan });
      }
      default:
        return bad("Unknown action");
    }
  } catch (e) {
    if (e instanceof ApiError) return bad(e.message, e.status);
    console.error("[leave-policy]", action, (e as Error)?.message);
    return bad("Could not save — try again", 500);
  }
}
