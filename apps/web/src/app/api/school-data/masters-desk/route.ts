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
import { guardMastersRevision } from "@/lib/mastersRevisionGuard";

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

  let body: MastersState & { baseUpdatedAt?: string | null };
  try {
    body = (await req.json()) as MastersState & { baseUpdatedAt?: string | null };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { version: _v, baseUpdatedAt, ...rest } = body;
  const state = { version: 2 as const, ...rest };

  const { bundle: stored, meta } = await fetchMastersDeskFromDb();

  // Optimistic locking: the push must carry the desk revision the client
  // hydrated at. A mismatch means another device saved after this one
  // loaded — refuse instead of last-write-wins, and let the client
  // rehydrate. Missing base = legacy client, allowed but logged so we can
  // see when they drain and tighten enforcement.
  // Compare against meta.updatedAt first: it is the field GET serves as
  // `updatedAt`, which is what the client stored as its base. (Push writes
  // both columns from the same instant, so they normally agree.)
  const revision = guardMastersRevision(
    baseUpdatedAt ?? null,
    meta?.updatedAt ?? meta?.lastUpdatedAt ?? null,
  );
  if (!revision.allow) {
    console.warn(
      `[masters-desk] rejected stale push`,
      `base=${baseUpdatedAt} stored=${revision.storedUpdatedAt}`,
    );
    return NextResponse.json(
      {
        error: revision.message,
        reason: revision.reason,
        storedUpdatedAt: revision.storedUpdatedAt,
      },
      { status: 409 },
    );
  }
  if (revision.reason === "unversioned" && meta) {
    console.warn("[masters-desk] unversioned push accepted (legacy client)");
  }

  // A client must not be able to replace the class-id generation wholesale.
  // This is checked before the write, not after, because pushMastersDeskToDb
  // upserts every slice in one go — by the time it returns, every student,
  // lead and RTE seat referencing a class is already orphaned.
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
    // The exact revision written to sync meta, not a fresh timestamp: the
    // client stores this as the base for its next push, and it must equal
    // what the revision guard will read back.
    updatedAt: pushed.updatedAt || new Date().toISOString(),
  });
}
