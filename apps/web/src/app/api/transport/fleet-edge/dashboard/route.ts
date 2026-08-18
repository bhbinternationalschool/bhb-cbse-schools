/**
 * Fleet Edge report — GET ?from&to&vehicleRef. Thin wrapper over
 * lib/fleetEdgeReport.server.ts (see its header for the bounding rules).
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { buildFleetEdgeReport } from "@/lib/fleetEdgeReport.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "view");
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const vehicleRef = url.searchParams.get("vehicleRef")?.trim() || null;
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const from = fromParam || defaultFrom;
  const to = toParam || now.toISOString();
  if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to))) {
    return NextResponse.json({ error: "Invalid from/to" }, { status: 400 });
  }

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Server tenant context unavailable" }, { status: 503 });
  }
  const report = await buildFleetEdgeReport(ctx.sb, ctx.tenantId, { from, to, vehicleRef });
  if (!report.ok) return NextResponse.json({ error: report.error }, { status: 500 });
  return NextResponse.json({ ...report, total: report.vehicles.length });
}
