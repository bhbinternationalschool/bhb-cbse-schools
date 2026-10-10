import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { deletePushSubscriptionByEndpoint } from "@/lib/webPush.server";

export const runtime = "nodejs";

/** POST — remove a browser's push subscription. */
export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  let body: { endpoint?: string };
  try {
    body = (await req.json()) as { endpoint?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.endpoint) {
    return NextResponse.json({ ok: false, error: "endpoint required" }, { status: 400 });
  }

  await deletePushSubscriptionByEndpoint(body.endpoint);
  return NextResponse.json({ ok: true });
}
