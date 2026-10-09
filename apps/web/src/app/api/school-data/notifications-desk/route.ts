import { NextResponse } from "next/server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import type { NotificationsState } from "@/lib/notifications";
import { notificationsDualWriteDbEnabled } from "@/lib/notificationsDbConfig";
import {
  fetchNotificationsDeskFromDb,
  pushNotificationsDeskToDb,
  NOTIFICATIONS_DELETABLE_TABLES,
} from "@/lib/notificationsNormalized.server";
import { readNamedDeletes } from "@/lib/deskNamedDeletes.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["notifications-desk"], "GET");
  if (!auth.ok) return auth.response
  const { bundle, meta, ok } = await fetchNotificationsDeskFromDb();
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "Failed to fetch notifications desk" },
      { status: 503 },
    );
  }
  return NextResponse.json({
    ok: true,
    items: bundle.items,
    itemCount: bundle.items.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

type NotificationsDeskPostBody = Pick<NotificationsState, "items"> & { deletes?: unknown };

export async function POST(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["notifications-desk"], "POST");
  if (!auth.ok) return auth.response
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
  }, readNamedDeletes(body.deletes, NOTIFICATIONS_DELETABLE_TABLES));
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
