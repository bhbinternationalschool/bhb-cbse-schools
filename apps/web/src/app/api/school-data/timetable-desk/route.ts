import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import type { TimetableState } from "@/lib/timetable";
import { timetableDualWriteDbEnabled } from "@/lib/timetableDbConfig";
import {
  fetchTimetableDeskFromDb,
  pushTimetableDeskToDb,
} from "@/lib/timetableNormalized.server";

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
  const { bundle, meta } = await fetchTimetableDeskFromDb();
  return NextResponse.json({
    ok: true,
    ...bundle,
    gridCount: bundle.grids.length,
    substitutionCount: bundle.substitutions.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

export async function POST(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!timetableDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "TIMETABLE_DUAL_WRITE_DB disabled",
    });
  }

  let body: TimetableState;
  try {
    body = (await req.json()) as TimetableState;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await pushTimetableDeskToDb({
    version: 1,
    workingWeekdays: body.workingWeekdays ?? [],
    bellTemplate: body.bellTemplate ?? [],
    grids: body.grids ?? [],
    publishedGrids: body.publishedGrids ?? [],
    substitutions: body.substitutions ?? [],
    meta: body.meta ?? {
      status: "draft",
      publishedAt: "",
      publishedBy: "",
      generatedAt: "",
      solverStats: null,
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
    gridCount: body.grids?.length ?? 0,
    substitutionCount: body.substitutions?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
