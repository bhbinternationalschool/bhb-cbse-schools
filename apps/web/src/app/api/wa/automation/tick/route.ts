/**
 * Automation tick — the Cloud Scheduler entry point (`bhb-wa-automation-tick`,
 * every 30 minutes 08:00–19:59 IST; see scripts/setup-cloud-scheduler.sh).
 *
 * Guard: WA_DISPATCH_SECRET or CRON_SECRET via x-wa-dispatch-secret /
 * x-cron-secret / Authorization Bearer.
 *
 * POST body (all optional): { forceRuleIds?: string[], dryRun?: boolean }
 *
 * Each tick loads the school's rules from Supabase, builds the REAL audience
 * of every rule that is due (fee defaulters from the Fees desk, etc.), raises
 * an approval card for approval-first rules, and sends auto-mode rules on
 * the spot. A read failure returns 500 — Cloud Scheduler then shows the
 * failure and retries — rather than evaluating an empty rule-set.
 */

import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/apiRouteAuth.server";
import { runServerAutomationTick } from "@/lib/automationEngine.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json({
    service: "wa-automation-tick",
    note: "POST { forceRuleIds?, dryRun? } — evaluates the school's automation rules from the database, raises approvals, sends auto-mode rules, persists. Wired to Cloud Scheduler every 30 min 08:00–19:59 IST.",
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

  let body: { forceRuleIds?: unknown; dryRun?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const result = await runServerAutomationTick({
    forceRuleIds: Array.isArray(body.forceRuleIds)
      ? body.forceRuleIds.map(String)
      : undefined,
    dryRun: body.dryRun === true,
  });

  if (!result.ok) {
    console.error("[automation-tick]", result.error);
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  const { state, ...summary } = result;
  return NextResponse.json({
    ...summary,
    lastTickAt: state?.lastTickAt,
    hint: "Approval-first rules wait in Masters → Automation → Approvals. Auto rules were sent by this tick.",
  });
}
