/**
 * Tata Motors Fleet Edge "TimeBound Push (Webhook) API" — real-time alerts.
 * POST /alerts per Fleet Edge's own spec: FuelDrainAlert, RefuelAlert,
 * GeoFenceEntered, GeoFenceExited, OverSpeedEvent, DriverSOSAlert — pushed
 * as and when they occur. DriverSOSAlert additionally fires an immediate
 * WhatsApp escalation (see ingestFleetEdgeAlert / notifyFleetEdgeSos).
 */

import { NextResponse } from "next/server";
import {
  ingestFleetEdgeAlert,
  isAllowedFleetEdgeSource,
  parseFleetEdgeAlert,
  sourceIpFrom,
} from "@/lib/fleetEdge.server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ service: "fleet-edge-timebound-alerts", ok: true });
}

export async function POST(req: Request) {
  const sourceIp = sourceIpFrom(req);
  console.log("[fleet-edge/alerts] request from", sourceIp);
  if (!isAllowedFleetEdgeSource(sourceIp)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const alert = parseFleetEdgeAlert(body);
  if (!alert) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const result = await ingestFleetEdgeAlert(alert, sourceIp);
  return NextResponse.json({ ok: result.ok, error: result.error });
}
