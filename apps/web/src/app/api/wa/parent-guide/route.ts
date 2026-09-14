/**
 * POST /api/wa/parent-guide { confirm?: boolean } — send the WhatsApp
 * assistant guide (Hindi + English) to every enrolled family inside Meta's
 * 24-hour window. Without confirm it only lists who would get it.
 */

import { NextResponse } from "next/server";
import { requireJobSecret, requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { sendParentGuideToOpenWindow } from "@/lib/parentChatClose.server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!requireJobSecret(req, ["CRON_SECRET"], ["x-cron-secret"])) {
    const auth = await requireStaffPermission(req, "notifications", "edit");
    if (!auth.ok) return auth.response;
  }
  let confirm = false;
  try {
    confirm = !!((await req.json()) as { confirm?: boolean }).confirm;
  } catch {
    confirm = false;
  }
  try {
    const r = await sendParentGuideToOpenWindow({ confirm });
    return NextResponse.json({ ok: true, confirm, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
