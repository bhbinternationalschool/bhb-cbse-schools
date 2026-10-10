/**
 * POST /api/wa/parent-chat-close — close quiet parent chats with thanks + the
 * guide (lib/parentChatClose.server.ts). Cloud Scheduler every 15 minutes in
 * school hours with x-cron-secret; staff with notifications edit may run it.
 * ?dryRun=1 lists who would be closed without sending.
 */

import { NextResponse } from "next/server";
import { requireJobSecret, requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { runParentChatCloseSweep } from "@/lib/parentChatClose.server";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!requireJobSecret(req, ["CRON_SECRET"], ["x-cron-secret"])) {
    const auth = await requireStaffPermission(req, "notifications", "edit");
    if (!auth.ok) return auth.response;
  }
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const r = await runParentChatCloseSweep({ dryRun });
  return NextResponse.json({ ok: true, dryRun, ...r });
}
