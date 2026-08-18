import { NextResponse } from "next/server";
import {
  DESK_SLICE_RBAC,
  requireStaffPermission,
} from "@/lib/apiRouteAuth.server";
import type { DeskModuleId } from "@/lib/deskCutover";
import { deskSliceDef, deskSliceEnvDualWrite } from "@/lib/deskSliceRegistry";
import {
  fetchDeskSliceFromDb,
  pushDeskSliceToDb,
} from "@/lib/deskSliceNormalized.server";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ module: string }> };

function parseModuleId(raw: string): DeskModuleId | null {
  const def = deskSliceDef(raw as DeskModuleId);
  return def ? (raw as DeskModuleId) : null;
}

export async function GET(req: Request, ctx: RouteCtx) {
  const { module } = await ctx.params;
  const id = parseModuleId(module);
  if (!id) {
    return NextResponse.json({ error: "Unknown module" }, { status: 404 });
  }
  const rbacModule = DESK_SLICE_RBAC[id] ?? "settings";
  const auth = await requireStaffPermission(req, rbacModule, "view");
  if (!auth.ok) return auth.response;

  const { bundle, meta, ok, error } = await fetchDeskSliceFromDb(id);
  if (!ok) {
    // Unknown, not empty. Returning ok:true with an empty bundle stamped
    // "now" made every client take the empty desk as newer than its cache.
    return NextResponse.json(
      { ok: false, error: error || "Desk read failed" },
      { status: 503 },
    );
  }
  return NextResponse.json({
    ok: true,
    ...bundle,
    rowCount: meta?.rowCount ?? 0,
    // No sync meta yet = never written; report an empty stamp so the client
    // decides on row counts, not on a timestamp we invented.
    updatedAt: meta?.updatedAt || "",
    meta,
  });
}

export async function POST(req: Request, ctx: RouteCtx) {
  const { module } = await ctx.params;
  const id = parseModuleId(module);
  if (!id) {
    return NextResponse.json({ error: "Unknown module" }, { status: 404 });
  }
  const rbacModule = DESK_SLICE_RBAC[id] ?? "settings";
  const auth = await requireStaffPermission(req, rbacModule, "edit");
  if (!auth.ok) return auth.response;

  const def = deskSliceDef(id)!;
  if (!deskSliceEnvDualWrite(def.envPrefix)) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: `${def.envPrefix}_DUAL_WRITE_DB disabled`,
    });
  }

  let body: { version: number } & Record<string, unknown>;
  try {
    body = (await req.json()) as { version: number } & Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await pushDeskSliceToDb(id, body);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }
  if (id === "rbac") {
    const { invalidateServerRbacCache } = await import("@/lib/api/v1/auth");
    invalidateServerRbacCache();
  }

  const { meta } = await fetchDeskSliceFromDb(id);
  return NextResponse.json({
    ok: true,
    rowCount: meta?.rowCount ?? 0,
    // The revision the desk actually recorded, not a fresh client-facing
    // clock reading that would differ from the stored one.
    updatedAt: meta?.updatedAt || new Date().toISOString(),
  });
}
