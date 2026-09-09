/**
 * Online classes tick — "starting soon" nudges and closing classes nobody
 * ended. Guard: CRON_SECRET. Cloud Scheduler runs it every 5 minutes in
 * school hours (scripts/setup-cloud-scheduler.sh).
 */

import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/apiRouteAuth.server";
import { onlineClassesTick } from "@/lib/onlineClasses.server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    service: "online-classes-tick",
    endpoint: "/api/online-classes/tick",
  });
}

export async function POST(req: Request) {
  if (!requireJobSecret(req, ["CRON_SECRET"], ["x-cron-secret"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await onlineClassesTick();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
