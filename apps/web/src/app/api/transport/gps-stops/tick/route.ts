import { NextResponse } from "next/server";
import { requireJobSecret, requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { runGpsStopDiscovery } from "@/lib/gpsStopDiscovery.server";
import { runRunOrderTick } from "@/lib/runStopOrder.server";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Nightly (bhb-gps-stops-nightly, 21:30 IST), from the buses' own GPS:
 *  1. add the places each bus has started stopping at regularly as stops,
 *     logged in Transport → Gaps to settle (lib/gpsStopDiscovery.ts);
 *  2. then record each run's stop order and times and renumber every route's
 *     stops to follow the morning pickup (lib/runStopOrder.ts) — after step 1,
 *     so tonight's new stops are placed too.
 * Step 2 runs even if step 1 fails: an order from yesterday's stops is still right.
 *
 * GET  — staff preview (transport view): what tonight would do. Writes nothing.
 * POST — the scheduler, with x-cron-secret. `?dryRun=1` evaluates without writing.
 */
export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "view");
  if (!auth.ok) return auth.response;
  const stops = await runGpsStopDiscovery({ dryRun: true });
  const runs = await runRunOrderTick({ dryRun: true });
  return NextResponse.json({ stops, runs }, { status: stops.ok && runs.ok ? 200 : 502 });
}

export async function POST(req: Request) {
  if (!requireJobSecret(req, ["CRON_SECRET"], ["x-cron-secret"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const stops = await runGpsStopDiscovery({ dryRun });
  const runs = await runRunOrderTick({ dryRun });
  return NextResponse.json({ ok: stops.ok && runs.ok, stops, runs }, { status: stops.ok && runs.ok ? 200 : 502 });
}
