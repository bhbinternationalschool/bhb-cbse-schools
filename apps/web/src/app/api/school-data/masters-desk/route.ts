import { NextResponse } from "next/server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import type { MastersState } from "@/lib/masters";
import { mastersDualWriteDbEnabled } from "@/lib/mastersDbConfig";
import {
  fetchMastersDeskFromDb,
  pushMastersDeskToDb,
} from "@/lib/mastersNormalized.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["masters-desk"], "GET");
  if (!auth.ok) return auth.response
  const { bundle, meta } = await fetchMastersDeskFromDb();
  return NextResponse.json({
    ok: true,
    ...bundle,
    classCount: bundle.classes.length,
    feeHeadCount: bundle.feeHeads.length,
    subjectCount: bundle.subjects.length,
    sliceCount: meta?.sliceCount ?? 0,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

export async function POST(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["masters-desk"], "POST");
  if (!auth.ok) return auth.response
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
  const state = { version: 2 as const, ...rest };
  const result = await pushMastersDeskToDb(state);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  const { pushMastersRemoteServer } = await import("@/lib/mastersPersistence");
  void pushMastersRemoteServer(state);

  return NextResponse.json({
    ok: true,
    classCount: body.classes?.length ?? 0,
    feeHeadCount: body.feeHeads?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
