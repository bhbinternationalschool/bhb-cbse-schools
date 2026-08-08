import { NextResponse } from "next/server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import type { TimetableState } from "@/lib/timetable";
import { timetableDualWriteDbEnabled } from "@/lib/timetableDbConfig";
import {
  fetchTimetableDeskFromDb,
  pushTimetableDeskToDb,
} from "@/lib/timetableNormalized.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["timetable-desk"], "GET");
  if (!auth.ok) return auth.response
  const { bundle, meta, ok } = await fetchTimetableDeskFromDb();
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "Timetable desk fetch failed — tenant/db unavailable" },
      { status: 503 },
    );
  }
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
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["timetable-desk"], "POST");
  if (!auth.ok) return auth.response
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
