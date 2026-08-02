/**
 * Client → server sync for normalized notifications desk.
 */

import type { NotificationsState } from "@/lib/notifications";
import { isSupabaseConfigured } from "@/lib/supabase/client";

const META_KEY = "bhb_notifications_desk_db_meta_v1";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: NotificationsState | null = null;

type DeskMeta = {
  updatedAt: string;
  itemCount: number;
};

function readMeta(): DeskMeta {
  if (typeof window === "undefined") return { updatedAt: "", itemCount: 0 };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { updatedAt: "", itemCount: 0 };
    const p = JSON.parse(raw) as DeskMeta;
    return {
      updatedAt: String(p.updatedAt || ""),
      itemCount: Number(p.itemCount) || 0,
    };
  } catch {
    return { updatedAt: "", itemCount: 0 };
  }
}

function writeMeta(patch: DeskMeta) {
  if (typeof window === "undefined") return;
  localStorage.setItem(META_KEY, JSON.stringify(patch));
}

export function notificationsReadFromDbClientEnabled(): boolean {
  return process.env.NEXT_PUBLIC_NOTIFICATIONS_READ_FROM_DB === "true";
}

export function scheduleNotificationsDeskSync(state: NotificationsState) {
  if (!isSupabaseConfigured()) return;
  if (typeof window === "undefined") return;
  pending = state;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const batch = pending;
    pending = null;
    pushTimer = null;
    if (!batch) return;
    void pushNotificationsDeskApi(batch);
  }, 600);
}

async function pushNotificationsDeskApi(state: NotificationsState) {
  try {
    const res = await fetch("/api/school-data/notifications-desk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: state.items }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      itemCount?: number;
      error?: string;
    } | null;
    if (res.ok && body?.ok) {
      writeMeta({
        updatedAt: body.updatedAt || new Date().toISOString(),
        itemCount: body.itemCount ?? state.items.length,
      });
    } else if (!res.ok) {
      console.warn("[notifications-db] desk push failed", body?.error || res.status);
    }
  } catch (e) {
    console.warn("[notifications-db] desk push error", e);
  }
}

export async function hydrateNotificationsDeskFromDb(
  preferDb?: boolean,
): Promise<{
  bundle: { items: NotificationsState["items"] };
  changed: boolean;
}> {
  if (!isSupabaseConfigured()) {
    return { bundle: { items: [] }, changed: false };
  }
  try {
    const res = await fetch("/api/school-data/notifications-desk", {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return { bundle: { items: [] }, changed: false };
    const body = (await res.json()) as {
      items?: NotificationsState["items"];
      updatedAt?: string;
      itemCount?: number;
    };
    if (!Array.isArray(body.items)) {
      return { bundle: { items: [] }, changed: false };
    }

    const meta = readMeta();
    const remoteCount = body.itemCount ?? body.items.length;
    const shouldTake =
      preferDb ||
      notificationsReadFromDbClientEnabled() ||
      meta.itemCount === 0 ||
      (body.updatedAt && body.updatedAt >= meta.updatedAt) ||
      remoteCount > meta.itemCount;

    if (!shouldTake) return { bundle: { items: [] }, changed: false };

    writeMeta({
      updatedAt: body.updatedAt || new Date().toISOString(),
      itemCount: remoteCount,
    });

    return { bundle: { items: body.items }, changed: true };
  } catch {
    return { bundle: { items: [] }, changed: false };
  }
}
