import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import type { StoreState } from "@/lib/store";
import { storeDualWriteDbEnabled } from "@/lib/storeDbConfig";
import {
  fetchStoreDeskFromDb,
  pushStoreDeskToDb,
} from "@/lib/storeNormalized.server";

export const runtime = "nodejs";

async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.MIRROR_SYNC_SECRET?.trim();
  const header = req.headers.get("x-mirror-secret")?.trim();
  if (secret && header && header === secret) return true;
  return !!(await getDemoSession());
}

export async function GET(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { bundle, meta } = await fetchStoreDeskFromDb();
  return NextResponse.json({
    ok: true,
    ...bundle,
    itemCount: bundle.items.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

export async function POST(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!storeDualWriteDbEnabled()) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  let body: Omit<StoreState, "version">;
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await pushStoreDeskToDb({
    version: 1,
    categories: body.categories ?? [],
    saleGroups: body.saleGroups ?? [],
    uoms: body.uoms ?? [],
    infraLevels: body.infraLevels ?? [],
    sources: body.sources ?? [],
    items: body.items ?? [],
    issues: body.issues ?? [],
    movements: body.movements ?? [],
    inventoryAllocations: body.inventoryAllocations ?? [],
    assetAllocations: body.assetAllocations ?? [],
    sellReturns: body.sellReturns ?? [],
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    itemCount: body.items?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
