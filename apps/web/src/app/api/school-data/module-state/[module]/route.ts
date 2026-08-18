/**
 * Generic per-module state (module_local_state) — GET pulls, POST upserts,
 * one row per (tenant, module). RBAC per module from lib/moduleStateRegistry.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { isModuleStateKey, MODULE_STATE_DEFS } from "@/lib/moduleStateRegistry";
import { getServerTenantContext } from "@/lib/serverTenant";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ module: string }> };

export async function GET(req: Request, ctx: RouteCtx) {
  const { module } = await ctx.params;
  if (!isModuleStateKey(module)) {
    return NextResponse.json({ error: "Unknown module" }, { status: 404 });
  }
  const auth = await requireStaffPermission(req, MODULE_STATE_DEFS[module].rbac, "view");
  if (!auth.ok) return auth.response;

  const tctx = await getServerTenantContext();
  if (!tctx) return NextResponse.json({ ok: false, error: "Tenant unavailable" }, { status: 503 });
  const { data, error } = await tctx.sb
    .from("module_local_state")
    .select("state, updated_at")
    .eq("tenant_id", tctx.tenantId)
    .eq("module_key", module)
    .maybeSingle();
  if (error) {
    // Unknown is not empty.
    return NextResponse.json({ ok: false, error: error.message }, { status: 503 });
  }
  return NextResponse.json({
    ok: true,
    state: data?.state ?? null,
    updatedAt: data?.updated_at ? String(data.updated_at) : "",
  });
}

export async function POST(req: Request, ctx: RouteCtx) {
  const { module } = await ctx.params;
  if (!isModuleStateKey(module)) {
    return NextResponse.json({ error: "Unknown module" }, { status: 404 });
  }
  const auth = await requireStaffPermission(req, MODULE_STATE_DEFS[module].rbac, "edit");
  if (!auth.ok) return auth.response;

  let body: { state?: unknown };
  try {
    body = (await req.json()) as { state?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (body.state === undefined || body.state === null || typeof body.state !== "object") {
    return NextResponse.json({ error: "Missing state" }, { status: 400 });
  }
  const tctx = await getServerTenantContext();
  if (!tctx) return NextResponse.json({ ok: false, error: "Tenant unavailable" }, { status: 503 });
  const now = new Date().toISOString();
  const { error } = await tctx.sb.from("module_local_state").upsert(
    { tenant_id: tctx.tenantId, module_key: module, state: body.state, updated_at: now },
    { onConflict: "tenant_id,module_key" },
  );
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
  }
  return NextResponse.json({ ok: true, updatedAt: now });
}
