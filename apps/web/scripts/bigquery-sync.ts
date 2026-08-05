/**
 * Manual Supabase → BigQuery sync (same logic as cron tick).
 *
 * Usage (from apps/web):
 *   npx tsx scripts/bigquery-sync.ts --dry-run
 *   npx tsx scripts/bigquery-sync.ts
 *   npx tsx scripts/bigquery-sync.ts --tables=fee_vouchers,admission_leads
 */

import { loadEnvLocal } from "./lib/loadEnvLocal";
import { runBigQueryNightlySync } from "../src/lib/bigQuerySync.server";

loadEnvLocal();

function parseArgs() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const tablesArg = argv.find((a) => a.startsWith("--tables="));
  const tableIds = tablesArg
    ? tablesArg
        .split("=")[1]!
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
  const tenantArg = argv.find((a) => a.startsWith("--tenant="));
  const tenantSlug = tenantArg?.split("=")[1]?.trim();
  return { dryRun, tableIds, tenantSlug };
}

async function main() {
  const { dryRun, tableIds, tenantSlug } = parseArgs();
  console.log(
    dryRun
      ? "BigQuery sync — dry run (row counts only)"
      : "BigQuery sync — full export",
  );

  const result = await runBigQueryNightlySync({
    dryRun,
    tableIds,
    tenantSlug,
  });

  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    process.exitCode = 1;
  }
}

void main();
