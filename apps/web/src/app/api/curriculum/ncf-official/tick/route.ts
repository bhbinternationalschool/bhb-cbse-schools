/**
 * NCF class-wise subject sync — the subjects NCERT and CBSE list per class on
 * DIKSHA (lib/ncfOfficial.server.ts). Guard: CRON_SECRET. Cloud Scheduler
 * runs it weekly on the lite service (scripts/setup-cloud-scheduler.sh).
 *
 * POST ?dryRun=1 — read DIKSHA and the stored lists, report, write nothing.
 */

import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/apiRouteAuth.server";
import { syncNcfOfficial } from "@/lib/ncfOfficial.server";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET() {
  return NextResponse.json({
    service: "ncf-official-tick",
    endpoint: "/api/curriculum/ncf-official/tick",
    note: "POST weekly (Cloud Scheduler). ?dryRun=1 reports without writing.",
  });
}

export async function POST(req: Request) {
  if (!requireJobSecret(req, ["CRON_SECRET"], ["x-cron-secret"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  try {
    const result = await syncNcfOfficial({ dryRun });
    // One board failing still answers 200 with the other's result, so the
    // scheduler does not hammer DIKSHA; the failure is in the body.
    return NextResponse.json({ ok: result.boards.every((b) => b.ok), ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
