/**
 * GET /api/data/views/notifications — the caller's own notifications, unread
 * count and settings (the ERP bell). Handler and rules: lib/notify/inbox.ts.
 * The bell reads it with useErpQuery on desk "erp_notifications", so a new
 * notification appears within one versions poll (~20 s).
 *
 * A static segment beside /api/data/[collection]: Next.js prefers it.
 */
import { inboxGet } from "@/lib/notify/inbox";
import { inboxDeps } from "@/lib/notify/inboxDeps.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return inboxGet(req, inboxDeps);
}
