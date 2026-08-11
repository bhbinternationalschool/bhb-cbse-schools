/**
 * WhatsApp WABA setup diagnostics + one-click subscribe fix.
 * GET — report issues. POST { action: "subscribe" } — subscribe app to WABA webhooks.
 */

import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import {
  ensureWabaWebhookSubscription,
  getWhatsAppSetupReport,
} from "@/lib/waMeta.server";

export const runtime = "nodejs";

export async function GET() {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  }
  const report = await getWhatsAppSetupReport();
  return NextResponse.json({
    ok: report.issues.length === 0,
    ...report,
  });
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  }
  let body: { action?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  if (body.action === "subscribe") {
    const result = await ensureWabaWebhookSubscription();
    const report = await getWhatsAppSetupReport();
    return NextResponse.json({
      ok: result.ok,
      subscribed: result.subscribed,
      error: result.error,
      report,
    });
  }

  const report = await getWhatsAppSetupReport();
  return NextResponse.json({
    ok: false,
    error: 'Unknown action. Use { "action": "subscribe" }.',
    report,
  });
}
