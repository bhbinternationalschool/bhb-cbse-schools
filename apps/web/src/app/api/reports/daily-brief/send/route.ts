/**
 * POST /api/reports/daily-brief/send — the 6 PM push.
 *
 * Called by Cloud Scheduler at 18:00 IST on school days, guarded by the
 * same job secret as the automation tick. Also callable by a director with
 * `notifications` edit, so the office can send today's brief on demand
 * without waiting for six o'clock.
 *
 * A dedicated job rather than an automation rule: the automation tick runs
 * every thirty minutes and its rules send TEMPLATES TO AUDIENCES, while
 * this sends one document to a handful of named people at an exact time.
 * Bending the audience engine around that would have made both harder to
 * read.
 *
 * GET reports what it would do — recipients and whether the template is
 * approved — so the setup can be checked without messaging anybody.
 */

import { NextResponse } from "next/server";
import {
  requireJobSecret,
  requireStaffPermission,
} from "@/lib/apiRouteAuth.server";
import { briefRecipients, sendDailyBrief } from "@/lib/dailyBriefSend.server";
import { istToday } from "@/lib/dailyBrief.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "notifications", "view");
  if (!auth.ok) return auth.response;
  const recipients = await briefRecipients();
  return NextResponse.json({
    ok: true,
    date: istToday(),
    note: "POST to send. Recipients are active staff whose designation reads as leadership (principal, director, trustee, head master, chairman, secretary, manager) and who have a mobile on file.",
    recipients: recipients.map((r) => ({
      name: r.name,
      designation: r.designation,
      // Masked: this endpoint answers "is the list right", not "what are
      // their numbers".
      mobile: `••••${r.mobile.slice(-4)}`,
    })),
  });
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const dateIso = url.searchParams.get("date") || undefined;

  // Cloud Scheduler first; a staff caller needs the same grant that sends
  // any other school-wide message.
  const byJob = requireJobSecret(req, ["CRON_SECRET", "WA_DISPATCH_SECRET"], [
    "x-cron-secret",
    "x-wa-dispatch-secret",
  ]);
  if (!byJob) {
    const auth = await requireStaffPermission(req, "notifications", "edit");
    if (!auth.ok) return auth.response;
  }

  const result = await sendDailyBrief({ dateIso, dryRun });
  // 200 with the detail either way: this is read by a scheduler log and by
  // a person, and both need to see WHY nothing went out.
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
