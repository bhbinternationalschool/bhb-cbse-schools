import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import type { PurchaseState } from "@/lib/purchase";
import { purchaseDualWriteDbEnabled } from "@/lib/purchaseDbConfig";
import {
  fetchPurchaseDeskFromDb,
  pushPurchaseDeskToDb,
} from "@/lib/purchaseNormalized.server";

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
  const { bundle, meta } = await fetchPurchaseDeskFromDb();
  return NextResponse.json({
    ok: true,
    ...bundle,
    indentCount: bundle.indents.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

export async function POST(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!purchaseDualWriteDbEnabled()) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  let body: Pick<PurchaseState, "indents" | "orders" | "grns" | "returns" | "settings">;
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await pushPurchaseDeskToDb({
    version: 1,
    indents: body.indents ?? [],
    orders: body.orders ?? [],
    grns: body.grns ?? [],
    returns: body.returns ?? [],
    settings: body.settings ?? {
      adminLimitPaise: 500_000,
      principalLimitPaise: 5_000_000,
    },
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    indentCount: body.indents?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
