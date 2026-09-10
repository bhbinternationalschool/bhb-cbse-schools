/**
 * Approve (or reject / snooze) one automation card, and send it.
 *
 * The desk used to do this in the browser: it looked the template up with
 * `loadWaTemplates()`, which on a page that has not hydrated returns the
 * built-in defaults where nothing is approved — so "Approve & send" posted
 * free text, which reaches nobody outside the 24-hour window. Deciding on
 * the server means the same approved template, the same family language and
 * the same STOP / quiet-hours rules as the scheduled tick.
 *
 * Staff route: RBAC on `wa_automation` approve.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import {
  decideApproval,
  markApprovalDispatched,
  pendingApprovals,
} from "@/lib/automation";
import { dispatchAutomationApproval } from "@/lib/automationDispatch.server";
import {
  loadAutomationFromDb,
  saveAutomationToDb,
} from "@/lib/automationState.server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "wa_automation", "approve");
  if (!auth.ok) return auth.response;

  let body: {
    approvalId?: string;
    decision?: "approved" | "rejected" | "snoozed";
    snoozeHours?: number;
    dryRun?: boolean;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const approvalId = String(body.approvalId || "");
  const decision = body.decision || "approved";
  if (!approvalId) {
    return NextResponse.json({ error: "approvalId is required" }, { status: 400 });
  }

  const before = await loadAutomationFromDb();
  const item = before.approvals.find((a) => a.id === approvalId);
  if (!item) {
    return NextResponse.json({ error: "Approval not found" }, { status: 404 });
  }
  if (item.status !== "pending") {
    return NextResponse.json(
      { error: `This card is already ${item.status}` },
      { status: 409 },
    );
  }

  const by =
    auth.ctx.session.fullName || auth.ctx.session.roleCode || "masters";
  let state = decideApproval(
    before,
    approvalId,
    decision,
    by,
    Math.max(1, Number(body.snoozeHours) || 24),
  );

  let sent = 0;
  let failed = 0;
  let deferred = 0;
  let simulated = 0;
  let error = "";

  if (decision === "approved") {
    const rule = state.rules.find((r) => r.id === item.ruleId);
    const result = await dispatchAutomationApproval({
      item,
      module: rule?.module ?? "general",
      originUrl: req.url,
      dryRun: !!body.dryRun,
    });
    sent = result.sent;
    failed = result.failed;
    deferred = result.deferred;
    simulated = result.simulated;
    error = result.error;
    // A dry run, or a school with no WhatsApp provider configured, must not
    // retire the card: it stays approved so a real send can still happen.
    if (!result.simulatedOnly) {
      state = markApprovalDispatched(
        state,
        approvalId,
        result.ok,
        result.error,
        {
          sent: result.sent,
          failed: result.failed,
          deferred: result.deferred,
        },
      );
    }
  }

  const persisted = await saveAutomationToDb(state);
  if (!persisted.ok) {
    console.error("[automation-approve] persist failed:", persisted.error);
  }

  return NextResponse.json({
    ok: decision !== "approved" || failed === 0,
    decision,
    sent,
    failed,
    deferred,
    simulated,
    error: error || undefined,
    pendingApprovals: pendingApprovals(state).length,
    persisted: persisted.ok,
    persistError: persisted.ok ? undefined : persisted.error,
    state,
  });
}
