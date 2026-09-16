/**
 * POST /api/wa/exam-eve — tomorrow's exam papers to every family with a
 * child sitting one (lib/examEve.server.ts).
 *
 * Cloud Scheduler at 18:00 IST every day with x-cron-secret. It sends
 * nothing on an evening before a day with no paper, so the job needs no
 * exam calendar of its own — the date sheet is the calendar.
 *
 * Staff with notifications edit may run it by hand.
 *   ?dryRun=1              build every message, send none (read tonight's first)
 *   ?examDate=YYYY-MM-DD   a specific exam day (a missed evening)
 */

import { NextResponse } from "next/server";
import { requireJobSecret, requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { runExamEveSweep } from "@/lib/examEve.server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!requireJobSecret(req, ["CRON_SECRET"], ["x-cron-secret"])) {
    const auth = await requireStaffPermission(req, "notifications", "edit");
    if (!auth.ok) return auth.response;
  }
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const examDate = url.searchParams.get("examDate")?.trim() || undefined;
  if (examDate && !/^\d{4}-\d{2}-\d{2}$/.test(examDate)) {
    return NextResponse.json({ ok: false, error: "examDate must be YYYY-MM-DD" }, { status: 400 });
  }
  const r = await runExamEveSweep({ dryRun, examDate });
  return NextResponse.json({ ok: true, dryRun, ...r });
}
