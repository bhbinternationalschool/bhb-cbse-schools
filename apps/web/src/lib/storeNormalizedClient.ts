/**
 * Client → server sync for normalized store desk.
 */

import type { StoreState } from "@/lib/store";
import { isSupabaseConfigured } from "@/lib/supabase/client";

const META_KEY = "bhb_store_desk_db_meta_v1";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: StoreState | null = null;

type DeskMeta = { updatedAt: string; itemCount: number };

function readMeta(): DeskMeta {
  if (typeof window === "undefined") return { updatedAt: "", itemCount: 0 };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { updatedAt: "", itemCount: 0 };
    const p = JSON.parse(raw) as DeskMeta;
    return {
      updatedAt: String(p.updatedAt || ""),
      itemCount: Number(p.itemCount) || 0,
    };
  } catch {
    return { updatedAt: "", itemCount: 0 };
  }
}

function writeMeta(patch: Partial<DeskMeta> & { updatedAt: string; itemCount: number }) {
  if (typeof window === "undefined") return;
  localStorage.setItem(META_KEY, JSON.stringify({ ...readMeta(), ...patch }));
}

export function storeNormalizedSyncEnabled(): boolean {
  return isSupabaseConfigured();
}

export function storeReadFromDbClientEnabled(): boolean {
  return process.env.NEXT_PUBLIC_STORE_READ_FROM_DB === "true";
}

export function scheduleStoreDeskSync(state: StoreState) {
  if (!storeNormalizedSyncEnabled() || typeof window === "undefined") return;
  pending = state;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const batch = pending;
    pending = null;
    pushTimer = null;
    if (batch) void pushStoreDeskApi(batch);
  }, 600);
}

async function pushStoreDeskApi(state: StoreState) {
  try {
    const res = await fetch("/api/school-data/store-desk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categories: state.categories,
        saleGroups: state.saleGroups,
        uoms: state.uoms,
        infraLevels: state.infraLevels,
        sources: state.sources,
        items: state.items,
        issues: state.issues,
        movements: state.movements,
        inventoryAllocations: state.inventoryAllocations,
        assetAllocations: state.assetAllocations,
        sellReturns: state.sellReturns,
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      itemCount?: number;
      error?: string;
    } | null;
    if (res.ok && body?.ok) {
      writeMeta({
        updatedAt: body.updatedAt || new Date().toISOString(),
        itemCount: body.itemCount ?? state.items.length,
      });
    }
  } catch (e) {
    console.warn("[store-db] desk push error", e);
  }
}

export async function fetchStoreDeskFromApi() {
  if (!storeNormalizedSyncEnabled()) return null;
  try {
    const res = await fetch("/api/school-data/store-desk", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as StoreDeskBundle & {
      ok?: boolean;
      updatedAt?: string;
      itemCount?: number;
    };
    if (!Array.isArray(body.items)) return null;
    return {
      bundle: {
        categories: body.categories ?? [],
        saleGroups: body.saleGroups ?? [],
        uoms: body.uoms ?? [],
        infraLevels: body.infraLevels ?? [],
        sources: body.sources ?? [],
        items: body.items,
        issues: body.issues ?? [],
        movements: body.movements ?? [],
        inventoryAllocations: body.inventoryAllocations ?? [],
        assetAllocations: body.assetAllocations ?? [],
        sellReturns: body.sellReturns ?? [],
      },
      updatedAt: body.updatedAt || "",
      itemCount: body.itemCount ?? body.items.length,
    };
  } catch {
    return null;
  }
}

type StoreDeskBundle = {
  categories: StoreState["categories"];
  saleGroups: StoreState["saleGroups"];
  uoms: StoreState["uoms"];
  infraLevels: StoreState["infraLevels"];
  sources: StoreState["sources"];
  items: StoreState["items"];
  issues: StoreState["issues"];
  movements: StoreState["movements"];
  inventoryAllocations: StoreState["inventoryAllocations"];
  assetAllocations: StoreState["assetAllocations"];
  sellReturns: StoreState["sellReturns"];
};

export async function hydrateStoreDeskFromDb(preferDb?: boolean) {
  const remote = await fetchStoreDeskFromApi();
  const empty = {
    bundle: {
      categories: [] as StoreState["categories"],
      saleGroups: [] as StoreState["saleGroups"],
      uoms: [] as StoreState["uoms"],
      infraLevels: [] as StoreState["infraLevels"],
      sources: [] as StoreState["sources"],
      items: [] as StoreState["items"],
      issues: [] as StoreState["issues"],
      movements: [] as StoreState["movements"],
      inventoryAllocations: [] as StoreState["inventoryAllocations"],
      assetAllocations: [] as StoreState["assetAllocations"],
      sellReturns: [] as StoreState["sellReturns"],
    },
    changed: false,
  };
  if (!remote) return empty;

  const meta = readMeta();
  const shouldTake =
    preferDb ||
    storeReadFromDbClientEnabled() ||
    meta.itemCount === 0 ||
    (remote.updatedAt && remote.updatedAt >= meta.updatedAt) ||
    remote.itemCount > meta.itemCount;

  if (!shouldTake) return empty;

  writeMeta({ updatedAt: remote.updatedAt, itemCount: remote.itemCount });
  return { bundle: remote.bundle, changed: true };
}
