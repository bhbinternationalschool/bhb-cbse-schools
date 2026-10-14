import { NextResponse } from "next/server";
import { requireJobSecret, requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { runGpsStopDiscovery } from "@/lib/gpsStopDiscovery.server";
import { runRunOrderTick } from "@/lib/runStopOrder.server";
import { runTransportAudit } from "@/lib/transportAudit.server";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Nightly (bhb-gps-stops-nightly, 21:30 IST), from the buses' own GPS:
 *  1. add the places each bus has started stopping at regularly as stops,
 *     logged in Transport → Gaps to settle (lib/gpsStopDiscovery.ts);
 *  2. then record each run's stop order and times and renumber every route's
 *     stops to follow the morning pickup (lib/runStopOrder.ts) — after step 1,
 *     so tonight's new stops are placed too;
 *  3. then the transport audit (lib/transportAudit.ts): children to move,
 *     possible road closures, and — on Mondays, or with `?routes=1` — a
 *     shorter order for each run (Google Directions).
 * Each step runs even if an earlier one fails: their inputs are independent enough.
 *
 * GET  — staff preview (transport view): what tonight would do. Writes nothing.
 * POST — the scheduler, with x-cron-secret. `?dryRun=1` evaluates without writing.
 */
export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "view");
  if (!auth.ok) return auth.response;
  const withRouteOrders = new URL(req.url).searchParams.get("routes") === "1";
  const stops = await runGpsStopDiscovery({ dryRun: true });
  const runs = await runRunOrderTick({ dryRun: true });
  const audit = await runTransportAudit({ dryRun: true, withRouteOrders });
  return NextResponse.json({ stops, runs, audit }, { status: stops.ok && runs.ok && audit.ok ? 200 : 502 });
}

export async function POST(req: Request) {
  if (!requireJobSecret(req, ["CRON_SECRET"], ["x-cron-secret"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  // Route orders cost Google calls and change slowly: Mondays (IST), or on request.
  const istWeekday = new Date(Date.now() + 5.5 * 3600_000).getUTCDay();
  const withRouteOrders = url.searchParams.get("routes") === "1" || istWeekday === 1;
  const stops = await runGpsStopDiscovery({ dryRun });
  const runs = await runRunOrderTick({ dryRun });
  const audit = await runTransportAudit({ dryRun, withRouteOrders });
  const ok = stops.ok && runs.ok && audit.ok;
  return NextResponse.json({ ok, stops, runs, audit }, { status: ok ? 200 : 502 });
}
