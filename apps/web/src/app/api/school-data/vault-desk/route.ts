import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import type { VaultState } from "@/lib/vault";
import { vaultDualWriteDbEnabled } from "@/lib/vaultDbConfig";
import {
  fetchVaultDeskFromDb,
  pushVaultDeskToDb,
} from "@/lib/vaultNormalized.server";

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
  const { bundle, meta } = await fetchVaultDeskFromDb();
  return NextResponse.json({
    ok: true,
    documents: bundle.documents,
    settings: bundle.settings,
    documentCount: bundle.documents.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

type VaultDeskPostBody = Pick<VaultState, "documents" | "settings">;

export async function POST(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
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
  });
}
