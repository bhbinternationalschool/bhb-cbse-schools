import { NextResponse } from "next/server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import type { PurchaseState } from "@/lib/purchase";
import { purchaseDualWriteDbEnabled } from "@/lib/purchaseDbConfig";
import {
  fetchPurchaseDeskFromDb,
  pushPurchaseDeskToDb,
} from "@/lib/purchaseNormalized.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["purchase-desk"], "GET");
  if (!auth.ok) return auth.response
  const { bundle, meta, ok } = await fetchPurchaseDeskFromDb();
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "Purchase desk fetch failed — tenant/db unavailable" },
      { status: 503 },
    );
  }
  return NextResponse.json({
    ok: true,
    ...bundle,
    indentCount: bundle.indents.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

export async function POST(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["purchase-desk"], "POST");
  if (!auth.ok) return auth.response
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
