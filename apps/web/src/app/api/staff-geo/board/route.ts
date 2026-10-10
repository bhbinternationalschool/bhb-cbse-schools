import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { listStaffGeoIncidents, runStaffGeoTick } from "@/lib/staffGeo.server";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Admin live board + incidents (staff module view). Evaluation is dry —
 * reading the board never raises or alerts. */
export async function GET(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  if (!hasPermission(session, loadMasters(), "staff", "view")) return NextResponse.json({ error: "Staff module access required" }, { status: 403 });
  const url = new URL(req.url);
  const date = url.searchParams.get("date") || undefined;
  const [tick, incidents] = await Promise.all([runStaffGeoTick({ dryRun: true }), listStaffGeoIncidents({ date, limit: 300 })]);
  return NextResponse.json({ ok: true, tracking: tick.tracking, date: tick.date, board: tick.board, incidents });
}
