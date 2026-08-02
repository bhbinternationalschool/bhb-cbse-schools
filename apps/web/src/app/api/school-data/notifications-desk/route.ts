import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import type { NotificationsState } from "@/lib/notifications";
import { notificationsDualWriteDbEnabled } from "@/lib/notificationsDbConfig";
import {
  fetchNotificationsDeskFromDb,
  pushNotificationsDeskToDb,
} from "@/lib/notificationsNormalized.server";

export const runtime = "nodejs";

async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.MIRROR_SYNC_SECRET?.trim();
  const header = req.headers.get("x-mirror-secret")?.trim();
  if (secret && header && header === secret) return true;
  const session = await getDemoSession();
  return !!session;
}

export async function GET(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { bundle, meta } = await fetchNotificationsDeskFromDb();
  return NextResponse.json({
    ok: true,
    items: bundle.items,
    itemCount: bundle.items.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

type NotificationsDeskPostBody = Pick<NotificationsState, "items">;

export async function POST(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!notificationsDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "NOTIFICATIONS_DUAL_WRITE_DB disabled",
    });
  }

  let body: NotificationsDeskPostBody;
  try {
    body = (await req.json()) as NotificationsDeskPostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await pushNotificationsDeskToDb({
    version: 1,
    items: Array.isArray(body.items) ? body.items : [],
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    itemCount: body.items?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
