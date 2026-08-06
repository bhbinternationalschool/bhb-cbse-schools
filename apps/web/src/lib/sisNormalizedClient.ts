/**
 * Client → server sync for SIS roster (sis_households / sis_students).
 */

import type { SisState } from "@/lib/sis";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { DESK_PUSH_DEBOUNCE_MS } from "@/lib/workspaceSyncPolicy";
import type { SisRemoteBundle } from "@/lib/sisNormalized.server";

const META_KEY = "bhb_sis_db_meta_v1";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: Pick<SisState, "households" | "students"> | null = null;

type SisMeta = {
  updatedAt: string;
  studentCount: number;
  householdCount: number;
  lastPushedAt?: number;
};

function readMeta(): SisMeta {
  if (typeof window === "undefined") return { updatedAt: "", studentCount: 0, householdCount: 0 };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { updatedAt: "", studentCount: 0, householdCount: 0 };
    const p = JSON.parse(raw) as SisMeta;
    return {
      updatedAt: String(p.updatedAt || ""),
      studentCount: Number(p.studentCount) || 0,
      householdCount: Number(p.householdCount) || 0,
      lastPushedAt: p.lastPushedAt,
    };
  } catch {
    return { updatedAt: "", studentCount: 0, householdCount: 0 };
  }
}

function writeMeta(
  patch: Partial<SisMeta> & { updatedAt: string; studentCount: number; householdCount: number },
) {
  if (typeof window === "undefined") return;
  const prev = readMeta();
  localStorage.setItem(META_KEY, JSON.stringify({ ...prev, ...patch }));
}

export function sisNormalizedSyncEnabled(): boolean {
  return isSupabaseConfigured();
}

export function sisSyncRecentlyPushed(): boolean {
  const meta = readMeta();
  if (!meta.lastPushedAt) return false;
  return Date.now() - meta.lastPushedAt < 30_000;
}

export function sisReadFromDbClientEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SIS_READ_FROM_DB === "true";
}

export function scheduleSisDeskSync(state: Pick<SisState, "households" | "students">) {
  if (!sisNormalizedSyncEnabled()) return;
  if (typeof window === "undefined") return;
  pending = state;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    void flushSisDeskSync();
  }, DESK_PUSH_DEBOUNCE_MS);
}

export async function flushSisDeskSync(): Promise<void> {
  if (pushTimer) clearTimeout(pushTimer);
  const batch = pending;
  pending = null;
  pushTimer = null;
  if (!batch) return;
  await pushSisDeskApi(batch);
}

async function pushSisDeskApi(
  state: Pick<SisState, "households" | "students">,
  attempt = 1,
) {
  try {
    const res = await fetch("/api/school-data/sis-roster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        households: state.households ?? [],
        students: state.students ?? [],
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      studentCount?: number;
      householdCount?: number;
      error?: string;
    } | null;
    if (res.ok && body?.ok) {
      writeMeta({
        updatedAt: body.updatedAt || new Date().toISOString(),
        studentCount: body.studentCount ?? state.students.length,
        householdCount: body.householdCount ?? state.households.length,
        lastPushedAt: Date.now(),
      });
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("bhb-desk-synced", { detail: { module: "sis" } }),
        );
      }
    } else if (attempt < 3) {
      setTimeout(
        () => void pushSisDeskApi(state, attempt + 1),
        1500 * attempt,
      );
    } else {
      console.warn("[sis-db] roster push failed after 3 attempts", body?.error || res.status);
    }
  } catch (e) {
    if (attempt < 3) {
      setTimeout(
        () => void pushSisDeskApi(state, attempt + 1),
        1500 * attempt,
      );
    } else {
      console.warn("[sis-db] roster push error after 3 attempts", e);
    }
  }
}

export async function fetchSisDeskFromApi(): Promise<{
  bundle: SisRemoteBundle;
  updatedAt: string;
  studentCount: number;
  householdCount: number;
} | null> {
  if (!sisNormalizedSyncEnabled()) return null;
  try {
    const res = await fetch("/api/school-data/sis-roster", {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      households?: SisState["households"];
      students?: SisState["students"];
      updatedAt?: string;
      studentCount?: number;
      householdCount?: number;
    };
    if (!Array.isArray(body.households) || !Array.isArray(body.students)) return null;
    return {
      bundle: {
        households: body.households,
        students: body.students,
        householdUpdatedAt: {},
        studentUpdatedAt: {},
      },
      updatedAt: body.updatedAt || "",
      studentCount: body.studentCount ?? body.students.length,
      householdCount: body.householdCount ?? body.households.length,
    };
  } catch {
    return null;
  }
}

export async function hydrateSisDeskFromDb(preferDb?: boolean): Promise<{
  bundle: SisRemoteBundle;
  changed: boolean;
}> {
  const remote = await fetchSisDeskFromApi();
  if (!remote) {
    return {
      bundle: {
        households: [],
        students: [],
        householdUpdatedAt: {},
        studentUpdatedAt: {},
      },
      changed: false,
    };
  }

  const meta = readMeta();
  const shouldTake =
    preferDb ||
    sisReadFromDbClientEnabled() ||
    meta.studentCount === 0 ||
    (remote.updatedAt && remote.updatedAt >= meta.updatedAt) ||
    remote.studentCount > meta.studentCount;

  if (!shouldTake) {
    return { bundle: remote.bundle, changed: false };
  }

  writeMeta({
    updatedAt: remote.updatedAt,
    studentCount: remote.studentCount,
    householdCount: remote.householdCount,
  });
  return { bundle: remote.bundle, changed: true };
}
