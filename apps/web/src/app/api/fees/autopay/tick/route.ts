import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/apiRouteAuth.server";
import { runAutopayTick } from "@/lib/feeAutopay.server";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Daily fee auto-pay tick (Cloud Scheduler, 10:15 IST, x-cron-secret).
 *
 * Finishes what is in flight first — debits whose outcome or receipts are
 * outstanding, in case a webhook never came — then, from the school's charge
 * day on, raises this month's debit for every active mandate. Raising before
 * 9 PM for the next day is inside every rail's cut-off, and the day's gap is
 * the pre-debit notice.
 *
 * With the setting off it only reports what it would debit. `?dryRun=1` does
 * the same with the setting on.
 */
export async function GET() {
  return NextResponse.json({
    service: "fee-autopay-tick",
    note: "POST daily with x-cron-secret; ?dryRun=1 reports without debiting",
  });
}

export async function POST(req: Request) {
  if (!requireJobSecret(req, ["CRON_SECRET"], ["x-cron-secret"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  try {
    const report = await runAutopayTick({ dryRun });
    // Failing loudly when a debit could not be raised or booked: a scheduler
    // that only ever shows green teaches everyone to ignore it.
    const broken =
      report.raised.some((r) => r.outcome === "error") ||
      report.checked.some((c) => !!c.error && c.status === "SUCCESS");
    return NextResponse.json({ ok: !broken, ...report }, { status: broken ? 500 : 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "tick failed" }, { status: 500 });
  }
}
