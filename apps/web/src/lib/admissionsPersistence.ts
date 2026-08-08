/**
 * Admissions CRM remote sync — jsonb blob on admissions_state + normalized admission_desk_*.
 */

import {
  admissionsStateIsEmpty,
  defaultAdmissionsState,
  loadAdmissions,
  normalizeAdmissionsState,
  writeAdmissionsLocalRaw,
  type AdmissionsState,
} from "@/lib/admissions";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import {
  hydrateAdmissionsDeskFromDb,
  scheduleAdmissionsDeskSync,
} from "@/lib/admissionsNormalizedClient";
import { mergeDbDeskIntoAdmissionsState } from "@/lib/admissionsNormalizedMerge";
import { admissionsReadFromDbEnabled } from "@/lib/admissionsDbConfig";
import {
  deskSkipBlobHydrateClient,
  deskSkipBlobPush,
  deskSkipBlobPushClient,
} from "@/lib/deskCutover";
import {
  isDeskHydrated,
  markDeskHydrated,
  resetDeskHydrated,
} from "@/lib/deskHydrateGuard";
import { DESK_PUSH_DEBOUNCE_MS } from "@/lib/workspaceSyncPolicy";

const MODULE = "admissions";

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPush: AdmissionsState | null = null;

const META_KEY = "bhb_admissions_v1_remote_meta";

export function admissionsRemoteEnabled() {
  return isSupabaseConfigured();
}

export function resetAdmissionsPersistenceCache() {
  resetDeskHydrated(MODULE);
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

async function fetchRemoteBlob(): Promise<{
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

async function pushBlobState(
  state: AdmissionsState,
): Promise<{ ok: boolean; error?: string }> {
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
    console.warn("[admissions] blob push failed", message);
    return { ok: false, error: message };
  }
  writeMetaUpdatedAt(new Date().toISOString());
  return { ok: true };
}

export function scheduleAdmissionsSync(state: AdmissionsState) {
  if (!admissionsRemoteEnabled()) return;
  const normalized = normalizeAdmissionsState(state);

  if (typeof window === "undefined") {
    void pushAdmissionsRemoteServer(normalized);
    return;
  }

  pendingPush = normalized;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const payload = pendingPush;
    pendingPush = null;
    pushTimer = null;
    if (!payload) return;
    if (!deskSkipBlobPushClient("admissions")) {
      void pushBlobState(payload);
    }
    scheduleAdmissionsDeskSync(payload);
  }, DESK_PUSH_DEBOUNCE_MS);
}

/** Pull blob + normalized desk; remote wins when newer or local empty. */
export async function ensureAdmissionsHydrated(): Promise<boolean> {
  if (!admissionsRemoteEnabled()) return false;
  if (isDeskHydrated(MODULE)) return false;

  let changed = false;
  const skipBlob = deskSkipBlobHydrateClient("admissions");

  if (!skipBlob) {
    const remote = await fetchRemoteBlob();
    const local = loadAdmissions();
    const localAt = readMetaUpdatedAt();

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
  }

  const { state: deskState, changed: deskChanged, ok } =
    await hydrateAdmissionsDeskFromDb(admissionsReadFromDbEnabled());
  if (!ok) {
    if (typeof window !== "undefined") {
      const { reportLoadFailure } = await import("@/components/shell/Toast");
      reportLoadFailure("admissions data");
    }
    return false;
  }

  markDeskHydrated(MODULE);
  const readFromDb = admissionsReadFromDbEnabled();
  if (readFromDb && deskState && admissionsStateIsEmpty(deskState)) {
    const local = loadAdmissions();
    if (!admissionsStateIsEmpty(local)) {
      const empty = defaultAdmissionsState();
      writeAdmissionsLocalRaw(empty);
      changed = true;
    }
  } else if (deskChanged && deskState) {
    const merged = mergeDbDeskIntoAdmissionsState(loadAdmissions(), deskState, {
      preferDb: readFromDb,
    });
    writeAdmissionsLocalRaw(merged);
    changed = true;
  }

  const next = loadAdmissions();
  if (!readFromDb && !admissionsStateIsEmpty(next)) {
    scheduleAdmissionsSync(next);
  } else if (!skipBlob) {
    const remote = await fetchRemoteBlob();
    if (remote.state && !admissionsStateIsEmpty(remote.state)) {
      writeAdmissionsLocalRaw(remote.state);
      changed = true;
    }
  }

  if (changed && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("bhb-admissions-hydrated"));
  }

  return changed;
}

/** Service-role pull for WhatsApp / server mirror (blob fallback). */
export async function fetchAdmissionsRemoteServer(): Promise<AdmissionsState | null> {
  const { admissionsReadFromDbEnabled } = await import("@/lib/admissionsDbConfig");
  const { fetchAdmissionDeskFromDb } = await import(
    "@/lib/admissionsNormalized.server"
  );

  if (admissionsReadFromDbEnabled()) {
    const desk = await fetchAdmissionDeskFromDb();
    if (!admissionsStateIsEmpty(desk.state)) {
      return desk.state;
    }
  }

  const { fetchServerBlob } = await import("@/lib/serverBlob");
  const remote = await fetchServerBlob<AdmissionsState>("admissions_state");
  if (!remote.state) return null;
  return normalizeAdmissionsState(remote.state as Partial<AdmissionsState>);
}

export async function pushAdmissionsRemoteServer(
  state: AdmissionsState,
): Promise<{ ok: boolean; error?: string }> {
  const normalized = normalizeAdmissionsState(state);
  const skipBlob = deskSkipBlobPush("admissions");

  const { pushAdmissionDeskToDb } = await import(
    "@/lib/admissionsNormalized.server"
  );
  const desk = await pushAdmissionDeskToDb(normalized);
  if (!desk.ok) return desk;

  if (skipBlob) return { ok: true };

  const { fetchServerBlob, pushServerBlob } = await import("@/lib/serverBlob");
  const remote = await fetchServerBlob<AdmissionsState>("admissions_state");
  const remoteLeads = (remote.state as AdmissionsState | null)?.leads?.length ?? 0;
  const nextLeads = normalized.leads?.length ?? 0;
  if (nextLeads < remoteLeads && remote.state) {
    return { ok: true };
  }

  return pushServerBlob("admissions_state", normalized);
}

/** Server-side hydrate from blob + normalized DB into admissions cache. */
export async function ensureAdmissionsHydratedServer(): Promise<boolean> {
  if (typeof window !== "undefined") return false;

  const { fetchServerBlob } = await import("@/lib/serverBlob");
  const { fetchAdmissionDeskFromDb } = await import(
    "@/lib/admissionsNormalized.server"
  );
  const { admissionsReadFromDbEnabled } = await import("@/lib/admissionsDbConfig");
  const { setMirrorSlice } = await import("@/lib/schoolDataMirror");

  let state = loadAdmissions();
  let changed = false;

  if (!deskSkipBlobPush("admissions")) {
    const remoteBlob = await fetchServerBlob<AdmissionsState>("admissions_state");
    if (remoteBlob.state && !admissionsStateIsEmpty(remoteBlob.state)) {
      state = normalizeAdmissionsState(remoteBlob.state);
      changed = true;
    }
  }

  const dbDesk = await fetchAdmissionDeskFromDb();
  if (!admissionsStateIsEmpty(dbDesk.state)) {
    state = mergeDbDeskIntoAdmissionsState(state, dbDesk.state, {
      preferDb:
        admissionsReadFromDbEnabled() || admissionsStateIsEmpty(state),
    });
    changed = true;
  }

  if (changed) {
    writeAdmissionsLocalRaw(state);
    setMirrorSlice("admissions", state);
  }

  return changed;
}
