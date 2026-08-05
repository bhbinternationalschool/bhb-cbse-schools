/**
 * Client → server sync for masters desk slices.
 */

import type { MastersState } from "@/lib/masters";
import { emptyMastersShell } from "@/lib/masters";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { stripStaffFromMastersForBlob } from "@/lib/staffPersistence";

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
  body: { classCount?: number; feeHeadCount?: number },
): boolean {
  return (
    (body.classCount ?? bundle.classes?.length ?? 0) > 0 ||
    (body.feeHeadCount ?? bundle.feeHeads?.length ?? 0) > 0 ||
    (bundle.subjects?.length ?? 0) > 0
  );
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
  }, 600);
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
): Promise<{ bundle: Omit<MastersState, "version">; changed: boolean }> {
  const { version: _v, ...empty } = emptyMastersShell();

  if (!isSupabaseConfigured()) return { bundle: empty, changed: false };
  try {
    const res = await fetch("/api/school-data/masters-desk", {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return { bundle: empty, changed: false };
    const body = (await res.json()) as Omit<MastersState, "version"> & {
      updatedAt?: string;
      classCount?: number;
      feeHeadCount?: number;
    };
    const bundle = body as Omit<MastersState, "version">;
    const meta = readMeta();
    const localEditAt = readLocalMastersEditAt();
    const remoteAt = body.updatedAt || "";
    const remoteClasses = body.classCount ?? bundle.classes?.length ?? 0;
    const hasRemote = remoteDeskHasData(bundle, body);

    const readFromDb =
      preferDb || process.env.NEXT_PUBLIC_MASTERS_READ_FROM_DB === "true";

    const remoteIsNewer =
      !!remoteAt &&
      (!meta.updatedAt || remoteAt > meta.updatedAt) &&
      (!localEditAt || remoteAt > localEditAt);

    const bootstrapNewDevice =
      hasRemote && !meta.updatedAt && !localEditAt;

    const shouldTake =
      (readFromDb && hasRemote) ||
      (hasRemote && (bootstrapNewDevice || remoteIsNewer));

    if (!shouldTake) return { bundle: empty, changed: false };
    writeMeta({
      updatedAt: remoteAt || new Date().toISOString(),
      classCount: remoteClasses,
      feeHeadCount: body.feeHeadCount ?? bundle.feeHeads?.length ?? 0,
    });
    return { bundle, changed: true };
  } catch {
    return { bundle: empty, changed: false };
  }
}
