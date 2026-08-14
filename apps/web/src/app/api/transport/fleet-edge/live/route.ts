/**
 * Tata Motors Fleet Edge "Basic Push (Webhook) API" — continuous
 * VehicleTelemetry (gpsLatitude/gpsLongitude/speed/ignitionOn/fuel/etc),
 * one flat snapshot per push, no time window. Deliberately always 200 —
 * the spec documents a 404 "No vehicle registered" response as valid, but
 * a brand-new vehicle reports telemetry before it even has a registration
 * number or a FleetVehicle record to be "registered" against; rejecting
 * unrecognized vehicles would reject exactly the ones being onboarded.
 */

import { NextResponse } from "next/server";
import {
  ingestFleetEdgeTelemetry,
  isAllowedFleetEdgeSource,
  parseFleetEdgeTelemetry,
  sourceIpFrom,
} from "@/lib/fleetEdge.server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ service: "fleet-edge-basic-push-telemetry", ok: true });
}

export async function POST(req: Request) {
  const sourceIp = sourceIpFrom(req);
  console.log("[fleet-edge/live] request from", sourceIp);
  if (!isAllowedFleetEdgeSource(sourceIp)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const telemetry = parseFleetEdgeTelemetry(body);
  if (!telemetry) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const result = await ingestFleetEdgeTelemetry(telemetry, sourceIp);
  return NextResponse.json({ ok: result.ok, error: result.error });
}
