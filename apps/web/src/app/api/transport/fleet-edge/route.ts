/**
 * Tata Motors Fleet Edge "TimeBound Push (Webhook) API" — periodic details.
 * POST /(root) per Fleet Edge's own spec: a windowed (from/to) summary of
 * vehicleSafety/vehiclePerformance/vehicleEfficiency/vehicleHealth, pushed
 * on the frequency configured at subscription time.
 *
 * GET exists only so Tata's subscription-portal "CHECK" endpoint-reachability
 * step has something to succeed against before POST traffic ever starts.
 */

import { NextResponse } from "next/server";
import {
  ingestFleetEdgeDetails,
  isAllowedFleetEdgeSource,
  parseFleetEdgeDetails,
  sourceIpFrom,
} from "@/lib/fleetEdge.server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ service: "fleet-edge-timebound-details", ok: true });
}

export async function POST(req: Request) {
  const sourceIp = sourceIpFrom(req);
  console.log("[fleet-edge/details] request from", sourceIp);
  if (!isAllowedFleetEdgeSource(sourceIp)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const details = parseFleetEdgeDetails(body);
  if (!details) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const result = await ingestFleetEdgeDetails(details, sourceIp);
  return NextResponse.json({ ok: result.ok, error: result.error });
}
