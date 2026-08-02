/**
 * Client → server sync for normalized library desk.
 */

import type { LibraryState } from "@/lib/library";
import { isSupabaseConfigured } from "@/lib/supabase/client";

const META_KEY = "bhb_library_desk_db_meta_v1";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: LibraryState | null = null;

type DeskMeta = { updatedAt: string; titleCount: number };

function readMeta(): DeskMeta {
  if (typeof window === "undefined") return { updatedAt: "", titleCount: 0 };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { updatedAt: "", titleCount: 0 };
    const p = JSON.parse(raw) as DeskMeta;
    return {
      updatedAt: String(p.updatedAt || ""),
      titleCount: Number(p.titleCount) || 0,
    };
  } catch {
    return { updatedAt: "", titleCount: 0 };
  }
}

function writeMeta(patch: Partial<DeskMeta> & { updatedAt: string; titleCount: number }) {
  if (typeof window === "undefined") return;
  localStorage.setItem(META_KEY, JSON.stringify({ ...readMeta(), ...patch }));
}

export function libraryNormalizedSyncEnabled(): boolean {
  return isSupabaseConfigured();
}

export function libraryReadFromDbClientEnabled(): boolean {
  return process.env.NEXT_PUBLIC_LIBRARY_READ_FROM_DB === "true";
}

export function scheduleLibraryDeskSync(state: LibraryState) {
  if (!libraryNormalizedSyncEnabled() || typeof window === "undefined") return;
  pending = state;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const batch = pending;
    pending = null;
    pushTimer = null;
    if (batch) void pushLibraryDeskApi(batch);
  }, 600);
}

async function pushLibraryDeskApi(state: LibraryState) {
  try {
    const res = await fetch("/api/school-data/library-desk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        titles: state.titles,
        copies: state.copies,
        issues: state.issues,
        settings: state.settings,
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      titleCount?: number;
      error?: string;
    } | null;
    if (res.ok && body?.ok) {
      writeMeta({
        updatedAt: body.updatedAt || new Date().toISOString(),
        titleCount: body.titleCount ?? state.titles.length,
      });
    }
  } catch (e) {
    console.warn("[library-db] desk push error", e);
  }
}

export async function fetchLibraryDeskFromApi() {
  if (!libraryNormalizedSyncEnabled()) return null;
  try {
    const res = await fetch("/api/school-data/library-desk", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      titles?: LibraryState["titles"];
      copies?: LibraryState["copies"];
      issues?: LibraryState["issues"];
      settings?: LibraryState["settings"];
      updatedAt?: string;
      titleCount?: number;
    };
    if (!Array.isArray(body.titles)) return null;
    return {
      bundle: {
        titles: body.titles,
        copies: body.copies ?? [],
        issues: body.issues ?? [],
        settings: body.settings ?? {
          maxBooksPerStudent: 2,
          loanDays: 14,
          finePaisePerDay: 500,
        },
      },
      updatedAt: body.updatedAt || "",
      titleCount: body.titleCount ?? body.titles.length,
    };
  } catch {
    return null;
  }
}

export async function hydrateLibraryDeskFromDb(preferDb?: boolean) {
  const remote = await fetchLibraryDeskFromApi();
  const empty = {
    bundle: {
      titles: [] as LibraryState["titles"],
      copies: [] as LibraryState["copies"],
      issues: [] as LibraryState["issues"],
      settings: { maxBooksPerStudent: 2, loanDays: 14, finePaisePerDay: 500 },
    },
    changed: false,
  };
  if (!remote) return empty;

  const meta = readMeta();
  const shouldTake =
    preferDb ||
    libraryReadFromDbClientEnabled() ||
    meta.titleCount === 0 ||
    (remote.updatedAt && remote.updatedAt >= meta.updatedAt) ||
    remote.titleCount > meta.titleCount;

  if (!shouldTake) return empty;

  writeMeta({ updatedAt: remote.updatedAt, titleCount: remote.titleCount });
  return { bundle: remote.bundle, changed: true };
}
