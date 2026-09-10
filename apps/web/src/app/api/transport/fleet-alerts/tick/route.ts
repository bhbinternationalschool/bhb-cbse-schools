import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/apiRouteAuth.server";
import { runFleetAlertsTick } from "@/lib/fleetLive.server";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Every fifteen minutes, all day: a bus moving outside the transport day, a
 * tank running low, a service or a paper falling due — each sent once to
 * every owner on the roster, on a per-alert cooldown. `?dryRun=1` evaluates
 * and lists without sending. Scheduler: bhb-fleet-alerts-tick.
 */
export async function GET() {
  return NextResponse.json({ service: "fleet-alerts-tick", note: "POST with x-cron-secret every 15 min; ?dryRun=1 to evaluate without sending" });
}

export async function POST(req: Request) {
  if (!requireJobSecret(req, ["CRON_SECRET"], ["x-cron-secret"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const r = await runFleetAlertsTick({ dryRun });
  const failed = r.alerts.some((a) => a.recipients.some((x) => x.wa.startsWith("failed")));
  return NextResponse.json({ ok: !failed, ...r }, { status: failed ? 207 : 200 });
}
