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
import { guardMastersOverwrite } from "@/lib/mastersWriteGuard";

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

  // A client must not be able to replace the class-id generation wholesale.
  // This is checked before the write, not after, because pushMastersDeskToDb
  // upserts every slice in one go — by the time it returns, every student,
  // lead and RTE seat referencing a class is already orphaned.
  const { bundle: stored } = await fetchMastersDeskFromDb();
  const verdict = guardMastersOverwrite(
    (stored.classes ?? []).map((c) => c.id),
    (state.classes ?? []).map((c) => c.id),
  );
  if (!verdict.allow) {
    console.warn(
      `[masters-desk] rejected ${verdict.reason} push`,
      `stored=${verdict.storedCount} incoming=${verdict.incomingCount}`,
    );
    return NextResponse.json(
      {
        error: verdict.message,
        reason: verdict.reason,
        storedClassCount: verdict.storedCount,
        incomingClassCount: verdict.incomingCount,
      },
      { status: 409 },
    );
  }

  // Awaited: the previous fire-and-forget meant a failed write still returned
  // ok:true, so a client could believe its masters were saved when they were
  // not.
  const pushed = await pushMastersDeskToDb(state);
  if (!pushed.ok) {
    return NextResponse.json(
      { error: pushed.error || "Masters push failed" },
      { status: 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    classCount: body.classes?.length ?? 0,
    feeHeadCount: body.feeHeads?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
