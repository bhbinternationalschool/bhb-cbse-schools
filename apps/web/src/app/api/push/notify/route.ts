import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { sendPushToSubject } from "@/lib/webPush.server";

export const runtime = "nodejs";

type NotifyBody = {
  householdId?: string;
  title?: string;
  body?: string;
  url?: string;
};

/**
 * POST — staff-triggered push notification to a parent's subscribed devices.
 * Round 14's one real trigger: fee receipt delivery, called from
 * deliverWhatsAppFeeReceipt() (lib/fees.ts) right after the WhatsApp send.
 * Best-effort by design — the caller never blocks the WA flow on this.
 */
export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "fees", "edit");
  if (!auth.ok) return auth.response;

  let body: NotifyBody;
  try {
    body = (await req.json()) as NotifyBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.householdId || !body.title || !body.body) {
    return NextResponse.json({ error: "householdId, title, body required" }, { status: 400 });
  }

  const result = await sendPushToSubject("parent", body.householdId, {
    title: body.title,
    body: body.body,
    url: body.url,
  });
  return NextResponse.json({ ok: true, ...result });
}
