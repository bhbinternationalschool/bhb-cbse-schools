import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/apiRouteAuth.server";
import { checkFeeIntegrity } from "@/lib/feeIntegrityAlert.server";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Hourly watch for fee receipts that have lost their breakdown.
 *
 * Point Cloud Scheduler at this with `x-cron-secret`, hourly. It reads the fee
 * desk, and if any live receipt holds money with no lines it sends WhatsApp to
 * FEE_INTEGRITY_NOTIFY_MOBILE and logs an error — rather than waiting for
 * somebody to open the Accounts controls page, which is what happened both
 * times this went wrong.
 *
 * `?dryRun=1` reports without sending.
 */
export async function GET() {
  return NextResponse.json({
    service: "fee-integrity-tick",
    note: "POST hourly with x-cron-secret; ?dryRun=1 to check without alerting",
  });
}

export async function POST(req: Request) {
  if (!requireJobSecret(req, ["CRON_SECRET"], ["x-cron-secret"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const report = await checkFeeIntegrity({ dryRun });

  // A blank receipt is a live money problem, and so is a dues cache that has
  // fallen behind the receipts — both mean a family reads as owing money the
  // school already has. The tick FAILS while either is true. A scheduler that
  // only ever sees 200 teaches everyone to ignore it.
  const status =
    report.blankReceipts.length > 0 || report.staleDues ? 500 : 200;
  return NextResponse.json({ ok: status === 200, ...report }, { status });
}
