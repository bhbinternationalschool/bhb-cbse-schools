/**
 * The apps' notifications (and the ERP bell's writes):
 *   GET  /api/v1/notifications  — the caller's own list, unread count, settings
 *   POST /api/v1/notifications  — {op:"read", ids} | {op:"read_all"} | {op:"prefs", prefs, base}
 * Handler and rules: lib/notify/inbox.ts.
 */
import { inboxGet, inboxPost } from "@/lib/notify/inbox";
import { inboxDeps } from "@/lib/notify/inboxDeps.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return inboxGet(req, inboxDeps);
}

export async function POST(req: Request) {
  return inboxPost(req, inboxDeps);
}
