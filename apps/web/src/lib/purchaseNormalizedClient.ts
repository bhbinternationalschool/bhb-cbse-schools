/**
 * Client → server sync for normalized purchase desk.
 */

import type { PurchaseState } from "@/lib/purchase";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { DESK_PUSH_DEBOUNCE_MS } from "@/lib/workspaceSyncPolicy";

const META_KEY = "bhb_purchase_desk_db_meta_v1";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: PurchaseState | null = null;

type DeskMeta = { updatedAt: string; indentCount: number };

function readMeta(): DeskMeta {
  if (typeof window === "undefined") return { updatedAt: "", indentCount: 0 };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { updatedAt: "", indentCount: 0 };
    const p = JSON.parse(raw) as DeskMeta;
    return {
      updatedAt: String(p.updatedAt || ""),
      indentCount: Number(p.indentCount) || 0,
    };
  } catch {
    return { updatedAt: "", indentCount: 0 };
  }
}

function writeMeta(
  patch: Partial<DeskMeta> & { updatedAt: string; indentCount: number },
) {
  if (typeof window === "undefined") return;
  localStorage.setItem(META_KEY, JSON.stringify({ ...readMeta(), ...patch }));
}

export function purchaseNormalizedSyncEnabled(): boolean {
  return isSupabaseConfigured();
}

export function purchaseReadFromDbClientEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PURCHASE_READ_FROM_DB === "true";
}

export function schedulePurchaseDeskSync(state: PurchaseState) {
  if (!purchaseNormalizedSyncEnabled() || typeof window === "undefined") return;
  pending = state;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const batch = pending;
    pending = null;
    pushTimer = null;
    if (batch) void pushPurchaseDeskApi(batch);
  }, DESK_PUSH_DEBOUNCE_MS);
}

async function pushPurchaseDeskApi(state: PurchaseState) {
  try {
    const res = await fetch("/api/school-data/purchase-desk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        indents: state.indents,
        orders: state.orders,
        grns: state.grns,
        returns: state.returns,
        settings: state.settings,
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      indentCount?: number;
      error?: string;
    } | null;
    if (res.ok && body?.ok) {
      writeMeta({
        updatedAt: body.updatedAt || new Date().toISOString(),
        indentCount: body.indentCount ?? state.indents.length,
      });
    }
  } catch (e) {
    console.warn("[purchase-db] desk push error", e);
  }
}

export async function fetchPurchaseDeskFromApi() {
  if (!purchaseNormalizedSyncEnabled()) return null;
  try {
    const res = await fetch("/api/school-data/purchase-desk", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as PurchaseState & {
      ok?: boolean;
      updatedAt?: string;
      indentCount?: number;
    };
    if (!Array.isArray(body.indents)) return null;
    return {
      bundle: {
        indents: body.indents,
        orders: body.orders ?? [],
        grns: body.grns ?? [],
        returns: body.returns ?? [],
        settings: body.settings ?? {
          adminLimitPaise: 500_000,
          principalLimitPaise: 5_000_000,
        },
      },
      updatedAt: body.updatedAt || "",
      indentCount: body.indentCount ?? body.indents.length,
    };
  } catch {
    return null;
  }
}

export async function hydratePurchaseDeskFromDb(preferDb?: boolean) {
  const remote = await fetchPurchaseDeskFromApi();
  const empty = {
    bundle: {
      indents: [] as PurchaseState["indents"],
      orders: [] as PurchaseState["orders"],
      grns: [] as PurchaseState["grns"],
      returns: [] as PurchaseState["returns"],
      settings: {
        adminLimitPaise: 500_000,
        principalLimitPaise: 5_000_000,
      },
    },
    changed: false,
  };
  if (!remote) return empty;

  const meta = readMeta();
  const shouldTake =
    preferDb ||
    purchaseReadFromDbClientEnabled() ||
    meta.indentCount === 0 ||
    (remote.updatedAt && remote.updatedAt >= meta.updatedAt) ||
    remote.indentCount > meta.indentCount;

  if (!shouldTake) return empty;

  writeMeta({ updatedAt: remote.updatedAt, indentCount: remote.indentCount });
  return { bundle: remote.bundle, changed: true };
}
