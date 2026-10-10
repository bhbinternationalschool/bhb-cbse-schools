import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/apiRouteAuth.server";
import { runNucleusReminder } from "@/lib/nucleusReminder.server";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Weekly "read Nucleus" reminder (Cloud Scheduler, x-cron-secret).
 *
 * Sends only when the last reading is over a week old — or when there has
 * never been one. Idempotent per person per day via clientMessageId, so a
 * scheduler retry cannot send a second copy. `?dryRun=1` previews the
 * decision without sending.
 */
export async function GET() {
  return NextResponse.json({
    service: "nucleus-reminder-tick",
    note: "POST with x-cron-secret; ?dryRun=1 to preview",
  });
}

export async function POST(req: Request) {
  if (!requireJobSecret(req, ["CRON_SECRET", "WA_DISPATCH_SECRET"], ["x-cron-secret", "x-wa-dispatch-secret"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const result = await runNucleusReminder({ today, dryRun });
  return NextResponse.json({ ...result, today });
}
