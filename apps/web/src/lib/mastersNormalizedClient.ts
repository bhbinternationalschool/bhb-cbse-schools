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

/**
 * Push any pending masters state now and report what happened.
 *
 * Returns the push result so a caller can await the real outcome; `null`
 * means there was nothing pending. Existing callers that ignore the return
 * value (pagehide, logout) keep their previous behaviour.
 */
export function flushMastersDeskSyncPending(): Promise<MastersPushResult | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  const batch = pending;
  pending = null;
  if (!batch) return Promise.resolve(null);
  return pushMastersDeskApi(batch);
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

/**
 * Result of a masters push. Returned rather than swallowed so a caller can
 * await the outcome instead of assuming success — the UI currently reports
 * "saved" synchronously, which is how 16 refused writes looked like 16
 * successful ones. Stage 2 makes the workspace await this.
 */
export type MastersPushResult = { ok: true } | { ok: false; reason: string };

async function pushMastersDeskApi(
  state: MastersState,
): Promise<MastersPushResult> {
  try {
    const payload = stripStaffFromMastersForBlob(state);
    const { version: _v, ...rest } = payload;
    const res = await fetch("/api/school-data/masters-desk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: 2,
        ...rest,
        // Optimistic locking: the desk revision this client last hydrated
        // or pushed at. The server refuses the push (409 "stale") when the
        // desk has moved since — see mastersRevisionGuard.ts.
        baseUpdatedAt: readMeta().updatedAt || null,
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      classCount?: number;
      feeHeadCount?: number;
      error?: string;
      reason?: string;
    } | null;
    if (res.ok && body?.ok) {
      // Never invent a revision. This value becomes `baseUpdatedAt` on the
      // next push, so a local clock here is exactly what made every masters
      // save 409 in production. If the server omitted it, keep the last
      // known server value and let the next hydrate correct it.
      if (!body.updatedAt) {
        console.warn("[masters-db] push accepted but server returned no revision");
      }
      writeMeta({
        updatedAt: body.updatedAt || readMeta().updatedAt,
        classCount: body.classCount ?? state.classes.length,
        feeHeadCount: body.feeHeadCount ?? state.feeHeads.length,
      });
      return { ok: true };
    }

    // Every rejection below used to be invisible except `stale`. On
    // 2026-08-09 a device holding a foreign class-id generation had 16
    // consecutive saves refused with `regenerated` while the screen kept
    // reporting success — the academic session could not be changed all
    // evening and nothing on screen said why. A refused write must always
    // reach the user.
    if (res.status === 409) {
      const rehydrate =
        body?.reason === "stale" ||
        body?.reason === "regenerated" ||
        body?.reason === "wipe";
      console.warn(`[masters-db] push refused (${body?.reason})`, body?.error);
      await reportMastersPushFailure(
        body?.reason === "stale"
          ? "Masters changed on another device — your last change was NOT saved. " +
              "The screen will refresh with the current data; please re-apply it."
          : body?.reason === "regenerated"
            ? "Your last change was NOT saved. This device is holding an older " +
              "copy of the class list, so the server refused it to protect the " +
              "student records. The screen will refresh — please re-apply your change."
            : body?.reason === "wipe"
              ? "Your last change was NOT saved. It would have removed every class, " +
                "which the server refuses. Reload and try again."
              : `Your last change was NOT saved. ${body?.error || "The server refused it."}`,
      );
      if (rehydrate) {
        const { resetDeskHydrated } = await import("@/lib/deskHydrateGuard");
        resetDeskHydrated("masters");
      }
      return { ok: false, reason: body?.reason ?? "conflict" };
    }

    // 401/403/500/503 and anything else: also silent until now.
    console.warn("[masters-db] desk push failed", body?.error || res.status);
    await reportMastersPushFailure(
      res.status === 401 || res.status === 403
        ? "Your last change was NOT saved — your session has expired or you do not " +
            "have permission. Sign in again and re-apply the change."
        : `Your last change was NOT saved — the server returned ${res.status}. ` +
            "Please try again.",
    );
    return { ok: false, reason: `http_${res.status}` };
  } catch (e) {
    // A genuine network fault. Say that specifically — do NOT tell the user
    // to check their connection for a server-side failure, which is what the
    // generic loader message did and sent the director hunting a fine router.
    console.warn("[masters-db] desk push error", e);
    await reportMastersPushFailure(
      "Your last change was NOT saved — could not reach the server. " +
        "Check your connection and try again.",
    );
    return { ok: false, reason: "network" };
  }
}

async function reportMastersPushFailure(message: string) {
  if (typeof window === "undefined") return;
  const { pushToast } = await import("@/components/shell/Toast");
  pushToast({ kind: "error", message, durationMs: 0 });
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
      // Same rule as the push path: a revision only ever comes from the
      // server. Keep the previous one rather than stamping a local clock.
      updatedAt: remoteAt || meta.updatedAt,
      classCount: remoteClasses,
      feeHeadCount: body.feeHeadCount ?? bundle.feeHeads?.length ?? 0,
    });
    return { bundle, changed: true, ok: true };
  } catch {
    return { bundle: empty, changed: false, ok: false };
  }
}
