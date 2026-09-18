import { NextResponse } from "next/server";
import { requireJobSecret, requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { sweepExpiredAnswers } from "@/lib/answerBook.server";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/wa/answer-book/expiry-tick — take down answers whose date has
 * passed (lib/answerBook.server.ts). Nightly, with x-cron-secret.
 *
 * An entry that expires only in the rules but stays on the shelf is still
 * findable and still quotable — which is the failure this exists to stop.
 */
export async function POST(req: Request) {
  if (!requireJobSecret(req, ["CRON_SECRET"], ["x-cron-secret"])) {
    const auth = await requireStaffPermission(req, "wa_chatbot", "edit");
    if (!auth.ok) return auth.response;
  }
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const r = await sweepExpiredAnswers(today);
  return NextResponse.json({ ok: true, today, ...r });
}
