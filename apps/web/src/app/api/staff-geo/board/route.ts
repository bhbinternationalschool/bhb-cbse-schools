import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { listStaffGeoIncidents, runStaffGeoTick } from "@/lib/staffGeo.server";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Admin live board + incidents (Staff view, or the staff.gps_presence
 * function). Evaluation is dry — reading the board never raises or alerts. */
export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "staff", "view");
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const date = url.searchParams.get("date") || undefined;
  const [tick, incidents] = await Promise.all([runStaffGeoTick({ dryRun: true }), listStaffGeoIncidents({ date, limit: 300 })]);
  return NextResponse.json({ ok: true, tracking: tick.tracking, date: tick.date, board: tick.board, incidents });
}
