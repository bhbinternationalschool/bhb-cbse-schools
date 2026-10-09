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
import {
  confirmDeskDeletes,
  pendingDeskDeletes,
  recordDeskDeletion,
} from "@/lib/deskNamedDeletes";

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

/* ─── Named deletes for slices the UI deletes from ─────────────────────────
 *
 * The server merges these slices by id (a save never deletes what it lacks),
 * so a deletion has to be said. Rather than touch every delete button, the
 * client compares each save with the ids it last KNEW from the server — the
 * last successful load or save in this page session. A known row that a
 * save drops is one this browser deleted; a row created elsewhere was never
 * known here, so it can never be taken for a deletion.
 *
 * The known ids live in memory only: a cache wiped by a full disk, then
 * re-seeded empty, must not read as "the user deleted everything". Two more
 * guards for the same reason: a save that drops 10+ rows and over half of
 * what it knew, or empties every deletable list at once, names nothing.
 */
const known = new Map<DeskModuleId, Map<string, string[]>>();
const deskKey = (id: DeskModuleId) => `slice:${id}`;

function keysOf(list: unknown, field: string): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const r of list) {
    const k = r && typeof r === "object" ? (r as Record<string, unknown>)[field] : undefined;
    if (typeof k === "string" && k !== "") out.push(k);
  }
  return out;
}

/** The server's copy of this module, as this browser now knows it. */
export function rememberDeskSliceKnownIds(id: DeskModuleId, state: Record<string, unknown>) {
  const def = deskSliceDef(id);
  if (!def?.clientDeleteSlices?.length) return;
  const map = new Map<string, string[]>();
  for (const slice of def.clientDeleteSlices) {
    if (Array.isArray(state[slice])) map.set(slice, keysOf(state[slice], def.mergeKeys?.[slice] ?? "id"));
  }
  known.set(id, map);
}

/**
 * Which rows a save deleted: known ids it no longer holds, per slice — minus
 * anything that looks like a lost cache rather than a person deleting.
 * Pure (exported for the self-test).
 */
export function computeDeskSliceDeletions(
  def: { clientDeleteSlices?: string[]; mergeKeys?: Record<string, string> },
  was: Map<string, string[]> | undefined,
  state: Record<string, unknown>,
): { deletes: Record<string, string[]>; skipped?: string } {
  if (!def.clientDeleteSlices?.length || !was) return { deletes: {} };
  const deletes: Record<string, string[]> = {};
  let knownTotal = 0;
  let allEmpty = true;
  let skipped: string | undefined;
  for (const slice of def.clientDeleteSlices) {
    const before = was.get(slice);
    if (!before || !Array.isArray(state[slice])) continue;
    knownTotal += before.length;
    const now = new Set(keysOf(state[slice], def.mergeKeys?.[slice] ?? "id"));
    if (now.size > 0) allEmpty = false;
    const gone = before.filter((k) => !now.has(k));
    if (!gone.length) continue;
    if (gone.length >= 10 && gone.length > before.length / 2) {
      skipped = `${slice}: ${gone.length} of ${before.length} rows gone at once`;
      continue;
    }
    deletes[slice] = gone;
  }
  if (allEmpty && knownTotal >= 2) {
    return { deletes: {}, skipped: "every deletable list is empty at once" };
  }
  return { deletes, skipped };
}

function noteDeskSliceDeletions(id: DeskModuleId, state: Record<string, unknown>) {
  const def = deskSliceDef(id);
  if (!def) return;
  const { deletes, skipped } = computeDeskSliceDeletions(def, known.get(id), state);
  if (skipped) console.warn(`[${id}-db] ${skipped} — treated as a lost cache, not deletions`);
  for (const [slice, ids] of Object.entries(deletes)) recordDeskDeletion(deskKey(id), slice, ids);
}

export function scheduleDeskSliceSync(
  id: DeskModuleId,
  state: { version: number } & Record<string, unknown>,
) {
  if (!isSupabaseConfigured() || typeof window === "undefined") return;
  noteDeskSliceDeletions(id, state);
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
    const sentDeletes = pendingDeskDeletes(deskKey(id));
    const res = await fetch(`/api/school-data/desk-slice/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Deletions are named, never inferred from what this browser lacks.
      body: JSON.stringify(
        Object.keys(sentDeletes).length ? { ...state, deletes: sentDeletes } : state,
      ),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      rowCount?: number;
      error?: string;
    } | null;
    if (res.ok && body?.ok) {
      confirmDeskDeletes(deskKey(id), sentDeletes);
      rememberDeskSliceKnownIds(id, state);
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
