import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/apiRouteAuth.server";
import { runStaffGeoTick } from "@/lib/staffGeo.server";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Cloud Scheduler every 5 min (x-cron-secret). Evaluates presence, logs
 * incidents, WhatsApps owner/admin/principal on state changes. Idempotent —
 * an open incident is never re-alerted. */
export async function GET() {
  return NextResponse.json({ service: "staff-geo-tick", note: "POST with x-cron-secret; ?dryRun=1 evaluates without writing/alerting" });
}

export async function POST(req: Request) {
  if (!requireJobSecret(req, ["CRON_SECRET", "WA_DISPATCH_SECRET"], ["x-cron-secret", "x-wa-dispatch-secret"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const r = await runStaffGeoTick({ dryRun });
  const { board: _b, ...rest } = r;
  return NextResponse.json({ ...rest, board: dryRun ? r.board : undefined });
}
