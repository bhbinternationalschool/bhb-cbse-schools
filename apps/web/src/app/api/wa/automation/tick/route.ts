/**
 * Automation tick — evaluate due rules (approval-first by default).
 * Guard: WA_DISPATCH_SECRET or CRON_SECRET via x-wa-dispatch-secret / x-cron-secret / Authorization Bearer.
 * POST body: { state?: AutomationState, forceRuleIds?: string[] }
 * With no body.state (the Cloud Scheduler path) the tick loads the tenant's
 * automation state from Supabase, evaluates it server-side, and persists the
 * result back — an empty POST must never evaluate an empty ruleset.
 */

import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/apiRouteAuth.server";
import {
  evaluateAutomationTick,
  normalizeAutomationState,
  pendingApprovals,
  type AutomationState,
} from "@/lib/automation";
import {
  loadAutomationFromDb,
  saveAutomationToDb,
} from "@/lib/automationState.server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    service: "wa-automation-tick",
    note: "POST { state?, forceRuleIds? } — evaluates DB-loaded automation state (or the posted state) and persists the result. Wire Cloud Scheduler / cron every 5–15 min.",
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

  let body: { state?: AutomationState; forceRuleIds?: string[] } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const before = body.state
    ? normalizeAutomationState(body.state)
    : await loadAutomationFromDb();
  const after = evaluateAutomationTick(before, {
    forceRuleIds: Array.isArray(body.forceRuleIds)
      ? body.forceRuleIds.map(String)
      : undefined,
  });
  const pending = pendingApprovals(after);
  const persisted = await saveAutomationToDb(after);
  if (!persisted.ok) {
    console.error("[automation-tick] persist failed:", persisted.error);
  }

  return NextResponse.json({
    ok: true,
    lastTickAt: after.lastTickAt,
    pendingApprovals: pending.length,
    autoApproved: after.approvals.filter(
      (a) => a.decidedBy === "auto" && a.createdAt === after.lastTickAt,
    ).length,
    stateSource: body.state ? "request" : "db",
    persisted: persisted.ok,
    persistError: persisted.ok ? undefined : persisted.error,
    state: after,
    hint: "State is persisted server-side. Approve pending items in Masters → Automation.",
  });
}
