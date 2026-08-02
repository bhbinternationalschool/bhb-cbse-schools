import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import type { RteState } from "@/lib/rteEws";
import { rteDualWriteDbEnabled } from "@/lib/rteDbConfig";
import {
  fetchRteDeskFromDb,
  pushRteDeskToDb,
} from "@/lib/rteNormalized.server";

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
  const { bundle, meta } = await fetchRteDeskFromDb();
  return NextResponse.json({
    ok: true,
    seats: bundle.seats,
    applications: bundle.applications,
    settings: bundle.settings,
    seatCount: bundle.seats.length,
    applicationCount: bundle.applications.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

type RteDeskPostBody = Pick<RteState, "seats" | "applications" | "settings">;

export async function POST(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!rteDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "RTE_DUAL_WRITE_DB disabled",
    });
  }

  let body: RteDeskPostBody;
  try {
    body = (await req.json()) as RteDeskPostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await pushRteDeskToDb({
    version: 1,
    seats: Array.isArray(body.seats) ? body.seats : [],
    applications: Array.isArray(body.applications) ? body.applications : [],
    settings: body.settings ?? {
      mandatedPct: 25,
      autoApplyFeeWaiver: true,
      note: "",
    },
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    seatCount: body.seats?.length ?? 0,
    applicationCount: body.applications?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
