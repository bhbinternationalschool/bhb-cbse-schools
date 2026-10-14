import { NextResponse } from "next/server";
import { requireJobSecret, requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { runGpsStopDiscovery } from "@/lib/gpsStopDiscovery.server";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Nightly (bhb-gps-stops-nightly, 21:30 IST): add the places each bus has
 * started stopping at regularly as stops on its route, and log each one in
 * Transport → Gaps to settle. See lib/gpsStopDiscovery.ts for the rules.
 *
 * GET  — staff preview (transport view): what tonight's run would add. Writes nothing.
 * POST — the scheduler, with x-cron-secret. `?dryRun=1` evaluates without writing.
 */
export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "view");
  if (!auth.ok) return auth.response;
  const r = await runGpsStopDiscovery({ dryRun: true });
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}

export async function POST(req: Request) {
  if (!requireJobSecret(req, ["CRON_SECRET"], ["x-cron-secret"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const r = await runGpsStopDiscovery({ dryRun });
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
