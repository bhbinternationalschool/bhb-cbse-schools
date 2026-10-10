import { NextResponse } from "next/server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import type { StatutoryRemitState } from "@/lib/statutoryRemit";
import {
  normalizeStatutoryConfig,
  type StatutoryEstablishmentConfig,
} from "@/lib/foundationMasters";
import { statutoryDualWriteDbEnabled } from "@/lib/statutoryDbConfig";
import {
  fetchStatutoryDeskFromDb,
  pushStatutoryDeskToDb,
  STATUTORY_DELETABLE_TABLES,
  STATUTORY_STAMPED_SLICES,
} from "@/lib/statutoryNormalized.server";
import { readStampsParam } from "@/lib/rowStampClient";
import { readNamedDeletes } from "@/lib/deskNamedDeletes.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["statutory-desk"], "GET");
  if (!auth.ok) return auth.response
  const { bundle, meta, ok, stamps, settingsStamp } = await fetchStatutoryDeskFromDb();
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "Failed to fetch statutory desk" },
      { status: 503 },
    );
  }
  return NextResponse.json({
    ok: true,
    batches: bundle.batches,
    config: bundle.config,
    batchCount: bundle.batches.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
    stamps,
    configStamp: settingsStamp,
  });
}

export async function POST(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["statutory-desk"], "POST");
  if (!auth.ok) return auth.response
  if (!statutoryDualWriteDbEnabled()) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  let body: Pick<StatutoryRemitState, "batches"> & {
    config?: Partial<StatutoryEstablishmentConfig>;
    deletes?: unknown;
    stamps?: unknown;
    settingsBase?: string | null;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await pushStatutoryDeskToDb(
    { version: 1, batches: body.batches ?? [] },
    normalizeStatutoryConfig(body.config),
    readNamedDeletes(body.deletes, STATUTORY_DELETABLE_TABLES),
    {
      // No stamps = a tab from before 10 Oct 2026: it may add, never replace.
      stamps: readStampsParam(body.stamps, STATUTORY_STAMPED_SLICES),
      configBase: typeof body.settingsBase === "string" ? body.settingsBase : null,
    },
  );
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    batchCount: body.batches?.length ?? 0,
    updatedAt: new Date().toISOString(),
    stamps: result.stamps,
    conflicts: result.conflicts,
    settingsStamp: result.settingsStamp,
  });
}
