import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import type { DeskModuleId } from "@/lib/deskCutover";
import { deskSliceDef, deskSliceEnvDualWrite } from "@/lib/deskSliceRegistry";
import {
  fetchDeskSliceFromDb,
  pushDeskSliceToDb,
} from "@/lib/deskSliceNormalized.server";

export const runtime = "nodejs";

async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.MIRROR_SYNC_SECRET?.trim();
  const header = req.headers.get("x-mirror-secret")?.trim();
  if (secret && header && header === secret) return true;
  const session = await getDemoSession();
  return !!session;
}

type RouteCtx = { params: Promise<{ module: string }> };

function parseModuleId(raw: string): DeskModuleId | null {
  const def = deskSliceDef(raw as DeskModuleId);
  return def ? (raw as DeskModuleId) : null;
}

export async function GET(req: Request, ctx: RouteCtx) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { module } = await ctx.params;
  const id = parseModuleId(module);
  if (!id) {
    return NextResponse.json({ error: "Unknown module" }, { status: 404 });
  }
  const { bundle, meta } = await fetchDeskSliceFromDb(id);
  return NextResponse.json({
    ok: true,
    ...bundle,
    rowCount: meta?.rowCount ?? 0,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

export async function POST(req: Request, ctx: RouteCtx) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { module } = await ctx.params;
  const id = parseModuleId(module);
  if (!id) {
    return NextResponse.json({ error: "Unknown module" }, { status: 404 });
  }
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

  const { meta } = await fetchDeskSliceFromDb(id);
  return NextResponse.json({
    ok: true,
    rowCount: meta?.rowCount ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
