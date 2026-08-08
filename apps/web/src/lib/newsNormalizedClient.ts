/**
 * Client → server sync for standalone news desk.
 */

import { loadSchoolComms } from "@/lib/schoolComms";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { DESK_PUSH_DEBOUNCE_MS } from "@/lib/workspaceSyncPolicy";

const META_KEY = "bhb_news_desk_db_meta_v1";
let pushTimer: ReturnType<typeof setTimeout> | null = null;

type DeskMeta = { updatedAt: string; newsCount: number };

function readMeta(): DeskMeta {
  if (typeof window === "undefined") return { updatedAt: "", newsCount: 0 };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { updatedAt: "", newsCount: 0 };
    const p = JSON.parse(raw) as DeskMeta;
    return {
      updatedAt: String(p.updatedAt || ""),
      newsCount: Number(p.newsCount) || 0,
    };
  } catch {
    return { updatedAt: "", newsCount: 0 };
  }
}

function writeMeta(patch: DeskMeta) {
  if (typeof window === "undefined") return;
  localStorage.setItem(META_KEY, JSON.stringify(patch));
}

export function scheduleNewsDeskSync() {
  if (!isSupabaseConfigured() || typeof window === "undefined") return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    const state = loadSchoolComms();
    void pushNewsDeskApi({ news: state.news });
  }, DESK_PUSH_DEBOUNCE_MS);
}

async function pushNewsDeskApi(bundle: {
  news: ReturnType<typeof loadSchoolComms>["news"];
}) {
  try {
    const res = await fetch("/api/school-data/news-desk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bundle),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      newsCount?: number;
    } | null;
    if (res.ok && body?.ok) {
      writeMeta({
        updatedAt: body.updatedAt || new Date().toISOString(),
        newsCount: body.newsCount ?? bundle.news.length,
      });
    }
  } catch (e) {
    console.warn("[news-db] desk push error", e);
  }
}

export async function hydrateNewsDeskFromDb(
  preferDb?: boolean,
): Promise<{
  bundle: { news: ReturnType<typeof loadSchoolComms>["news"] };
  changed: boolean;
  /** false = fetch failed/unauthenticated; caller must not treat bundle as confirmed-empty. */
  ok: boolean;
}> {
  const empty = { news: [] };
  if (!isSupabaseConfigured()) return { bundle: empty, changed: false, ok: false };
  try {
    const res = await fetch("/api/school-data/news-desk", {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return { bundle: empty, changed: false, ok: false };
    const body = (await res.json()) as {
      news?: ReturnType<typeof loadSchoolComms>["news"];
      updatedAt?: string;
      newsCount?: number;
    };
    const bundle = { news: Array.isArray(body.news) ? body.news : [] };
    const meta = readMeta();
    const remoteNews = body.newsCount ?? bundle.news.length;
    const shouldTake =
      preferDb ||
      process.env.NEXT_PUBLIC_NEWS_READ_FROM_DB === "true" ||
      meta.newsCount === 0 ||
      (body.updatedAt && body.updatedAt >= meta.updatedAt) ||
      remoteNews > meta.newsCount ||
      bundle.news.length > 0;
    if (!shouldTake) return { bundle: empty, changed: false, ok: true };
    writeMeta({
      updatedAt: body.updatedAt || new Date().toISOString(),
      newsCount: remoteNews,
    });
    return { bundle, changed: true, ok: true };
  } catch {
    return { bundle: empty, changed: false, ok: false };
  }
}
