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
import { approveRefusal, cardBuiltAt } from "@/lib/automationSendRules";
import { dispatchAutomationApproval } from "@/lib/automationDispatch.server";
import {
  loadAutomationFromDb,
  saveAutomationToDb,
} from "@/lib/automationState.server";
import {
  automationApprovalClaimKey,
  claimSendOnce,
  releaseSendClaim,
} from "@/lib/waSendClaim.server";

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

  /*
    The same rules the scheduled tick keeps, before anything is claimed.

    On 14 September 2026 a run was started at 00:28 IST and approved at
    00:30, and 104 families were sent a fee reminder after midnight: the
    rule's 20:00–08:00 setting only ever stopped the SCHEDULER, never this
    button. And the tick already refused a card older than 12 hours — its
    amounts are a snapshot — but this button did not, so a card from 14 Sep
    sat pending for a week, 51 of its families having paid since.

    Stale: the card is closed with the reason, as the tick closes one, and
    the next evaluation raises a fresh list. Quiet hours: the card is left
    exactly as it was, to approve in the morning.
  */
  if (decision === "approved") {
    const rule = before.rules.find((r) => r.id === item.ruleId);
    // Timed from the last refresh, not first raising — see cardBuiltAt.
    const refusal = approveRefusal({
      rule,
      item: { createdAt: cardBuiltAt(item, before.runs) },
      now: new Date(),
    });
    if (refusal?.kind === "stale") {
      const closed = markApprovalDispatched(before, approvalId, false, refusal.message, {
        sent: 0,
        failed: 0,
      });
      const saved = await saveAutomationToDb(closed);
      return NextResponse.json(
        {
          ok: false,
          stale: true,
          error: refusal.message,
          pendingApprovals: pendingApprovals(closed).length,
          persisted: saved.ok,
          state: closed,
        },
        { status: 409 },
      );
    }
    if (refusal?.kind === "quiet") {
      return NextResponse.json(
        { ok: false, quietHours: true, error: refusal.message },
        { status: 409 },
      );
    }
  }

  /*
    Claim the send BEFORE deciding, and only for a real send.

    The pending check above is a read. On 11 September 2026 seven presses
    of "Approve & send", ~10 seconds apart, all read the same pending card
    — the status was written only after the dispatch returned — and 146
    families got the same fee reminder seven times. The claim is a row
    insert, so the database refuses the second caller instead of this
    route hoping there isn't one.

    Rejecting and snoozing send nothing and need no claim.
  */
  const claimKey = automationApprovalClaimKey(approvalId);
  let claimed = false;
  if (decision === "approved") {
    const claim = await claimSendOnce(
      claimKey,
      by,
      `${item.dispatchPayload.length} recipients · rule ${item.ruleId}`,
    );
    if (!claim.ok) {
      return NextResponse.json(
        {
          error: claim.message,
          reason: claim.reason,
          alreadySending: claim.reason === "held",
        },
        { status: claim.reason === "held" ? 409 : 503 },
      );
    }
    claimed = true;
  }

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
  let skippedRecent = 0;
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
    skippedRecent = result.skippedRecent ?? 0;
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
    } else if (claimed) {
      // Nothing left the building (dry run, or no WhatsApp provider), so
      // the card must stay pressable. A claim is only kept when a real
      // message went out — that row is what stops a second copy.
      await releaseSendClaim(claimKey);
      claimed = false;
    }
    if (claimed && result.sent === 0 && result.failed === 0 && result.deferred === 0) {
      // Nobody was reachable at all (every recipient skipped). Same rule:
      // no message means no lock.
      await releaseSendClaim(claimKey);
      claimed = false;
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
    skippedRecent,
    error: error || undefined,
    pendingApprovals: pendingApprovals(state).length,
    locked: claimed,
    persisted: persisted.ok,
    persistError: persisted.ok ? undefined : persisted.error,
    state,
  });
}
