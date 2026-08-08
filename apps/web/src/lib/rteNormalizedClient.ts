/**
 * Client → server sync for normalized RTE desk.
 */

import type { RteState } from "@/lib/rteEws";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { DESK_PUSH_DEBOUNCE_MS } from "@/lib/workspaceSyncPolicy";

const META_KEY = "bhb_rte_desk_db_meta_v1";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: RteState | null = null;

type DeskMeta = {
  updatedAt: string;
  seatCount: number;
  applicationCount: number;
};

function readMeta(): DeskMeta {
  if (typeof window === "undefined") {
    return { updatedAt: "", seatCount: 0, applicationCount: 0 };
  }
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { updatedAt: "", seatCount: 0, applicationCount: 0 };
    const p = JSON.parse(raw) as DeskMeta;
    return {
      updatedAt: String(p.updatedAt || ""),
      seatCount: Number(p.seatCount) || 0,
      applicationCount: Number(p.applicationCount) || 0,
    };
  } catch {
    return { updatedAt: "", seatCount: 0, applicationCount: 0 };
  }
}

function writeMeta(patch: DeskMeta) {
  if (typeof window === "undefined") return;
  localStorage.setItem(META_KEY, JSON.stringify(patch));
}

export function rteReadFromDbClientEnabled(): boolean {
  return process.env.NEXT_PUBLIC_RTE_READ_FROM_DB === "true";
}

export function scheduleRteDeskSync(state: RteState) {
  if (!isSupabaseConfigured()) return;
  if (typeof window === "undefined") return;
  pending = state;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const batch = pending;
    pending = null;
    pushTimer = null;
    if (!batch) return;
    void pushRteDeskApi(batch);
  }, DESK_PUSH_DEBOUNCE_MS);
}

async function pushRteDeskApi(state: RteState) {
  try {
    const res = await fetch("/api/school-data/rte-desk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        seats: state.seats,
        applications: state.applications,
        settings: state.settings,
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      seatCount?: number;
      applicationCount?: number;
      error?: string;
    } | null;
    if (res.ok && body?.ok) {
      writeMeta({
        updatedAt: body.updatedAt || new Date().toISOString(),
        seatCount: body.seatCount ?? state.seats.length,
        applicationCount: body.applicationCount ?? state.applications.length,
      });
    } else if (!res.ok) {
      console.warn("[rte-db] desk push failed", body?.error || res.status);
    }
  } catch (e) {
    console.warn("[rte-db] desk push error", e);
  }
}

export async function hydrateRteDeskFromDb(
  preferDb?: boolean,
): Promise<{
  bundle: Pick<RteState, "seats" | "applications" | "settings">;
  changed: boolean;
  ok: boolean;
}> {
  if (!isSupabaseConfigured()) {
    return {
      bundle: {
        seats: [],
        applications: [],
        settings: { mandatedPct: 25, autoApplyFeeWaiver: true, note: "" },
      },
      changed: false,
      ok: false,
    };
  }
  try {
    const res = await fetch("/api/school-data/rte-desk", {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        bundle: {
          seats: [],
          applications: [],
          settings: { mandatedPct: 25, autoApplyFeeWaiver: true, note: "" },
        },
        changed: false,
        ok: false,
      };
    }
    const body = (await res.json()) as {
      seats?: RteState["seats"];
      applications?: RteState["applications"];
      settings?: RteState["settings"];
      updatedAt?: string;
      seatCount?: number;
      applicationCount?: number;
    };

    const bundle = {
      seats: Array.isArray(body.seats) ? body.seats : [],
      applications: Array.isArray(body.applications) ? body.applications : [],
      settings: body.settings ?? {
        mandatedPct: 25,
        autoApplyFeeWaiver: true,
        note: "",
      },
    };

    const meta = readMeta();
    const remoteRows =
      (body.seatCount ?? bundle.seats.length) +
      (body.applicationCount ?? bundle.applications.length);
    const localRows = meta.seatCount + meta.applicationCount;
    const shouldTake =
      preferDb ||
      rteReadFromDbClientEnabled() ||
      localRows === 0 ||
      (body.updatedAt && body.updatedAt >= meta.updatedAt) ||
      remoteRows > localRows ||
      bundle.seats.length > 0 ||
      bundle.applications.length > 0;

    if (!shouldTake) {
      return {
        bundle: {
          seats: [],
          applications: [],
          settings: { mandatedPct: 25, autoApplyFeeWaiver: true, note: "" },
        },
        changed: false,
        ok: true,
      };
    }

    writeMeta({
      updatedAt: body.updatedAt || new Date().toISOString(),
      seatCount: body.seatCount ?? bundle.seats.length,
      applicationCount: body.applicationCount ?? bundle.applications.length,
    });

    return { bundle, changed: true, ok: true };
  } catch {
    return {
      bundle: {
        seats: [],
        applications: [],
        settings: { mandatedPct: 25, autoApplyFeeWaiver: true, note: "" },
      },
      changed: false,
      ok: false,
    };
  }
}
