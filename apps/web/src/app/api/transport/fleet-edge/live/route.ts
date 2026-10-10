/**
 * Tata Motors Fleet Edge — the push endpoint the subscription portal points at.
 *
 * Named /live because it was built for the Basic Push (continuous
 * VehicleTelemetry) spec, and it is the URL this fleet's single subscription
 * slot currently holds. It is no longer telemetry-only: Fleet Edge accepts
 * one endpoint per fleet, so whatever is configured receives alerts and
 * periodic summaries too. ingestFleetEdgePush reads each payload and routes
 * it — see its header for why guessing was costing SOS escalations.
 *
 * Deliberately always 200 on an accepted payload — the spec documents a 404
 * "No vehicle registered" response as valid, but a brand-new vehicle reports
 * telemetry before it even has a registration number or a FleetVehicle
 * record to be "registered" against; rejecting unrecognized vehicles would
 * reject exactly the ones being onboarded.
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
  console.log("[fleet-edge/live]", result.kind ?? "unparseable", "from", sourceIp);
  if (!result.kind) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  return NextResponse.json({ ok: result.ok, kind: result.kind, error: result.error });
}
