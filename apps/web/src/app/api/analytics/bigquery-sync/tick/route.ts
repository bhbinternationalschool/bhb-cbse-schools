/**
 * Nightly Supabase → BigQuery sync.
 * Guard: CRON_SECRET via x-cron-secret / Authorization Bearer.
 *
 * POST ?dryRun=1 — row counts only, no BigQuery writes.
 * POST body: { dryRun?: boolean, tableIds?: string[], tenantSlug?: string }
 */

import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/apiRouteAuth.server";
import { bigQuerySyncConfigured } from "@/lib/bigQueryClient.server";
import { BIGQUERY_SYNC_TABLES } from "@/lib/bigQuerySyncCatalog";
import { runBigQueryNightlySync } from "@/lib/bigQuerySync.server";
import { postgresConfigured } from "@/lib/postgresPool.server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json({
    service: "bigquery-nightly-sync",
    postgresConfigured: postgresConfigured(),
    bigQueryConfigured: bigQuerySyncConfigured(),
    tables: BIGQUERY_SYNC_TABLES.map((t) => ({
      id: t.id,
      pgTable: t.pgTable,
      bqTable: t.bqTable,
    })),
    note: "POST nightly (Cloud Scheduler 2 AM IST). ?dryRun=1 for counts only.",
  });
}

export async function POST(req: Request) {
  if (
    !requireJobSecret(req, ["CRON_SECRET", "BIGQUERY_SYNC_SECRET"], [
      "x-cron-secret",
      "x-bigquery-sync-secret",
    ])
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  let body: {
    dryRun?: boolean;
    tableIds?: string[];
    tenantSlug?: string;
  } = {};
  try {
    const text = await req.text();
    if (text.trim()) {
      body = JSON.parse(text) as typeof body;
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const dryRun = url.searchParams.get("dryRun") === "1" || !!body.dryRun;

  const result = await runBigQueryNightlySync({
    dryRun,
    tenantSlug: body.tenantSlug,
    tableIds: body.tableIds,
  });

  const status = result.ok ? 200 : 500;
  return NextResponse.json(result, { status });
}
