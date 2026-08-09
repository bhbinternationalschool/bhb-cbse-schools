/**
 * Client → server sync for masters desk slices.
 */

import type { MastersState } from "@/lib/masters";
import { emptyMastersShell } from "@/lib/masters";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { stripStaffFromMastersForBlob } from "@/lib/staffPersistence";
import { DESK_PUSH_DEBOUNCE_MS } from "@/lib/workspaceSyncPolicy";

const META_KEY = "bhb_masters_desk_db_meta_v1";
const LOCAL_EDIT_META_KEY = "bhb_masters_mirror_meta_v1";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: MastersState | null = null;

type DeskMeta = {
  updatedAt: string;
  classCount: number;
  feeHeadCount: number;
};

function readMeta(): DeskMeta {
  if (typeof window === "undefined") {
    return { updatedAt: "", classCount: 0, feeHeadCount: 0 };
  }
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { updatedAt: "", classCount: 0, feeHeadCount: 0 };
    const p = JSON.parse(raw) as DeskMeta;
    return {
      updatedAt: String(p.updatedAt || ""),
      classCount: Number(p.classCount) || 0,
      feeHeadCount: Number(p.feeHeadCount) || 0,
    };
  } catch {
    return { updatedAt: "", classCount: 0, feeHeadCount: 0 };
  }
}

function writeMeta(patch: DeskMeta) {
  if (typeof window === "undefined") return;
  localStorage.setItem(META_KEY, JSON.stringify(patch));
}

/** Last local edit time (saveMasters / tenant wipe). */
export function readLocalMastersEditAt(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(LOCAL_EDIT_META_KEY);
    if (!raw) return "";
    return String((JSON.parse(raw) as { updatedAt?: string }).updatedAt || "");
  } catch {
    return "";
  }
}

/** True when local save is newer than last successful desk push meta. */
export function mastersDeskPushPending(): boolean {
  const localEditAt = readLocalMastersEditAt();
  if (!localEditAt) return false;
  const meta = readMeta();
  return !meta.updatedAt || localEditAt > meta.updatedAt;
}

/** Optimistic desk meta after local save — prevents stale DB overwriting edits on refresh. */
export function touchMastersDeskLocalMeta(state: MastersState, at?: string) {
  if (typeof window === "undefined") return;
  const updatedAt = at || new Date().toISOString();
  writeMeta({
    updatedAt,
    classCount: state.classes?.length ?? 0,
    feeHeadCount: state.feeHeads?.length ?? 0,
  });
}

function remoteDeskHasData(
  bundle: Omit<MastersState, "version">,
  body: {
    classCount?: number;
    feeHeadCount?: number;
    sliceCount?: number;
    updatedAt?: string;
  },
): boolean {
  if ((body.sliceCount ?? 0) > 0) return true;
  return (
    (body.classCount ?? bundle.classes?.length ?? 0) > 0 ||
    (body.feeHeadCount ?? bundle.feeHeads?.length ?? 0) > 0 ||
    (bundle.subjects?.length ?? 0) > 0 ||
    !!bundle.schoolProfile ||
    (bundle.campuses?.length ?? 0) > 0
  );
}

export function flushMastersDeskSyncPending(): void {
  if (typeof window === "undefined") return;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  const batch = pending;
  pending = null;
  if (batch) void pushMastersDeskApi(batch);
}

export function scheduleMastersDeskSync(state: MastersState) {
  if (!isSupabaseConfigured()) return;
  if (typeof window === "undefined") return;
  pending = state;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const batch = pending;
    pending = null;
    pushTimer = null;
    if (!batch) return;
    void pushMastersDeskApi(batch);
  }, DESK_PUSH_DEBOUNCE_MS);
}

async function pushMastersDeskApi(state: MastersState) {
  try {
    const payload = stripStaffFromMastersForBlob(state);
    const { version: _v, ...rest } = payload;
    const res = await fetch("/api/school-data/masters-desk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 2, ...rest }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      classCount?: number;
      feeHeadCount?: number;
      error?: string;
    } | null;
    if (res.ok && body?.ok) {
      writeMeta({
        updatedAt: body.updatedAt || new Date().toISOString(),
        classCount: body.classCount ?? state.classes.length,
        feeHeadCount: body.feeHeadCount ?? state.feeHeads.length,
      });
    } else if (!res.ok) {
      console.warn("[masters-db] desk push failed", body?.error || res.status);
    }
  } catch (e) {
    console.warn("[masters-db] desk push error", e);
  }
}

export async function hydrateMastersDeskFromDb(
  preferDb?: boolean,
): Promise<{ bundle: Omit<MastersState, "version">; changed: boolean; ok: boolean }> {
  const { version: _v, ...empty } = emptyMastersShell();

  if (!isSupabaseConfigured()) return { bundle: empty, changed: false, ok: true };
  try {
    const res = await fetch("/api/school-data/masters-desk", {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return { bundle: empty, changed: false, ok: false };
    const body = (await res.json()) as Omit<MastersState, "version"> & {
      updatedAt?: string;
      classCount?: number;
      feeHeadCount?: number;
      sliceCount?: number;
      meta?: { sliceCount?: number; updatedAt?: string };
    };
    const bundle = body as Omit<MastersState, "version">;
    const meta = readMeta();
    const localEditAt = readLocalMastersEditAt();
    const remoteAt = body.updatedAt || body.meta?.updatedAt || "";
    const sliceCount = body.sliceCount ?? body.meta?.sliceCount ?? 0;
    const remoteClasses = body.classCount ?? bundle.classes?.length ?? 0;
    const hasRemote = remoteDeskHasData(bundle, {
      classCount: body.classCount,
      feeHeadCount: body.feeHeadCount,
      sliceCount,
      updatedAt: remoteAt,
    });

    const flag = process.env.NEXT_PUBLIC_MASTERS_READ_FROM_DB?.trim().toLowerCase();
    const readFromDb = preferDb || flag !== "false";

    const remoteIsNewer =
      !!remoteAt &&
      (!meta.updatedAt || remoteAt > meta.updatedAt) &&
      (!localEditAt || remoteAt > localEditAt);

    const bootstrapNewDevice =
      hasRemote && !meta.updatedAt && !localEditAt;

    // Never let "remote has rows" alone clobber newer local edits (read-from-DB mode).
    const shouldTake = readFromDb
      ? remoteIsNewer || (!localEditAt && hasRemote)
      : hasRemote && (bootstrapNewDevice || remoteIsNewer);

    if (!shouldTake) return { bundle: empty, changed: false, ok: true };
    writeMeta({
      updatedAt: remoteAt || new Date().toISOString(),
      classCount: remoteClasses,
      feeHeadCount: body.feeHeadCount ?? bundle.feeHeads?.length ?? 0,
    });
    return { bundle, changed: true, ok: true };
  } catch {
    return { bundle: empty, changed: false, ok: false };
  }
}
