/**
 * GET /api/wa/relay/routes — the office phones and the categories each takes.
 * PUT /api/wa/relay/routes — replace that list.
 *
 * Reading is `notifications:view`; changing who receives parents' messages is
 * `notifications:edit`, the same right that sends a school-wide message.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { loadRelayRoutes, saveRelayRoutes } from "@/lib/waRelay.server";
import { RELAY_CATEGORIES } from "@/lib/waRelay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "notifications", "view");
  if (!auth.ok) return auth.response;
  const r = await loadRelayRoutes();
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 500 });
  return NextResponse.json({ ok: true, routes: r.routes, categories: RELAY_CATEGORIES });
}

export async function PUT(req: Request) {
  const auth = await requireStaffPermission(req, "notifications", "edit");
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => null)) as { routes?: unknown } | null;
  if (!body || !Array.isArray(body.routes)) {
    return NextResponse.json({ ok: false, error: "Send { routes: [...] }" }, { status: 400 });
  }
  const by = auth.ctx.session.fullName || auth.ctx.session.email || "";
  const r = await saveRelayRoutes(body.routes, by);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 500 });
  return NextResponse.json({ ok: true, routes: r.routes });
}
