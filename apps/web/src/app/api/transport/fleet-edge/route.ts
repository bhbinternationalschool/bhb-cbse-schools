/**
 * Tata Motors Fleet Edge push endpoint — the root URL.
 *
 * Was the TimeBound Push "periodic details" receiver. Fleet Edge accepts one
 * endpoint per fleet, so this now dispatches on payload shape exactly like
 * /live and /alerts: all three are the same endpoint under three names, and
 * moving the URL in Tata's portal can no longer switch a stream off. Kept
 * because it is what the portal held until 8 September 2026 and may hold
 * again, and because a stream that starts arriving here must not be lost.
 *
 * GET exists so Tata's subscription-portal "CHECK" endpoint-reachability
 * step has something to succeed against before POST traffic ever starts.
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
  console.log("[fleet-edge/root]", result.kind ?? "unparseable", "from", sourceIp);
  if (!result.kind) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  return NextResponse.json({ ok: result.ok, kind: result.kind, error: result.error });
}
