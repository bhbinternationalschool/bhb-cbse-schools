/**
 * GET /api/transport/live-positions — where each vehicle is, right now.
 *
 * The transport Live tab has always drawn positions from `state.gpsPings`, a
 * desk-local array filled in by hand, while the only real position source —
 * the Fleet Edge /live push — landed in fleet_edge_events and was read by
 * nobody. This is what closes that gap.
 *
 * Staff only, transport module. Positions of vehicles carrying children are
 * not public, and the parent-facing answer is a separate, narrower thing:
 * see parentPositionVerdict() for what a family may be told and when.
 */
import { NextResponse } from "next/server";

import { jsonApiError, requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { readLiveVehiclePositions } from "@/lib/fleetLivePosition.server";
import {
  positionAgeLabel,
  positionFreshness,
  vehicleMotion,
} from "@/lib/fleetLivePosition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await requireStaffPermission(req, "transport", "view");
    if (!auth.ok) return auth.response;

    const r = await readLiveVehiclePositions();
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });

    const nowMs = Date.now();
    return NextResponse.json({
      ok: true,
      // Sent so a client rendering "4 min ago" is not at the mercy of a
      // wrong clock on the viewing device.
      serverNow: new Date(nowMs).toISOString(),
      positions: r.positions.map((p) => ({
        vehicleRef: p.vehicleRef,
        registrationNumber: p.registrationNumber,
        lat: p.position.lat,
        lng: p.position.lng,
        speed: p.position.speed,
        ignitionOn: p.position.ignitionOn,
        at: p.position.at,
        ageLabel: positionAgeLabel(p.position.at, nowMs),
        freshness: positionFreshness(p.position.at, nowMs),
        motion: vehicleMotion(p.position),
      })),
    });
  } catch (e) {
    return jsonApiError(e);
  }
}
