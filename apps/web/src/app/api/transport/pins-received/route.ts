/**
 * GET /api/transport/pins-received — every boarding pin a family has sent on
 * WhatsApp, which children it was saved to, and whether it looks right.
 * See lib/pinsReceived.server.ts.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { buildPinsReceived } from "@/lib/pinsReceived.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "view");
  if (!auth.ok) return auth.response;
  const r = await buildPinsReceived();
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
}
