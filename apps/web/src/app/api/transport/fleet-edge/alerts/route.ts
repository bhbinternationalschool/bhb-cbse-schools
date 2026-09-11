/**
 * Tata Motors Fleet Edge push endpoint — the alerts URL.
 *
 * Was the TimeBound Push real-time alert receiver (FuelDrainAlert,
 * RefuelAlert, GeoFenceEntered, GeoFenceExited, OverSpeedEvent,
 * DriverSOSAlert). Fleet Edge accepts one endpoint per fleet, so this now
 * dispatches on payload shape like the other two — and, more to the point,
 * the other two now reach the alert path, which is where the panic-button
 * escalation lives (ingestFleetEdgeAlert / notifyFleetEdgeSos /
 * SOS_ALERT_NAMES — live traffic uses "PanicSosEvent", not the vendor doc's
 * "DriverSOSAlert" sample name, so both are treated as the trigger).
 */

import { NextResponse } from "next/server";
import {
  ingestFleetEdgePush,
  isAllowedFleetEdgeSource,
  sourceIpFrom,
} from "@/lib/fleetEdge.server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ service: "fleet-edge-push", ok: true });
}

export async function POST(req: Request) {
  const sourceIp = sourceIpFrom(req);
  if (!isAllowedFleetEdgeSource(sourceIp)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await ingestFleetEdgePush(body, sourceIp);
  console.log("[fleet-edge/alerts]", result.kind ?? "unparseable", "from", sourceIp);
  if (!result.kind) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  return NextResponse.json({ ok: result.ok, kind: result.kind, error: result.error });
}
