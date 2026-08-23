/**
 * Client → server sync for normalized school comms desk.
 */

import type { SchoolCommsState } from "@/lib/schoolComms";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { DESK_PUSH_DEBOUNCE_MS } from "@/lib/workspaceSyncPolicy";
import {
  recordDeskSyncFailure,
  recordDeskSyncSuccess,
} from "@/lib/deskSyncStatus";

const META_KEY = "bhb_school_comms_desk_db_meta_v1";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: SchoolCommsState | null = null;

type DeskMeta = { updatedAt: string; noticeCount: number };

function readMeta(): DeskMeta {
  if (typeof window === "undefined") return { updatedAt: "", noticeCount: 0 };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { updatedAt: "", noticeCount: 0 };
    const p = JSON.parse(raw) as DeskMeta;
    return {
      updatedAt: String(p.updatedAt || ""),
      noticeCount: Number(p.noticeCount) || 0,
    };
  } catch {
    return { updatedAt: "", noticeCount: 0 };
  }
}

function writeMeta(
  patch: Partial<DeskMeta> & { updatedAt: string; noticeCount: number },
) {
  if (typeof window === "undefined") return;
  localStorage.setItem(META_KEY, JSON.stringify({ ...readMeta(), ...patch }));
}

export function schoolCommsNormalizedSyncEnabled(): boolean {
  return isSupabaseConfigured();
}

export function schoolCommsReadFromDbClientEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SCHOOL_COMMS_READ_FROM_DB === "true";
}

export function scheduleSchoolCommsDeskSync(state: SchoolCommsState) {
  if (!schoolCommsNormalizedSyncEnabled() || typeof window === "undefined") return;
  pending = state;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const batch = pending;
    pending = null;
    pushTimer = null;
    if (batch) void pushSchoolCommsDeskApi(batch);
  }, DESK_PUSH_DEBOUNCE_MS);
}

async function pushSchoolCommsDeskApi(state: SchoolCommsState) {
  try {
    const res = await fetch("/api/school-data/school-comms-desk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notices: state.notices,
        news: state.news,
        albums: state.albums,
        photos: state.photos,
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      noticeCount?: number;
      error?: string;
    } | null;
    if (res.ok && body?.ok) {
      writeMeta({
        updatedAt: body.updatedAt || new Date().toISOString(),
        noticeCount: body.noticeCount ?? state.notices.length,
      });
    }
    // Record whether this actually landed. A not-ok response is not
    // thrown, so without this it slips past every branch in silence.
    if (res.ok && body?.ok) recordDeskSyncSuccess("school_comms");
    else recordDeskSyncFailure("school_comms", { status: res.status, error: body?.error });
  } catch (e) {
    recordDeskSyncFailure("school_comms", { status: 0, error: e instanceof Error ? e.message : String(e) });
    console.warn("[school-comms-db] desk push error", e);
  }
}

export async function fetchSchoolCommsDeskFromApi() {
  if (!schoolCommsNormalizedSyncEnabled()) return null;
  try {
    const res = await fetch("/api/school-data/school-comms-desk", {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as SchoolCommsState & {
      ok?: boolean;
      updatedAt?: string;
      noticeCount?: number;
    };
    if (!Array.isArray(body.notices)) return null;
    return {
      bundle: {
        notices: body.notices,
        news: body.news ?? [],
        albums: body.albums ?? [],
        photos: body.photos ?? [],
      },
      updatedAt: body.updatedAt || "",
      noticeCount: body.noticeCount ?? body.notices.length,
    };
  } catch {
    return null;
  }
}

export async function hydrateSchoolCommsDeskFromDb(preferDb?: boolean) {
  const remote = await fetchSchoolCommsDeskFromApi();
  const empty = {
    bundle: {
      notices: [] as SchoolCommsState["notices"],
      news: [] as SchoolCommsState["news"],
      albums: [] as SchoolCommsState["albums"],
      photos: [] as SchoolCommsState["photos"],
    },
    changed: false,
    ok: false,
  };
  if (!remote) return empty;

  const meta = readMeta();
  const shouldTake =
    preferDb ||
    schoolCommsReadFromDbClientEnabled() ||
    meta.noticeCount === 0 ||
    (remote.updatedAt && remote.updatedAt >= meta.updatedAt) ||
    remote.noticeCount > meta.noticeCount;

  if (!shouldTake) return { ...empty, bundle: remote.bundle, ok: true };

  writeMeta({ updatedAt: remote.updatedAt, noticeCount: remote.noticeCount });
  return { bundle: remote.bundle, changed: true, ok: true };
}
