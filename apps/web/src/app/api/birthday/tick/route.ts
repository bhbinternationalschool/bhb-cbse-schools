import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/apiRouteAuth.server";
import { istNow, readBirthdayState, runBirthdayGreetings, runStaffBirthdayGreetings } from "@/lib/birthday.server";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Daily birthday tick (Cloud Scheduler, x-cron-secret). Sends today's
 * greetings once the IST clock has reached the configured send hour, only
 * when auto-send is on; the send log makes re-runs idempotent (quiet-hours
 * deferrals are retried by the next tick). `?dryRun=1` previews.
 *
 * Staff greetings ride the same tick and the same hour, and go out only when
 * the school has turned them on as well — auto-send is the master switch, and
 * `force` overrides the clock but never that opt-in: nobody's colleagues get
 * messaged because someone re-ran a job by hand.
 */
export async function GET() {
  return NextResponse.json({ service: "birthday-tick", note: "POST with x-cron-secret; ?dryRun=1 to preview" });
}

export async function POST(req: Request) {
  if (!requireJobSecret(req, ["CRON_SECRET", "WA_DISPATCH_SECRET"], ["x-cron-secret", "x-wa-dispatch-secret"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const force = url.searchParams.get("force") === "1";
  const { date, hour } = istNow();
  const st = await readBirthdayState();
  if (!st.settings.autoSend && !dryRun && !force) {
    return NextResponse.json({ ok: true, skipped: "auto-send is off", date, hour });
  }
  if (hour < st.settings.sendHour && !force && !dryRun) {
    return NextResponse.json({ ok: true, skipped: `before send hour ${st.settings.sendHour}:00 IST`, date, hour });
  }
  const r = await runBirthdayGreetings({ date, dryRun, includeSocial: true });
  const staff = st.settings.staffEnabled || dryRun ? await runStaffBirthdayGreetings({ date, dryRun }) : null;
  return NextResponse.json({ ok: true, ...r, staff, hour });
}
