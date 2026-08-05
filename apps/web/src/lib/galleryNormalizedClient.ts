/**
 * Client → server sync for standalone gallery desk.
 */

import { loadSchoolComms } from "@/lib/schoolComms";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { DESK_PUSH_DEBOUNCE_MS } from "@/lib/workspaceSyncPolicy";

const META_KEY = "bhb_gallery_desk_db_meta_v1";
let pushTimer: ReturnType<typeof setTimeout> | null = null;

type DeskMeta = { updatedAt: string; albumCount: number };

function readMeta(): DeskMeta {
  if (typeof window === "undefined") return { updatedAt: "", albumCount: 0 };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { updatedAt: "", albumCount: 0 };
    const p = JSON.parse(raw) as DeskMeta;
    return {
      updatedAt: String(p.updatedAt || ""),
      albumCount: Number(p.albumCount) || 0,
    };
  } catch {
    return { updatedAt: "", albumCount: 0 };
  }
}

function writeMeta(patch: DeskMeta) {
  if (typeof window === "undefined") return;
  localStorage.setItem(META_KEY, JSON.stringify(patch));
}

export function scheduleGalleryDeskSync() {
  if (!isSupabaseConfigured() || typeof window === "undefined") return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    const state = loadSchoolComms();
    void pushGalleryDeskApi({
      albums: state.albums,
      photos: state.photos,
    });
  }, DESK_PUSH_DEBOUNCE_MS);
}

async function pushGalleryDeskApi(bundle: {
  albums: ReturnType<typeof loadSchoolComms>["albums"];
  photos: ReturnType<typeof loadSchoolComms>["photos"];
}) {
  try {
    const res = await fetch("/api/school-data/gallery-desk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bundle),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      albumCount?: number;
    } | null;
    if (res.ok && body?.ok) {
      writeMeta({
        updatedAt: body.updatedAt || new Date().toISOString(),
        albumCount: body.albumCount ?? bundle.albums.length,
      });
    }
  } catch (e) {
    console.warn("[gallery-db] desk push error", e);
  }
}

export async function hydrateGalleryDeskFromDb(
  preferDb?: boolean,
): Promise<{
  bundle: { albums: ReturnType<typeof loadSchoolComms>["albums"]; photos: ReturnType<typeof loadSchoolComms>["photos"] };
  changed: boolean;
}> {
  const empty = { albums: [], photos: [] };
  if (!isSupabaseConfigured()) return { bundle: empty, changed: false };
  try {
    const res = await fetch("/api/school-data/gallery-desk", {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return { bundle: empty, changed: false };
    const body = (await res.json()) as {
      albums?: ReturnType<typeof loadSchoolComms>["albums"];
      photos?: ReturnType<typeof loadSchoolComms>["photos"];
      updatedAt?: string;
      albumCount?: number;
    };
    const bundle = {
      albums: Array.isArray(body.albums) ? body.albums : [],
      photos: Array.isArray(body.photos) ? body.photos : [],
    };
    const meta = readMeta();
    const remoteAlbums = body.albumCount ?? bundle.albums.length;
    const shouldTake =
      preferDb ||
      process.env.NEXT_PUBLIC_GALLERY_READ_FROM_DB === "true" ||
      meta.albumCount === 0 ||
      (body.updatedAt && body.updatedAt >= meta.updatedAt) ||
      remoteAlbums > meta.albumCount ||
      bundle.albums.length > 0;
    if (!shouldTake) return { bundle: empty, changed: false };
    writeMeta({
      updatedAt: body.updatedAt || new Date().toISOString(),
      albumCount: remoteAlbums,
    });
    return { bundle, changed: true };
  } catch {
    return { bundle: empty, changed: false };
  }
}
