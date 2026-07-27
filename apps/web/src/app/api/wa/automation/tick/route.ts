/**
 * Automation tick — evaluate due rules (approval-first by default).
 * Guard: WA_DISPATCH_SECRET or CRON_SECRET via x-wa-dispatch-secret / x-cron-secret / Authorization Bearer.
 * POST body: { state?: AutomationState, forceRuleIds?: string[] }
 */

import { NextResponse } from "next/server";
import {
  emptyAutomation,
  evaluateAutomationTick,
  normalizeAutomationState,
  pendingApprovals,
  type AutomationState,
} from "@/lib/automation";

export const runtime = "nodejs";

function authorized(req: Request): boolean {
  const dispatch = process.env.WA_DISPATCH_SECRET || "";
  const cron = process.env.CRON_SECRET || "";
  if (!dispatch && !cron) return true; // open in local/demo
  const hdr =
    req.headers.get("x-wa-dispatch-secret") ||
    req.headers.get("x-cron-secret") ||
    "";
  const bearer = (req.headers.get("authorization") || "").replace(
    /^Bearer\s+/i,
    "",
  );
  if (dispatch && (hdr === dispatch || bearer === dispatch)) return true;
  if (cron && (hdr === cron || bearer === cron)) return true;
  return false;
}

export async function GET() {
  return NextResponse.json({
    service: "wa-automation-tick",
    note: "POST { state?, forceRuleIds? } — returns evaluated automation state. Wire Cloud Scheduler / cron every 5–15 min.",
  });
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { state?: AutomationState; forceRuleIds?: string[] } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const before = normalizeAutomationState(body.state || emptyAutomation());
  const after = evaluateAutomationTick(before, {
    forceRuleIds: Array.isArray(body.forceRuleIds)
      ? body.forceRuleIds.map(String)
      : undefined,
  });
  const pending = pendingApprovals(after);

  return NextResponse.json({
    ok: true,
    lastTickAt: after.lastTickAt,
    pendingApprovals: pending.length,
    autoApproved: after.approvals.filter(
      (a) => a.decidedBy === "auto" && a.createdAt === after.lastTickAt,
    ).length,
    state: after,
    hint: "Persist returned state client-side (or future server blob). Approve pending items in Masters → Automation.",
  });
}
