/**
 * Client → server sync for normalized PTM desk.
 */

import type { PtmState } from "@/lib/ptm";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { DESK_PUSH_DEBOUNCE_MS } from "@/lib/workspaceSyncPolicy";
import {
  recordDeskSyncFailure,
  recordDeskSyncSuccess,
} from "@/lib/deskSyncStatus";

const META_KEY = "bhb_ptm_desk_db_meta_v1";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: PtmState | null = null;

type DeskMeta = {
  updatedAt: string;
  eventCount: number;
};

function readMeta(): DeskMeta {
  if (typeof window === "undefined") return { updatedAt: "", eventCount: 0 };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { updatedAt: "", eventCount: 0 };
    const p = JSON.parse(raw) as DeskMeta;
    return {
      updatedAt: String(p.updatedAt || ""),
      eventCount: Number(p.eventCount) || 0,
    };
  } catch {
    return { updatedAt: "", eventCount: 0 };
  }
}

function writeMeta(patch: Partial<DeskMeta> & { updatedAt: string; eventCount: number }) {
  if (typeof window === "undefined") return;
  const prev = readMeta();
  localStorage.setItem(META_KEY, JSON.stringify({ ...prev, ...patch }));
}

export function ptmNormalizedSyncEnabled(): boolean {
  return isSupabaseConfigured();
}

export function ptmReadFromDbClientEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PTM_READ_FROM_DB === "true";
}

export function schedulePtmDeskSync(state: PtmState) {
  if (!ptmNormalizedSyncEnabled()) return;
  if (typeof window === "undefined") return;
  pending = state;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const batch = pending;
    pending = null;
    pushTimer = null;
    if (!batch) return;
    void pushPtmDeskApi(batch);
  }, DESK_PUSH_DEBOUNCE_MS);
}

async function pushPtmDeskApi(state: PtmState) {
  try {
    const res = await fetch("/api/school-data/ptm-desk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        events: state.events,
        slots: state.slots,
        bookings: state.bookings,
        feedback: state.feedback,
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      eventCount?: number;
      error?: string;
    } | null;
    if (res.ok && body?.ok) {
      writeMeta({
        updatedAt: body.updatedAt || new Date().toISOString(),
        eventCount: body.eventCount ?? state.events.length,
      });
    } else if (!res.ok) {
      console.warn("[ptm-db] desk push failed", body?.error || res.status);
    }
    // Record whether this actually landed. A not-ok response is not
    // thrown, so without this it slips past every branch in silence.
    if (res.ok && body?.ok) recordDeskSyncSuccess("ptm");
    else recordDeskSyncFailure("ptm", { status: res.status, error: body?.error });
  } catch (e) {
    recordDeskSyncFailure("ptm", { status: 0, error: e instanceof Error ? e.message : String(e) });
    console.warn("[ptm-db] desk push error", e);
  }
}

export async function fetchPtmDeskFromApi(): Promise<{
  bundle: Pick<PtmState, "events" | "slots" | "bookings" | "feedback">;
  updatedAt: string;
  eventCount: number;
} | null> {
  if (!ptmNormalizedSyncEnabled()) return null;
  try {
    const res = await fetch("/api/school-data/ptm-desk", {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      events?: PtmState["events"];
      slots?: PtmState["slots"];
      bookings?: PtmState["bookings"];
      feedback?: PtmState["feedback"];
      updatedAt?: string;
      eventCount?: number;
    };
    if (!Array.isArray(body.events)) return null;
    return {
      bundle: {
        events: body.events,
        slots: body.slots ?? [],
        bookings: body.bookings ?? [],
        feedback: body.feedback ?? [],
      },
      updatedAt: body.updatedAt || "",
      eventCount: body.eventCount ?? body.events.length,
    };
  } catch {
    return null;
  }
}

type PtmDeskBundle = Pick<PtmState, "events" | "slots" | "bookings" | "feedback">;

export async function hydratePtmDeskFromDb(
  preferDb?: boolean,
): Promise<{ bundle: PtmDeskBundle; changed: boolean; ok: boolean }> {
  const remote = await fetchPtmDeskFromApi();
  const empty: PtmDeskBundle = {
    events: [],
    slots: [],
    bookings: [],
    feedback: [],
  };
  if (!remote) return { bundle: empty, changed: false, ok: false };

  const meta = readMeta();
  const shouldTake =
    preferDb ||
    ptmReadFromDbClientEnabled() ||
    meta.eventCount === 0 ||
    (remote.updatedAt && remote.updatedAt >= meta.updatedAt) ||
    remote.eventCount > meta.eventCount;

  if (!shouldTake) return { bundle: empty, changed: false, ok: true };

  writeMeta({
    updatedAt: remote.updatedAt,
    eventCount: remote.eventCount,
  });

  return { bundle: remote.bundle, changed: true, ok: true };
}
