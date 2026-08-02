import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import type { TrustState } from "@/lib/trust";
import { trustDualWriteDbEnabled } from "@/lib/trustDbConfig";
import {
  fetchTrustDeskFromDb,
  pushTrustDeskToDb,
} from "@/lib/trustNormalized.server";

export const runtime = "nodejs";

async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.MIRROR_SYNC_SECRET?.trim();
  const header = req.headers.get("x-mirror-secret")?.trim();
  if (secret && header && header === secret) return true;
  const session = await getDemoSession();
  return !!session;
}

export async function GET(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { bundle, meta } = await fetchTrustDeskFromDb();
  return NextResponse.json({
    ok: true,
    ...bundle,
    projectCount: bundle.projects.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

export async function POST(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
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
