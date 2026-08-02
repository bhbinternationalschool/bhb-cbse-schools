import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import type { CollectionVoucher, FeesState } from "@/lib/fees";
import type { FeeDeskAncillary } from "@/lib/feesDeskAncillary.server";
import {
  fetchFeeDeskFromDb,
  feesDualWriteDbEnabled,
  pushFeeDeskToDb,
} from "@/lib/feesNormalized.server";

export const runtime = "nodejs";

async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.MIRROR_SYNC_SECRET?.trim();
  const header = req.headers.get("x-mirror-secret")?.trim();
  if (secret && header && header === secret) return true;
  const session = await getDemoSession();
  return !!session;
}

/** GET — pull full fee desk from normalized tables */
export async function GET(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const desk = await fetchFeeDeskFromDb();
  return NextResponse.json({
    ok: true,
    vouchers: desk.vouchers,
    ancillary: desk.ancillary,
    count: desk.vouchers.length,
    updatedAt: desk.meta?.updatedAt || new Date().toISOString(),
    meta: desk.meta,
  });
}

type DeskPostBody = Pick<FeesState, "vouchers"> &
  Partial<FeeDeskAncillary> & {
    rebuildOpenDues?: boolean;
    academicYearCode?: string;
  };

/** POST — push fee desk snapshot (vouchers + ancillary) + rebuild open dues */
export async function POST(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!feesDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "FEES_DUAL_WRITE_DB disabled",
    });
  }

  let body: DeskPostBody;
  try {
    body = (await req.json()) as DeskPostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const state: Pick<FeesState, "vouchers"> & FeeDeskAncillary = {
    vouchers: Array.isArray(body.vouchers) ? body.vouchers : [],
    cheques: body.cheques ?? [],
    manualBooks: body.manualBooks ?? [],
    dayCloses: body.dayCloses ?? [],
    installmentPlans: body.installmentPlans ?? [],
    planAllocations: body.planAllocations ?? [],
    carriedForwardDues: body.carriedForwardDues ?? [],
    chargeVouchers: body.chargeVouchers ?? [],
  };

  const result = await pushFeeDeskToDb(state, {
    academicYearCode: body.academicYearCode,
    rebuildOpenDues: body.rebuildOpenDues,
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    count: result.voucherCount,
    openDuesCount: result.openDuesCount,
    updatedAt: new Date().toISOString(),
  });
}
