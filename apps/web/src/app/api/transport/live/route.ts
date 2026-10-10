/**
 * GET /api/transport/live — every active vehicle with its latest Fleet Edge
 * position (tracked or not), for the Live map. Staff with transport view.
 * `?track=<vehicleRef>&minutes=60` adds one vehicle's recent trail.
 */
import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { buildLiveFleet, readVehicleTrack } from "@/lib/fleetLive.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "view");
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const track = (url.searchParams.get("track") || "").trim();
  const minutes = Math.max(5, Math.min(24 * 60, Number(url.searchParams.get("minutes")) || 60));
  const live = await buildLiveFleet();
  const trail = track ? await readVehicleTrack(track, minutes) : [];
  return NextResponse.json({ ok: true, at: new Date().toISOString(), ...live, trail }, { headers: { "Cache-Control": "no-store" } });
}
