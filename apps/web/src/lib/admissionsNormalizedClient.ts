/**
 * Client → server sync for normalized admission desk.
 */

import type { AdmissionsState } from "@/lib/admissions";
import { isSupabaseConfigured } from "@/lib/supabase/client";

const META_KEY = "bhb_admissions_desk_db_meta_v1";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: AdmissionsState | null = null;

type DeskMeta = {
  updatedAt: string;
  leadCount: number;
};

function readMeta(): DeskMeta {
  if (typeof window === "undefined") return { updatedAt: "", leadCount: 0 };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { updatedAt: "", leadCount: 0 };
    const p = JSON.parse(raw) as DeskMeta;
    return {
      updatedAt: String(p.updatedAt || ""),
      leadCount: Number(p.leadCount) || 0,
    };
  } catch {
    return { updatedAt: "", leadCount: 0 };
  }
}

function writeMeta(patch: Partial<DeskMeta> & { updatedAt: string; leadCount: number }) {
  if (typeof window === "undefined") return;
  const prev = readMeta();
  localStorage.setItem(META_KEY, JSON.stringify({ ...prev, ...patch }));
}

export function admissionsNormalizedSyncEnabled(): boolean {
  return isSupabaseConfigured();
}

export function admissionsReadFromDbClientEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ADMISSIONS_READ_FROM_DB === "true";
}

export function scheduleAdmissionsDeskSync(state: AdmissionsState) {
  if (!admissionsNormalizedSyncEnabled()) return;
  if (typeof window === "undefined") return;
  pending = state;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const batch = pending;
    pending = null;
    pushTimer = null;
    if (!batch) return;
    void pushAdmissionsDeskApi(batch);
  }, 600);
}

async function pushAdmissionsDeskApi(state: AdmissionsState) {
  try {
    const res = await fetch("/api/school-data/admissions-desk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ state }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      leadCount?: number;
      error?: string;
    } | null;
    if (res.ok && body?.ok) {
      writeMeta({
        updatedAt: body.updatedAt || new Date().toISOString(),
        leadCount: body.leadCount ?? state.leads.length,
      });
    } else if (!res.ok) {
      console.warn("[admissions-db] desk push failed", body?.error || res.status);
    }
  } catch (e) {
    console.warn("[admissions-db] desk push error", e);
  }
}

export async function fetchAdmissionsDeskFromApi(): Promise<{
  state: AdmissionsState;
  updatedAt: string;
  leadCount: number;
} | null> {
  if (!admissionsNormalizedSyncEnabled()) return null;
  try {
    const res = await fetch("/api/school-data/admissions-desk", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      state?: AdmissionsState;
      updatedAt?: string;
      leadCount?: number;
    };
    if (!body.state) return null;
    return {
      state: body.state,
      updatedAt: body.updatedAt || "",
      leadCount: body.leadCount ?? body.state.leads?.length ?? 0,
    };
  } catch {
    return null;
  }
}

export async function hydrateAdmissionsDeskFromDb(
  preferDb?: boolean,
): Promise<{ state: AdmissionsState | null; changed: boolean }> {
  const remote = await fetchAdmissionsDeskFromApi();
  if (!remote) return { state: null, changed: false };

  const meta = readMeta();
  const shouldTake =
    preferDb ||
    admissionsReadFromDbClientEnabled() ||
    meta.leadCount === 0 ||
    (remote.updatedAt && remote.updatedAt >= meta.updatedAt) ||
    remote.leadCount > meta.leadCount;

  if (!shouldTake) return { state: null, changed: false };

  writeMeta({
    updatedAt: remote.updatedAt,
    leadCount: remote.leadCount,
  });

  return { state: remote.state, changed: true };
}
