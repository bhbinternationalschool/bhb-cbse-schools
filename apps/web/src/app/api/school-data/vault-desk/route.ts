import { NextResponse } from "next/server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import type { VaultState } from "@/lib/vault";
import { vaultDualWriteDbEnabled } from "@/lib/vaultDbConfig";
import {
  fetchVaultDeskFromDb,
  pushVaultDeskToDb,
  VAULT_DELETABLE_TABLES,
  VAULT_STAMPED_SLICES,
} from "@/lib/vaultNormalized.server";
import { readNamedDeletes } from "@/lib/deskNamedDeletes.server";
import { readStampsParam } from "@/lib/rowStampClient";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["vault-desk"], "GET");
  if (!auth.ok) return auth.response
  const { bundle, meta, ok, stamps, settingsStamp } = await fetchVaultDeskFromDb();
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "Vault desk fetch failed — tenant/db unavailable" },
      { status: 503 },
    );
  }
  return NextResponse.json({
    ok: true,
    documents: bundle.documents,
    settings: bundle.settings,
    documentCount: bundle.documents.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
    stamps,
    settingsStamp,
  });
}

type VaultDeskPostBody = Pick<VaultState, "documents" | "settings"> & {
  deletes?: unknown;
  stamps?: unknown;
  settingsBase?: string | null;
};

export async function POST(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["vault-desk"], "POST");
  if (!auth.ok) return auth.response
  if (!vaultDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "VAULT_DUAL_WRITE_DB disabled",
    });
  }

  let body: VaultDeskPostBody;
  try {
    body = (await req.json()) as VaultDeskPostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await pushVaultDeskToDb({
    version: 1,
    documents: Array.isArray(body.documents) ? body.documents : [],
    settings: body.settings ?? { digestMobiles: "" },
  }, readNamedDeletes(body.deletes, VAULT_DELETABLE_TABLES), {
    // No stamps = a tab from before 10 Oct 2026: it may add, never replace.
    stamps: readStampsParam(body.stamps, VAULT_STAMPED_SLICES),
    settingsBase: typeof body.settingsBase === "string" ? body.settingsBase : null,
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    documentCount: body.documents?.length ?? 0,
    updatedAt: new Date().toISOString(),
    stamps: result.stamps,
    conflicts: result.conflicts,
    settingsStamp: result.settingsStamp,
  });
}
