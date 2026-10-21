import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/apiRouteAuth.server";
import { loadServerMasters, loadServerRbac } from "@/lib/api/v1/auth";
import { currentAcademicYearCode } from "@/lib/masters";
import { behaviourSummary, chatModeratorStaffIds } from "@/lib/schoolChat.server";
import { sendPushToSubjects } from "@/lib/webPush.server";

export const runtime = "nodejs";

/**
 * POST /api/v1/school-chat/weekly-summary (x-cron-secret) — the principal's
 * weekly chat behaviour summary, pushed to every chat moderator (staff who
 * approve Discipline / behaviour). Point Cloud Scheduler at it Monday 08:00
 * IST (setup-cloud-scheduler.sh: bhb-school-chat-weekly). The full list is
 * on School chat → Behaviour.
 */
export async function POST(req: Request) {
  if (!requireJobSecret(req, ["CRON_SECRET"], ["x-cron-secret"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const [masters, rbac] = await Promise.all([loadServerMasters(), loadServerRbac()]);
    const s = await behaviourSummary(7);
    const repeat = s.people.filter((p) => p.repeat).length;
    const body =
      `Last 7 days: ${s.totals.sent} messages checked, ${s.totals.held} held, ${s.totals.removed} removed, ${s.totals.warned} warnings` +
      (repeat ? `, ${repeat} repeat offender${repeat === 1 ? "" : "s"}` : "") +
      ".";
    const mods = chatModeratorStaffIds(masters, rbac, currentAcademicYearCode(masters));
    const sent = await sendPushToSubjects("staff", mods, {
      title: "School chat — weekly summary",
      body,
      url: "/school-chat?tab=behaviour",
      data: { kind: "school_chat_summary" },
    });
    return NextResponse.json({ ok: true, body, moderators: mods.length, sent });
  } catch (e) {
    console.error("[school-chat] weekly summary failed", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
}
