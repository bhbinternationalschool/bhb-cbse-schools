/**
 * Client → server sync for normalized homework desk.
 */

import type { HomeworkState } from "@/lib/homework";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { DESK_PUSH_DEBOUNCE_MS } from "@/lib/workspaceSyncPolicy";

const META_KEY = "bhb_homework_desk_db_meta_v1";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: HomeworkState | null = null;

type DeskMeta = {
  updatedAt: string;
  postCount: number;
};

function readMeta(): DeskMeta {
  if (typeof window === "undefined") return { updatedAt: "", postCount: 0 };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { updatedAt: "", postCount: 0 };
    const p = JSON.parse(raw) as DeskMeta;
    return {
      updatedAt: String(p.updatedAt || ""),
      postCount: Number(p.postCount) || 0,
    };
  } catch {
    return { updatedAt: "", postCount: 0 };
  }
}

function writeMeta(patch: Partial<DeskMeta> & { updatedAt: string; postCount: number }) {
  if (typeof window === "undefined") return;
  const prev = readMeta();
  localStorage.setItem(META_KEY, JSON.stringify({ ...prev, ...patch }));
}

export function homeworkNormalizedSyncEnabled(): boolean {
  return isSupabaseConfigured();
}

export function homeworkReadFromDbClientEnabled(): boolean {
  return process.env.NEXT_PUBLIC_HOMEWORK_READ_FROM_DB === "true";
}

export function scheduleHomeworkDeskSync(state: HomeworkState) {
  if (!homeworkNormalizedSyncEnabled()) return;
  if (typeof window === "undefined") return;
  pending = state;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const batch = pending;
    pending = null;
    pushTimer = null;
    if (!batch) return;
    void pushHomeworkDeskApi(batch);
  }, DESK_PUSH_DEBOUNCE_MS);
}

async function pushHomeworkDeskApi(state: HomeworkState) {
  try {
    const res = await fetch("/api/school-data/homework-desk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        posts: state.posts,
        diary: state.diary,
        submissions: state.submissions,
        seen: state.seen,
        settings: state.settings,
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      postCount?: number;
      error?: string;
    } | null;
    if (res.ok && body?.ok) {
      writeMeta({
        updatedAt: body.updatedAt || new Date().toISOString(),
        postCount: body.postCount ?? state.posts.length,
      });
    } else if (!res.ok) {
      console.warn("[homework-db] desk push failed", body?.error || res.status);
    }
  } catch (e) {
    console.warn("[homework-db] desk push error", e);
  }
}

export async function fetchHomeworkDeskFromApi(): Promise<{
  bundle: Pick<
    HomeworkState,
    "posts" | "diary" | "submissions" | "seen" | "settings"
  >;
  updatedAt: string;
  postCount: number;
} | null> {
  if (!homeworkNormalizedSyncEnabled()) return null;
  try {
    const res = await fetch("/api/school-data/homework-desk", {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      posts?: HomeworkState["posts"];
      diary?: HomeworkState["diary"];
      submissions?: HomeworkState["submissions"];
      seen?: HomeworkState["seen"];
      settings?: HomeworkState["settings"];
      updatedAt?: string;
      postCount?: number;
    };
    if (!Array.isArray(body.posts)) return null;
    return {
      bundle: {
        posts: body.posts,
        diary: body.diary ?? [],
        submissions: body.submissions ?? [],
        seen: body.seen ?? [],
        settings: body.settings ?? { examModeFreeze: false },
      },
      updatedAt: body.updatedAt || "",
      postCount: body.postCount ?? body.posts.length,
    };
  } catch {
    return null;
  }
}

type HomeworkDeskBundle = Pick<
  HomeworkState,
  "posts" | "diary" | "submissions" | "seen" | "settings"
>;

export async function hydrateHomeworkDeskFromDb(
  preferDb?: boolean,
): Promise<{ bundle: HomeworkDeskBundle; changed: boolean }> {
  const remote = await fetchHomeworkDeskFromApi();
  const empty: HomeworkDeskBundle = {
    posts: [],
    diary: [],
    submissions: [],
    seen: [],
    settings: { examModeFreeze: false },
  };
  if (!remote) return { bundle: empty, changed: false };

  const meta = readMeta();
  const shouldTake =
    preferDb ||
    homeworkReadFromDbClientEnabled() ||
    meta.postCount === 0 ||
    (remote.updatedAt && remote.updatedAt >= meta.updatedAt) ||
    remote.postCount > meta.postCount;

  if (!shouldTake) return { bundle: empty, changed: false };

  writeMeta({
    updatedAt: remote.updatedAt,
    postCount: remote.postCount,
  });

  return { bundle: remote.bundle, changed: true };
}
