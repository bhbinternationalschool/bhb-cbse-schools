/**
 * Masters → Automation desk API. The screen is a view over the SERVER's
 * copy of the rules: every edit, approval and "run now" is applied here,
 * against the state the scheduler ticks, and the whole state is returned.
 *
 * Until 2026-09 the screen edited a localStorage copy and pushed it whole,
 * so a browser that had been open since morning overwrote the approvals
 * the scheduler had raised — and "Evaluate now" ran the evaluator in the
 * browser, where the fee desk is not loaded, with two sample numbers.
 *
 *   GET                      → { state }
 *   POST { op: ... }         → { ok, state, ... }
 *
 * ops:
 *   create   { rule }                          (wa_automation:create)
 *   update   { ruleId, patch }                 (wa_automation:edit)
 *   enable   { ruleId, enabled }               (wa_automation:edit)
 *   mode     { ruleId, mode }                  (wa_automation:edit)
 *   tested   { ruleId }                        (wa_automation:edit)
 *   delete   { ruleId }                        (wa_automation:edit)
 *   preview  { ruleId, ignoreCap? }            (wa_automation:view)  — who would get it, no send
 *   run      { ruleIds }                       (wa_automation:approve) — evaluate now, real audiences
 *   approve  { approvalId }                    (wa_automation:approve) — send
 *   reject   { approvalId }                    (wa_automation:approve)
 *   snooze   { approvalId, hours? }            (wa_automation:approve)
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import {
  createAutomationRule,
  decideApproval,
  deleteAutomationRule,
  markRuleTested,
  setRuleEnabled,
  setRuleExecutionMode,
  updateAutomationRule,
  type AutomationRulePatch,
  type AutomationState,
  type CreateAutomationRuleOpts,
} from "@/lib/automation";
import {
  dispatchApprovalServer,
  previewRuleAudience,
  runServerAutomationTick,
} from "@/lib/automationEngine.server";
import {
  loadAutomationFromDb,
  saveAutomationToDb,
} from "@/lib/automationState.server";
import type { RbacAction } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Body = {
  op?: string;
  rule?: CreateAutomationRuleOpts;
  ruleId?: string;
  ruleIds?: string[];
  patch?: AutomationRulePatch;
  enabled?: boolean;
  mode?: "approval_first" | "auto";
  approvalId?: string;
  hours?: number;
  ignoreCap?: boolean;
};

const OP_ACTION: Record<string, RbacAction> = {
  create: "create",
  update: "edit",
  enable: "edit",
  mode: "edit",
  tested: "edit",
  delete: "edit",
  preview: "view",
  run: "approve",
  approve: "approve",
  reject: "approve",
  snooze: "approve",
};

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

async function persist(state: AutomationState) {
  const saved = await saveAutomationToDb(state);
  if (!saved.ok) throw new Error(saved.error || "Could not save automation state");
  return state;
}

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "wa_automation", "view");
  if (!auth.ok) return auth.response;
  const read = await loadAutomationFromDb();
  if (!read.ok) return bad(read.error, 503);
  return NextResponse.json({ ok: true, state: read.state, source: read.source });
}

export async function POST(req: Request) {
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return bad("Invalid JSON body");
  }
  const op = String(body.op || "");
  const action = OP_ACTION[op];
  if (!action) return bad(`Unknown op "${op}"`);

  const auth = await requireStaffPermission(req, "wa_automation", action);
  if (!auth.ok) return auth.response;
  const by = auth.ctx.session.fullName || auth.ctx.session.roleCode || "masters";

  const read = await loadAutomationFromDb();
  if (!read.ok) return bad(read.error, 503);
  const state = read.state;

  try {
    switch (op) {
      case "create": {
        if (!body.rule || !String(body.rule.name || "").trim()) return bad("Rule name is required");
        const { state: next, rule } = createAutomationRule(state, body.rule);
        await persist(next);
        return NextResponse.json({ ok: true, state: next, ruleId: rule.id });
      }
      case "update": {
        if (!body.ruleId || !body.patch) return bad("ruleId and patch are required");
        if (!state.rules.some((r) => r.id === body.ruleId)) return bad("Rule not found", 404);
        const next = updateAutomationRule(state, body.ruleId, body.patch);
        await persist(next);
        return NextResponse.json({ ok: true, state: next });
      }
      case "enable": {
        if (!body.ruleId) return bad("ruleId is required");
        const next = setRuleEnabled(state, body.ruleId, body.enabled !== false);
        await persist(next);
        return NextResponse.json({ ok: true, state: next });
      }
      case "mode": {
        if (!body.ruleId || !body.mode) return bad("ruleId and mode are required");
        const r = setRuleExecutionMode(state, body.ruleId, body.mode);
        if (!r.ok) return bad(r.reason);
        await persist(r.state);
        return NextResponse.json({ ok: true, state: r.state });
      }
      case "tested": {
        if (!body.ruleId) return bad("ruleId is required");
        const next = markRuleTested(state, body.ruleId);
        await persist(next);
        return NextResponse.json({ ok: true, state: next });
      }
      case "delete": {
        if (!body.ruleId) return bad("ruleId is required");
        const r = deleteAutomationRule(state, body.ruleId);
        if (!r.ok) return bad(r.reason);
        await persist(r.state);
        return NextResponse.json({ ok: true, state: r.state });
      }
      case "preview": {
        if (!body.ruleId) return bad("ruleId is required");
        const preview = await previewRuleAudience(state, body.ruleId, {
          ignoreCap: body.ignoreCap === true,
        });
        return NextResponse.json({ ok: true, state, preview });
      }
      case "run": {
        const ids = Array.isArray(body.ruleIds) ? body.ruleIds.map(String) : [];
        if (!ids.length) return bad("ruleIds is required");
        const result = await runServerAutomationTick({ forceRuleIds: ids });
        if (!result.ok) return bad(result.error || "Tick failed", 500);
        return NextResponse.json({
          ok: true,
          state: result.state,
          notes: result.notes,
          autoSent: result.autoSent,
          autoFailed: result.autoFailed,
          pendingApprovals: result.pendingApprovals,
        });
      }
      case "approve": {
        if (!body.approvalId) return bad("approvalId is required");
        const r = await dispatchApprovalServer(state, body.approvalId, by);
        // Save whatever happened — a failed send is a failed card, not a lost one.
        if (r.state !== state) await persist(r.state);
        return NextResponse.json({
          ok: r.ok,
          state: r.state,
          error: r.error,
          outcome: r.outcome,
        });
      }
      case "reject":
      case "snooze": {
        if (!body.approvalId) return bad("approvalId is required");
        if (!state.approvals.some((a) => a.id === body.approvalId)) return bad("Approval not found", 404);
        const next = decideApproval(
          state,
          body.approvalId,
          op === "reject" ? "rejected" : "snoozed",
          by,
          Math.max(1, Number(body.hours) || 24),
        );
        await persist(next);
        return NextResponse.json({ ok: true, state: next });
      }
      default:
        return bad(`Unknown op "${op}"`);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Automation desk error";
    console.error("[automation-desk]", op, message);
    return bad(message, 500);
  }
}
