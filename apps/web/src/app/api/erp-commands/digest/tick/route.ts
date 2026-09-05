import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/apiRouteAuth.server";
import { istNow } from "@/lib/birthday.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { runCommandDigest } from "@/lib/erpCommandsDigest.server";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Hour (IST) after which the director's digest goes out. */
function digestHour(): number {
  const n = parseInt(process.env.ERP_COMMANDS_DIGEST_HOUR || "", 10);
  return Number.isFinite(n) && n >= 0 && n <= 23 ? n : 19;
}

/**
 * Daily ERP command-desk digest to the director (Cloud Scheduler,
 * x-cron-secret). Sends once the IST clock passes ERP_COMMANDS_DIGEST_HOUR
 * (default 19:00), only when there were commands that day; idempotent per
 * date, so an hourly tick is safe. `?dryRun=1` previews, `?force=1` re-sends.
 */
export async function GET() {
  return NextResponse.json({
    service: "erp-commands-digest-tick",
    note: "POST with x-cron-secret; ?dryRun=1 to preview, ?force=1 to re-send",
    sendHour: digestHour(),
  });
}

export async function POST(req: Request) {
  if (
    !requireJobSecret(
      req,
      ["CRON_SECRET", "WA_DISPATCH_SECRET"],
      ["x-cron-secret", "x-wa-dispatch-secret"],
    )
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const force = url.searchParams.get("force") === "1";
  const { date, hour } = istNow();
  if (hour < digestHour() && !force && !dryRun) {
    return NextResponse.json({
      ok: true,
      skipped: `before send hour ${digestHour()}:00 IST`,
      date,
      hour,
    });
  }
  await ensureSchoolMirrorHydrated();
  const r = await runCommandDigest({ date, dryRun, force });
  return NextResponse.json({ ok: true, hour, dryRun, ...r });
}
