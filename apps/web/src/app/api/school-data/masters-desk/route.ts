import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import type { MastersState } from "@/lib/masters";
import { mastersDualWriteDbEnabled } from "@/lib/mastersDbConfig";
import {
  fetchMastersDeskFromDb,
  pushMastersDeskToDb,
} from "@/lib/mastersNormalized.server";

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
  const { bundle, meta } = await fetchMastersDeskFromDb();
  return NextResponse.json({
    ok: true,
    ...bundle,
    classCount: bundle.classes.length,
    feeHeadCount: bundle.feeHeads.length,
    subjectCount: bundle.subjects.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

export async function POST(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!mastersDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "MASTERS_DUAL_WRITE_DB disabled",
    });
  }

  let body: MastersState;
  try {
    body = (await req.json()) as MastersState;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { version: _v, ...rest } = body;
  const result = await pushMastersDeskToDb({ version: 2, ...rest });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    classCount: body.classes?.length ?? 0,
    feeHeadCount: body.feeHeads?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
