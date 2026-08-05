import { NextResponse } from "next/server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import type { WaBotPersistBundle } from "@/lib/waBotStore.server";
import { waThreadsDualWriteDbEnabled } from "@/lib/waThreadsDbConfig";
import {
  fetchWaThreadsDeskFromDb,
  pushWaThreadsDeskToDb,
} from "@/lib/waThreadsNormalized.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["wa-threads-desk"], "GET");
  if (!auth.ok) return auth.response
  const { bundle, meta } = await fetchWaThreadsDeskFromDb();
  return NextResponse.json({
    ok: true,
    ...bundle,
    sliceCount: meta?.sliceCount ?? 0,
    threadCount: meta?.threadCount ?? 0,
    updatedAt: meta?.updatedAt || bundle.updatedAt,
    meta,
  });
}

export async function POST(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["wa-threads-desk"], "POST");
  if (!auth.ok) return auth.response
  if (!waThreadsDualWriteDbEnabled()) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  let body: WaBotPersistBundle;
  try {
    body = (await req.json()) as WaBotPersistBundle;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await pushWaThreadsDeskToDb({
    version: 1,
    updatedAt: body.updatedAt || new Date().toISOString(),
    crm: body.crm ?? null,
    sis: body.sis ?? null,
    survey: body.survey ?? null,
    classChannel: body.classChannel ?? null,
    unified: body.unified ?? null,
    hub: body.hub ?? null,
    staffAtt: body.staffAtt ?? null,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    updatedAt: new Date().toISOString(),
  });
}
