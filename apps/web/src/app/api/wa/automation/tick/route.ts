/**
 * Automation tick — evaluate due rules and SEND what is approved.
 * Guard: WA_DISPATCH_SECRET or CRON_SECRET via x-wa-dispatch-secret / x-cron-secret / Authorization Bearer.
 * POST body: { state?: AutomationState, forceRuleIds?: string[], dryRun?: boolean }
 * With no body.state (the Cloud Scheduler path) the tick loads the tenant's
 * automation state from Supabase, evaluates it server-side, dispatches every
 * approved item through /api/wa/dispatch, and persists the result — an empty
 * POST must never evaluate an empty ruleset, and an auto-run rule must never
 * report a completed run it did not actually send.
 */

import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/apiRouteAuth.server";
import { normalizeAutomationState, type AutomationState } from "@/lib/automation";
import { runAutomationTick } from "@/lib/automationTick.server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    service: "wa-automation-tick",
    note: "POST { state?, forceRuleIds?, dryRun? } — evaluates DB-loaded automation state, sends approved items, persists the result. Wire Cloud Scheduler / cron every 5–15 min.",
  });
}

export async function POST(req: Request) {
  if (
    !requireJobSecret(req, ["WA_DISPATCH_SECRET", "CRON_SECRET"], [
      "x-wa-dispatch-secret",
      "x-cron-secret",
    ])
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    state?: AutomationState;
    forceRuleIds?: string[];
    dryRun?: boolean;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const report = await runAutomationTick({
    originUrl: req.url,
    state: body.state ? normalizeAutomationState(body.state) : undefined,
    forceRuleIds: Array.isArray(body.forceRuleIds)
      ? body.forceRuleIds.map(String)
      : undefined,
    dryRun: !!body.dryRun,
  });

  return NextResponse.json({
    ok: true,
    lastTickAt: report.lastTickAt,
    pendingApprovals: report.pendingApprovals,
    dispatchedApprovals: report.dispatched,
    sent: report.sent,
    failed: report.failed,
    deferred: report.deferred,
    audienceErrors: report.audienceErrors,
    stateSource: body.state ? "request" : "db",
    persisted: report.persisted,
    persistError: report.persistError,
    state: report.state,
    hint: "Auto-run rules are sent by this tick. Approval-first rules wait in Masters → Automation and are sent by the next tick once approved.",
  });
}
