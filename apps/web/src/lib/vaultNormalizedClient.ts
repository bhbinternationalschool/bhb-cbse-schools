/**
 * Client → server sync for normalized vault desk.
 */

import type { VaultState } from "@/lib/vault";
import { isSupabaseConfigured } from "@/lib/supabase/client";

const META_KEY = "bhb_vault_desk_db_meta_v1";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: VaultState | null = null;

type DeskMeta = {
  updatedAt: string;
  documentCount: number;
};

function readMeta(): DeskMeta {
  if (typeof window === "undefined") return { updatedAt: "", documentCount: 0 };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { updatedAt: "", documentCount: 0 };
    const p = JSON.parse(raw) as DeskMeta;
    return {
      updatedAt: String(p.updatedAt || ""),
      documentCount: Number(p.documentCount) || 0,
    };
  } catch {
    return { updatedAt: "", documentCount: 0 };
  }
}

function writeMeta(
  patch: Partial<DeskMeta> & { updatedAt: string; documentCount: number },
) {
  if (typeof window === "undefined") return;
  const prev = readMeta();
  localStorage.setItem(META_KEY, JSON.stringify({ ...prev, ...patch }));
}

export function vaultNormalizedSyncEnabled(): boolean {
  return isSupabaseConfigured();
}

export function vaultReadFromDbClientEnabled(): boolean {
  return process.env.NEXT_PUBLIC_VAULT_READ_FROM_DB === "true";
}

export function scheduleVaultDeskSync(state: VaultState) {
  if (!vaultNormalizedSyncEnabled()) return;
  if (typeof window === "undefined") return;
  pending = state;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const batch = pending;
    pending = null;
    pushTimer = null;
    if (!batch) return;
    void pushVaultDeskApi(batch);
  }, 600);
}

async function pushVaultDeskApi(state: VaultState) {
  try {
    const res = await fetch("/api/school-data/vault-desk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documents: state.documents,
        settings: state.settings,
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      documentCount?: number;
      error?: string;
    } | null;
    if (res.ok && body?.ok) {
      writeMeta({
        updatedAt: body.updatedAt || new Date().toISOString(),
        documentCount: body.documentCount ?? state.documents.length,
      });
    } else if (!res.ok) {
      console.warn("[vault-db] desk push failed", body?.error || res.status);
    }
  } catch (e) {
    console.warn("[vault-db] desk push error", e);
  }
}

export async function fetchVaultDeskFromApi(): Promise<{
  bundle: Pick<VaultState, "documents" | "settings">;
  updatedAt: string;
  documentCount: number;
} | null> {
  if (!vaultNormalizedSyncEnabled()) return null;
  try {
    const res = await fetch("/api/school-data/vault-desk", {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      documents?: VaultState["documents"];
      settings?: VaultState["settings"];
      updatedAt?: string;
      documentCount?: number;
    };
    if (!Array.isArray(body.documents)) return null;
    return {
      bundle: {
        documents: body.documents,
        settings: body.settings ?? { digestMobiles: "" },
      },
      updatedAt: body.updatedAt || "",
      documentCount: body.documentCount ?? body.documents.length,
    };
  } catch {
    return null;
  }
}

type VaultDeskBundle = Pick<VaultState, "documents" | "settings">;

export async function hydrateVaultDeskFromDb(
  preferDb?: boolean,
): Promise<{ bundle: VaultDeskBundle; changed: boolean }> {
  const remote = await fetchVaultDeskFromApi();
  const empty: VaultDeskBundle = {
    documents: [],
    settings: { digestMobiles: "" },
  };
  if (!remote) return { bundle: empty, changed: false };

  const meta = readMeta();
  const shouldTake =
    preferDb ||
    vaultReadFromDbClientEnabled() ||
    meta.documentCount === 0 ||
    (remote.updatedAt && remote.updatedAt >= meta.updatedAt) ||
    remote.documentCount > meta.documentCount;

  if (!shouldTake) return { bundle: empty, changed: false };

  writeMeta({
    updatedAt: remote.updatedAt,
    documentCount: remote.documentCount,
  });

  return { bundle: remote.bundle, changed: true };
}
