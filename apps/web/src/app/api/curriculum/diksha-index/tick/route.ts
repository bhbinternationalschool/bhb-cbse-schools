/**
 * NCERT chapter index sync — DIKSHA's current NCERT textbooks for Classes 1–8,
 * chapter by chapter (lib/dikshaIndex.server.ts). Guard: CRON_SECRET. Cloud
 * Scheduler runs it weekly on the lite service (scripts/setup-cloud-scheduler.sh).
 *
 * POST ?dryRun=1 — read DIKSHA and the stored index, report, write nothing.
 * POST ?force=1  — refetch every book, not only those DIKSHA republished.
 */

import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/apiRouteAuth.server";
import { syncDikshaIndex } from "@/lib/dikshaIndex.server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json({
    service: "diksha-index-tick",
    endpoint: "/api/curriculum/diksha-index/tick",
    note: "POST weekly (Cloud Scheduler). ?dryRun=1 reports without writing; ?force=1 refetches every book.",
  });
}

export async function POST(req: Request) {
  if (!requireJobSecret(req, ["CRON_SECRET"], ["x-cron-secret"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  try {
    const result = await syncDikshaIndex({
      dryRun: url.searchParams.get("dryRun") === "1",
      force: url.searchParams.get("force") === "1",
    });
    // A partial failure still answers 200 with the list, so the scheduler
    // does not retry the books that did save; a failed catalogue read is 500.
    return NextResponse.json({ ok: result.failed.length === 0, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
