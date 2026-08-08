import { NextResponse } from "next/server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import type { TrustState } from "@/lib/trust";
import { trustDualWriteDbEnabled } from "@/lib/trustDbConfig";
import {
  fetchTrustDeskFromDb,
  pushTrustDeskToDb,
} from "@/lib/trustNormalized.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["trust-desk"], "GET");
  if (!auth.ok) return auth.response
  const { bundle, meta, ok } = await fetchTrustDeskFromDb();
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "Trust desk fetch failed — tenant/db unavailable" },
      { status: 503 },
    );
  }
  return NextResponse.json({
    ok: true,
    ...bundle,
    projectCount: bundle.projects.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

export async function POST(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["trust-desk"], "POST");
  if (!auth.ok) return auth.response
  if (!trustDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "TRUST_DUAL_WRITE_DB disabled",
    });
  }

  let body: TrustState;
  try {
    body = (await req.json()) as TrustState;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await pushTrustDeskToDb({
    version: 1,
    projects: body.projects ?? [],
    workItems: body.workItems ?? [],
    materials: body.materials ?? [],
    labourEntries: body.labourEntries ?? [],
    allotments: body.allotments ?? [],
    contractors: body.contractors ?? [],
    workOrders: body.workOrders ?? [],
    raBills: body.raBills ?? [],
    costLines: body.costLines ?? [],
    rateCard: body.rateCard ?? [],
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    projectCount: body.projects?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
