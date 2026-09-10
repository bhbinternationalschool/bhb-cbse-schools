/**
 * "Run evaluation now" from Masters → Automation.
 *
 * The desk used to evaluate in the BROWSER, where no roster, no fee ledger
 * and no admissions pipeline can be read — so every card it raised was
 * built from two hardcoded demo mobiles. The button now asks the server to
 * do exactly what the cron tick does, against the same live data, and the
 * desk re-reads the persisted result.
 *
 * Staff route: RBAC on `wa_automation` edit, not the job secret.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { runAutomationTick } from "@/lib/automationTick.server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "wa_automation", "edit");
  if (!auth.ok) return auth.response;

  let body: { forceRuleIds?: string[]; dryRun?: boolean } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const report = await runAutomationTick({
    originUrl: req.url,
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
    persisted: report.persisted,
    persistError: report.persistError,
    state: report.state,
  });
}
