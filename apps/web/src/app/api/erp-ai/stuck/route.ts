/**
 * POST { pathname, tab, message } — the module guide saw the same error on a
 * screen again (lib/moduleRequests recordStuckSignal). Counted per screen and
 * message for the director's inbox, so confusing screens surface without
 * anyone having to complain. Best effort; never blocks the user.
 */

import { NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/apiRouteAuth.server";
import { recordStuckSignal } from "@/lib/moduleRequests";
import { updateModuleRequests } from "@/lib/moduleRequests.server";
import { moduleForHref } from "@/lib/rbac";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const pathname = String(body.pathname ?? "").slice(0, 200) || "/home";
  const tab = String(body.tab ?? "").slice(0, 60);
  const message = String(body.message ?? "").trim().slice(0, 300);
  if (!message) return NextResponse.json({ ok: false, error: "message required" }, { status: 400 });
  const rbacModule = moduleForHref(tab ? `${pathname}?tab=${tab}` : pathname) || "";
  const user = auth.ctx.session.fullName || auth.ctx.session.staffId || "staff";
  const r = await updateModuleRequests((st) =>
    recordStuckSignal(st, { module: rbacModule, pathname, message, user, now: new Date().toISOString() }),
  );
  return NextResponse.json({ ok: r.ok });
}
