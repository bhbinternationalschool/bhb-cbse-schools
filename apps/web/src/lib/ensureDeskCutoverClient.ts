/**
 * Client — run automated desk ensure once per session (backfill + seed).
 */

import { isSupabaseConfigured } from "@/lib/supabase/client";

const META_KEY = "bhb_desk_ensure_meta_v1";
let running: Promise<void> | null = null;

function readMeta(): { lastRunAt: string } {
  if (typeof window === "undefined") return { lastRunAt: "" };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { lastRunAt: "" };
    return JSON.parse(raw) as { lastRunAt: string };
  } catch {
    return { lastRunAt: "" };
  }
}

function writeMeta(lastRunAt: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(META_KEY, JSON.stringify({ lastRunAt }));
}

/** Backfill desk from blobs + seed defaults. Runs once per browser session. */
export async function ensureDeskCutoverClient(): Promise<void> {
  if (!isSupabaseConfigured() || typeof window === "undefined") return;
  const meta = readMeta();
  const sessionKey = sessionStorage.getItem("bhb_desk_ensure_session");
  if (sessionKey === "done" && meta.lastRunAt) return;

  if (running) return running;

  running = (async () => {
    try {
      const res = await fetch("/api/school-data/ensure-desk", {
        method: "POST",
        cache: "no-store",
      });
      if (res.ok) {
        writeMeta(new Date().toISOString());
        sessionStorage.setItem("bhb_desk_ensure_session", "done");
        window.dispatchEvent(new CustomEvent("bhb-desk-ensure-done"));
      }
    } catch (e) {
      console.warn("[desk-ensure] failed", e);
    } finally {
      running = null;
    }
  })();

  return running;
}
