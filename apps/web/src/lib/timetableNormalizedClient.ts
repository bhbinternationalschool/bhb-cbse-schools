/**
 * Client → server sync for normalized timetable desk.
 */

import type { TimetableState } from "@/lib/timetable";
import { isSupabaseConfigured } from "@/lib/supabase/client";

const META_KEY = "bhb_timetable_desk_db_meta_v1";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: TimetableState | null = null;

type DeskMeta = {
  updatedAt: string;
  gridCount: number;
  substitutionCount: number;
};

function readMeta(): DeskMeta {
  if (typeof window === "undefined") {
    return { updatedAt: "", gridCount: 0, substitutionCount: 0 };
  }
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { updatedAt: "", gridCount: 0, substitutionCount: 0 };
    const p = JSON.parse(raw) as DeskMeta;
    return {
      updatedAt: String(p.updatedAt || ""),
      gridCount: Number(p.gridCount) || 0,
      substitutionCount: Number(p.substitutionCount) || 0,
    };
  } catch {
    return { updatedAt: "", gridCount: 0, substitutionCount: 0 };
  }
}

function writeMeta(patch: DeskMeta) {
  if (typeof window === "undefined") return;
  localStorage.setItem(META_KEY, JSON.stringify(patch));
}

export function timetableReadFromDbClientEnabled(): boolean {
  return process.env.NEXT_PUBLIC_TIMETABLE_READ_FROM_DB === "true";
}

export function scheduleTimetableDeskSync(state: TimetableState) {
  if (!isSupabaseConfigured()) return;
  if (typeof window === "undefined") return;
  pending = state;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const batch = pending;
    pending = null;
    pushTimer = null;
    if (!batch) return;
    void pushTimetableDeskApi(batch);
  }, 600);
}

async function pushTimetableDeskApi(state: TimetableState) {
  try {
    const res = await fetch("/api/school-data/timetable-desk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      gridCount?: number;
      substitutionCount?: number;
      error?: string;
    } | null;
    if (res.ok && body?.ok) {
      writeMeta({
        updatedAt: body.updatedAt || new Date().toISOString(),
        gridCount: body.gridCount ?? state.grids.length,
        substitutionCount:
          body.substitutionCount ?? state.substitutions.length,
      });
    } else if (!res.ok) {
      console.warn("[timetable-db] desk push failed", body?.error || res.status);
    }
  } catch (e) {
    console.warn("[timetable-db] desk push error", e);
  }
}

export async function hydrateTimetableDeskFromDb(
  preferDb?: boolean,
): Promise<{
  bundle: Pick<
    TimetableState,
    | "workingWeekdays"
    | "bellTemplate"
    | "grids"
    | "publishedGrids"
    | "substitutions"
    | "meta"
  >;
  changed: boolean;
}> {
  const emptyBundle = {
    workingWeekdays: [] as number[],
    bellTemplate: [] as TimetableState["bellTemplate"],
    grids: [] as TimetableState["grids"],
    publishedGrids: [] as TimetableState["publishedGrids"],
    substitutions: [] as TimetableState["substitutions"],
    meta: {
      status: "draft" as const,
      publishedAt: "",
      publishedBy: "",
      generatedAt: "",
      solverStats: null,
    },
  };

  if (!isSupabaseConfigured()) {
    return { bundle: emptyBundle, changed: false };
  }
  try {
    const res = await fetch("/api/school-data/timetable-desk", {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return { bundle: emptyBundle, changed: false };
    const body = (await res.json()) as Partial<TimetableState> & {
      updatedAt?: string;
      gridCount?: number;
      substitutionCount?: number;
    };

    const bundle = {
      workingWeekdays: Array.isArray(body.workingWeekdays)
        ? body.workingWeekdays
        : [],
      bellTemplate: Array.isArray(body.bellTemplate) ? body.bellTemplate : [],
      grids: Array.isArray(body.grids) ? body.grids : [],
      publishedGrids: Array.isArray(body.publishedGrids)
        ? body.publishedGrids
        : [],
      substitutions: Array.isArray(body.substitutions) ? body.substitutions : [],
      meta: body.meta ?? emptyBundle.meta,
    };

    const meta = readMeta();
    const remoteGrids = body.gridCount ?? bundle.grids.length;
    const shouldTake =
      preferDb ||
      timetableReadFromDbClientEnabled() ||
      meta.gridCount === 0 ||
      (body.updatedAt && body.updatedAt >= meta.updatedAt) ||
      remoteGrids > meta.gridCount ||
      bundle.bellTemplate.length > 0;

    if (!shouldTake) return { bundle: emptyBundle, changed: false };

    writeMeta({
      updatedAt: body.updatedAt || new Date().toISOString(),
      gridCount: remoteGrids,
      substitutionCount:
        body.substitutionCount ?? bundle.substitutions.length,
    });

    return { bundle, changed: true };
  } catch {
    return { bundle: emptyBundle, changed: false };
  }
}
