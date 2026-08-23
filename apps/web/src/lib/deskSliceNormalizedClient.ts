/**
 * Generic client sync for desk-slice modules.
 */

import type { DeskModuleId } from "@/lib/deskCutover";
import { deskSliceDef, deskSliceEnvReadFromDb } from "@/lib/deskSliceRegistry";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { DESK_PUSH_DEBOUNCE_MS } from "@/lib/workspaceSyncPolicy";
import {
  recordDeskSyncFailure,
  recordDeskSyncSuccess,
} from "@/lib/deskSyncStatus";

type DeskMeta = { updatedAt: string; rowCount: number };

const metaKey = (id: DeskModuleId) => `bhb_${id}_desk_db_meta_v1`;
const timers = new Map<DeskModuleId, ReturnType<typeof setTimeout>>();
const pending = new Map<
  DeskModuleId,
  { version: number } & Record<string, unknown>
>();
// Per-module push generation: a retry of an older payload must never land
// after a newer one (audit 2026-08-18).
const generations = new Map<DeskModuleId, number>();

function readMeta(id: DeskModuleId): DeskMeta {
  if (typeof window === "undefined") return { updatedAt: "", rowCount: 0 };
  try {
    const raw = localStorage.getItem(metaKey(id));
    if (!raw) return { updatedAt: "", rowCount: 0 };
    const p = JSON.parse(raw) as DeskMeta;
    return {
      updatedAt: String(p.updatedAt || ""),
      rowCount: Number(p.rowCount) || 0,
    };
  } catch {
    return { updatedAt: "", rowCount: 0 };
  }
}

function writeMeta(id: DeskModuleId, patch: DeskMeta) {
  if (typeof window === "undefined") return;
  localStorage.setItem(metaKey(id), JSON.stringify(patch));
}

export function scheduleDeskSliceSync(
  id: DeskModuleId,
  state: { version: number } & Record<string, unknown>,
) {
  if (!isSupabaseConfigured() || typeof window === "undefined") return;
  pending.set(id, state);
  const gen = (generations.get(id) ?? 0) + 1;
  generations.set(id, gen);
  const existing = timers.get(id);
  if (existing) clearTimeout(existing);
  timers.set(
    id,
    setTimeout(() => {
      const batch = pending.get(id);
      pending.delete(id);
      timers.delete(id);
      if (!batch) return;
      void pushDeskSliceApi(id, batch, 1, gen);
    }, DESK_PUSH_DEBOUNCE_MS),
  );
}

function reportDeskPushFailure(id: DeskModuleId, error: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("bhb-sync-error", { detail: { id, error } }),
  );
}

async function pushDeskSliceApi(
  id: DeskModuleId,
  state: { version: number } & Record<string, unknown>,
  attempt = 1,
  generation = generations.get(id) ?? 0,
) {
  if (generation !== (generations.get(id) ?? 0)) return; // superseded
  try {
    const res = await fetch(`/api/school-data/desk-slice/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      rowCount?: number;
      error?: string;
    } | null;
    if (res.ok && body?.ok) {
      writeMeta(id, {
        updatedAt: body.updatedAt || new Date().toISOString(),
        rowCount: body.rowCount ?? readMeta(id).rowCount,
      });
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("bhb-desk-synced", { detail: { id } }),
        );
      }
    } else if (attempt < 3) {
      setTimeout(
        () => void pushDeskSliceApi(id, state, attempt + 1, generation),
        1500 * attempt,
      );
    } else {
      const reason = body?.error || `HTTP ${res.status}`;
      console.warn(`[${id}-db] desk push failed after 3 attempts`, reason);
      reportDeskPushFailure(id, reason);
    }
    // Record whether this actually landed. A not-ok response is not
    // thrown, so without this it slips past every branch in silence.
    if (res.ok && body?.ok) recordDeskSyncSuccess("desk_slice");
    else recordDeskSyncFailure("desk_slice", { status: res.status, error: body?.error });
  } catch (e) {
    recordDeskSyncFailure("desk_slice", { status: 0, error: e instanceof Error ? e.message : String(e) });
    if (attempt < 3) {
      setTimeout(
        () => void pushDeskSliceApi(id, state, attempt + 1, generation),
        1500 * attempt,
      );
    } else {
      console.warn(`[${id}-db] desk push error after 3 attempts`, e);
      reportDeskPushFailure(id, String(e));
    }
  }
}

export async function hydrateDeskSliceFromDb(
  id: DeskModuleId,
  preferDb?: boolean,
): Promise<{ bundle: Record<string, unknown>; changed: boolean; ok: boolean }> {
  const def = deskSliceDef(id);
  if (!def || !isSupabaseConfigured()) {
    return { bundle: {}, changed: false, ok: true };
  }
  try {
    const res = await fetch(`/api/school-data/desk-slice/${id}`, {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return { bundle: {}, changed: false, ok: false };
    const body = (await res.json()) as Record<string, unknown> & {
      updatedAt?: string;
      rowCount?: number;
    };
    const bundle: Record<string, unknown> = {};
    for (const key of [...def.objectSlices, ...def.sliceKeys]) {
      if (body[key] !== undefined) bundle[key] = body[key];
    }
    const meta = readMeta(id);
    const signal = bundle[def.signalSlice];
    const remoteRows =
      body.rowCount ??
      (Array.isArray(signal)
        ? signal.length
        : signal != null
          ? 1
          : 0);
    const shouldTake =
      preferDb ||
      deskSliceEnvReadFromDb(def.envPrefix) ||
      meta.rowCount === 0 ||
      (body.updatedAt && body.updatedAt >= meta.updatedAt) ||
      remoteRows > meta.rowCount;
    if (!shouldTake) return { bundle: {}, changed: false, ok: true };
    writeMeta(id, {
      updatedAt: body.updatedAt || new Date().toISOString(),
      rowCount: remoteRows,
    });
    return { bundle, changed: true, ok: true };
  } catch {
    return { bundle: {}, changed: false, ok: false };
  }
}
