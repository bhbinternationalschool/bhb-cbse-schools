/**
 * Admissions CRM remote sync — Supabase admissions_state via server API
 * (demo-auth sessions use service role on the server; direct client RLS would fail).
 */

import {
  admissionsStateIsEmpty,
  loadAdmissions,
  normalizeAdmissionsState,
  writeAdmissionsLocalRaw,
  type AdmissionsState,
} from "@/lib/admissions";
import { isSupabaseConfigured } from "@/lib/supabase/client";

let hydratedOnce = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPush: AdmissionsState | null = null;

const META_KEY = "bhb_admissions_v1_remote_meta";

export function admissionsRemoteEnabled() {
  return isSupabaseConfigured();
}

export function resetAdmissionsPersistenceCache() {
  hydratedOnce = false;
  pendingPush = null;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
}

function readMetaUpdatedAt(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return "";
    return String((JSON.parse(raw) as { updatedAt?: string }).updatedAt || "");
  } catch {
    return "";
  }
}

function writeMetaUpdatedAt(iso: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(META_KEY, JSON.stringify({ updatedAt: iso }));
}

async function fetchRemote(): Promise<{
  state: AdmissionsState | null;
  updatedAt: string;
}> {
  const res = await fetch("/api/school-data/admissions", {
    method: "GET",
    credentials: "same-origin",
  });
  if (!res.ok) {
    return { state: null, updatedAt: "" };
  }
  const body = (await res.json()) as {
    state?: Partial<AdmissionsState> | null;
    updatedAt?: string;
  };
  if (!body.state) return { state: null, updatedAt: body.updatedAt || "" };
  return {
    state: normalizeAdmissionsState(body.state),
    updatedAt: body.updatedAt || "",
  };
}

async function pushState(state: AdmissionsState): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/school-data/admissions", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
  });
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
  } | null;
  if (!res.ok || !body?.ok) {
    const message = body?.error || `HTTP ${res.status}`;
    console.warn("[admissions] push failed", message);
    return { ok: false, error: message };
  }
  writeMetaUpdatedAt(new Date().toISOString());
  return { ok: true };
}

export function scheduleAdmissionsSync(state: AdmissionsState) {
  if (!admissionsRemoteEnabled()) return;
  if (typeof window === "undefined") return;
  pendingPush = normalizeAdmissionsState(state);
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const payload = pendingPush;
    pendingPush = null;
    pushTimer = null;
    if (!payload) return;
    void pushState(payload);
  }, 500);
}

/** Pull once per tab; remote wins when newer or local empty. */
export async function ensureAdmissionsHydrated(): Promise<boolean> {
  if (!admissionsRemoteEnabled()) return false;
  if (hydratedOnce) return false;
  hydratedOnce = true;

  const remote = await fetchRemote();
  const local = loadAdmissions();
  const localAt = readMetaUpdatedAt();
  let changed = false;

  if (remote.state) {
    const remoteAt = remote.updatedAt || "";
    const takeRemote =
      admissionsStateIsEmpty(local) ||
      !localAt ||
      (remoteAt && remoteAt >= localAt);
    if (takeRemote && !admissionsStateIsEmpty(remote.state)) {
      writeAdmissionsLocalRaw(remote.state);
      writeMetaUpdatedAt(remoteAt || new Date().toISOString());
      changed = true;
    }
  }

  const next = loadAdmissions();
  if (!admissionsStateIsEmpty(next)) {
    await pushState(next);
  } else if (remote.state && !admissionsStateIsEmpty(remote.state)) {
    writeAdmissionsLocalRaw(remote.state);
    changed = true;
  }

  return changed;
}

/** Service-role pull for WhatsApp / server mirror (no browser session). */
export async function fetchAdmissionsRemoteServer(): Promise<AdmissionsState | null> {
  const { fetchServerBlob } = await import("@/lib/serverBlob");
  const remote = await fetchServerBlob<AdmissionsState>("admissions_state");
  if (!remote.state) return null;
  return normalizeAdmissionsState(remote.state as Partial<AdmissionsState>);
}

export async function pushAdmissionsRemoteServer(
  state: AdmissionsState,
): Promise<{ ok: boolean; error?: string }> {
  const { fetchServerBlob, pushServerBlob } = await import("@/lib/serverBlob");
  const normalized = normalizeAdmissionsState(state);
  const remote = await fetchServerBlob<AdmissionsState>("admissions_state");
  const remoteLeads = (remote.state as AdmissionsState | null)?.leads?.length ?? 0;
  const nextLeads = normalized.leads?.length ?? 0;
  if (nextLeads < remoteLeads && remote.state) {
    return { ok: true };
  }
  return pushServerBlob("admissions_state", normalized);
}
