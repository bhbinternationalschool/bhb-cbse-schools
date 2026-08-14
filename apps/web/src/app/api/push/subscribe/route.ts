import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { upsertPushSubscription } from "@/lib/webPush.server";

export const runtime = "nodejs";

type SubscribeBody = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
};

/** POST — save a browser's push subscription against the signed-in parent's household. */
export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }
  if (session.persona !== "parent" || !session.householdId) {
    return NextResponse.json(
      { ok: false, error: "Only parent sessions can subscribe" },
      { status: 403 },
    );
  }

  let body: SubscribeBody;
  try {
    body = (await req.json()) as SubscribeBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return NextResponse.json(
      { ok: false, error: "Malformed subscription" },
      { status: 400 },
    );
  }

  const result = await upsertPushSubscription({
    subjectType: "parent",
    subjectId: session.householdId,
    endpoint: body.endpoint,
    p256dh: body.keys.p256dh,
    auth: body.keys.auth,
    userAgent: req.headers.get("user-agent") || "",
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Save failed" },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true });
}
