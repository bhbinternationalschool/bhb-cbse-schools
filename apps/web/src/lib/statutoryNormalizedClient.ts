/**
 * Client → server sync for normalized statutory desk (statutory_desk_*).
 * Mirrors payrollNormalizedClient.ts's debounced-push / fetch / hydrate shape.
 */

import type { StatutoryRemitState } from "@/lib/statutoryRemit";
import { normalizeStatutoryConfig, type StatutoryEstablishmentConfig } from "@/lib/foundationMasters";
import { loadMasters } from "@/lib/masters";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { DESK_PUSH_DEBOUNCE_MS } from "@/lib/workspaceSyncPolicy";
import { statutoryReadFromDbEnabled } from "@/lib/statutoryDbConfig";
import {
  recordDeskSyncFailure,
  recordDeskSyncSuccess,
} from "@/lib/deskSyncStatus";

const META_KEY = "bhb_statutory_desk_db_meta_v1";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: StatutoryRemitState | null = null;

type DeskMeta = { updatedAt: string; batchCount: number };

function readMeta(): DeskMeta {
  if (typeof window === "undefined") return { updatedAt: "", batchCount: 0 };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { updatedAt: "", batchCount: 0 };
    const p = JSON.parse(raw) as DeskMeta;
    return {
      updatedAt: String(p.updatedAt || ""),
      batchCount: Number(p.batchCount) || 0,
    };
  } catch {
    return { updatedAt: "", batchCount: 0 };
  }
}

function writeMeta(patch: DeskMeta) {
  if (typeof window === "undefined") return;
  localStorage.setItem(META_KEY, JSON.stringify({ ...readMeta(), ...patch }));
}

export function statutoryNormalizedSyncEnabled(): boolean {
  return isSupabaseConfigured();
}

export function statutoryReadFromDbClientEnabled(): boolean {
  return statutoryReadFromDbEnabled();
}

export function scheduleStatutoryDeskSync(state: StatutoryRemitState) {
  if (!statutoryNormalizedSyncEnabled() || typeof window === "undefined") return;
  pending = state;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const batch = pending;
    pending = null;
    pushTimer = null;
    if (batch) void pushStatutoryDeskApi(batch);
  }, DESK_PUSH_DEBOUNCE_MS);
}

async function pushStatutoryDeskApi(state: StatutoryRemitState) {
  try {
    const config = normalizeStatutoryConfig(loadMasters().statutoryConfig);
    const res = await fetch("/api/school-data/statutory-desk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batches: state.batches, config }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      batchCount?: number;
      error?: string;
    } | null;
    if (res.ok && body?.ok) {
      writeMeta({
        updatedAt: body.updatedAt || new Date().toISOString(),
        batchCount: body.batchCount ?? state.batches.length,
      });
    }
    // Record whether this actually landed. A not-ok response is not
    // thrown, so without this it slips past every branch in silence.
    if (res.ok && body?.ok) recordDeskSyncSuccess("statutory");
    else recordDeskSyncFailure("statutory", { status: res.status, error: body?.error });
  } catch (e) {
    recordDeskSyncFailure("statutory", { status: 0, error: e instanceof Error ? e.message : String(e) });
    console.warn("[statutory-db] desk push error", e);
  }
}

export async function fetchStatutoryDeskFromApi() {
  if (!statutoryNormalizedSyncEnabled()) return null;
  try {
    const res = await fetch("/api/school-data/statutory-desk", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      ok?: boolean;
      batches?: StatutoryRemitState["batches"];
      config?: StatutoryEstablishmentConfig;
      updatedAt?: string;
      batchCount?: number;
    };
    if (!Array.isArray(body.batches)) return null;
    return {
      bundle: {
        batches: body.batches,
        config: normalizeStatutoryConfig(body.config),
      },
      updatedAt: body.updatedAt || "",
      batchCount: body.batchCount ?? body.batches.length,
    };
  } catch {
    return null;
  }
}

export async function hydrateStatutoryDeskFromDb(preferDb?: boolean) {
  const remote = await fetchStatutoryDeskFromApi();
  const empty = {
    bundle: {
      batches: [] as StatutoryRemitState["batches"],
      config: normalizeStatutoryConfig(null),
    },
    changed: false,
    ok: false,
  };
  if (!remote) return empty;

  const meta = readMeta();
  const shouldTake =
    preferDb ||
    statutoryReadFromDbEnabled() ||
    meta.batchCount === 0 ||
    (remote.updatedAt && remote.updatedAt >= meta.updatedAt) ||
    remote.batchCount > meta.batchCount;

  if (!shouldTake) return { ...empty, bundle: remote.bundle, ok: true };

  writeMeta({ updatedAt: remote.updatedAt, batchCount: remote.batchCount });
  return { bundle: remote.bundle, changed: true, ok: true };
}
