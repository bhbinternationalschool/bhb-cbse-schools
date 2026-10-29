import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/apiRouteAuth.server";
import { isReminderRule, type ReminderRule } from "@/lib/staffReminders";
import { runStaffReminderTick } from "@/lib/staffReminders.server";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Staff work reminders (lib/staffReminders.ts). Cloud Scheduler
 * `bhb-staff-reminders-tick`, every 15 minutes 07:00–19:59 IST Mon–Sat, on
 * the school-erp-lite service: each tick sends the rules whose configured
 * time (Staff → reminder settings; 08:15 punch, 09:30 register, 15:00
 * homework, 16:00 marks, 17:30 approvals) has come and whose window has not
 * passed. Each person gets each reminder once a day (the notification's
 * dedupe key), so a second tick sends nothing. Everything it sends is
 * awaited before the reply — no after(), nothing left running.
 *
 * `?rule=punch` runs one rule now whatever the clock says (a person
 * re-running it by hand; still once a day). `?dryRun=1` counts without
 * sending. 207 when a rule could not be read or a send failed, so the job
 * history shows it.
 */
export async function GET() {
  return NextResponse.json({ service: "staff-reminders-tick", note: "POST with x-cron-secret; ?rule=<punch|register|homework|marks|approvals>; ?dryRun=1" });
}

export async function POST(req: Request) {
  if (!requireJobSecret(req, ["CRON_SECRET"], ["x-cron-secret"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const rule = url.searchParams.get("rule");
  let rules: ReminderRule[] | undefined;
  if (rule) {
    if (!isReminderRule(rule)) return NextResponse.json({ error: `unknown rule ${rule}` }, { status: 400 });
    rules = [rule];
  }
  const r = await runStaffReminderTick({ rules, dryRun });
  return NextResponse.json(r, { status: r.ok ? 200 : 207 });
}
