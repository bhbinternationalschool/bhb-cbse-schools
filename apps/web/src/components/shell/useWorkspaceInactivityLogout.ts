"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  flushAllDeskSyncPending,
  WORKSPACE_INACTIVITY_MS,
} from "@/lib/workspaceClientSession";
import { clearWorkspaceSessionAlignFlag } from "@/lib/workspaceSession";
import {
  ACTIVITY_WRITE_THROTTLE_MS,
  idleRemainingMs,
  readSharedLastActivity,
  writeSharedLastActivity,
} from "@/lib/workspaceIdle";

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
  "click",
] as const;

/**
 * Auto logout after the idle period; clears session and returns to login.
 *
 * Idle means idle in EVERY tab: activity is shared through localStorage
 * (lib/workspaceIdle), so a background tab never signs out the tab in use.
 */
export function useWorkspaceInactivityLogout(enabled = true) {
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loggingOutRef = useRef(false);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    async function logoutIdle() {
      if (loggingOutRef.current) return;
      loggingOutRef.current = true;
      clearWorkspaceSessionAlignFlag();
      await flushAllDeskSyncPending();
      await fetch("/api/auth/demo", { method: "DELETE" });
      try {
        const { createBrowserSupabase, isDemoAuth } = await import(
          "@/lib/supabase/client"
        );
        if (!isDemoAuth()) {
          const sb = createBrowserSupabase();
          await sb?.auth.signOut();
        }
      } catch {
        /* ignore */
      }
      router.push("/login?reason=idle");
      router.refresh();
    }

    const storage = (() => {
      try {
        return window.localStorage;
      } catch {
        return null;
      }
    })();
    let localLastActivity = Date.now();
    let lastSharedWrite = 0;

    function schedule(ms: number) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(checkIdle, ms);
    }

    // The timer only says "this tab has been quiet"; whether the browser is
    // idle is decided against the latest activity of any tab.
    function checkIdle() {
      const remaining = idleRemainingMs({
        now: Date.now(),
        localLastActivity,
        sharedLastActivity: readSharedLastActivity(storage),
        limitMs: WORKSPACE_INACTIVITY_MS,
      });
      if (remaining > 0) schedule(remaining);
      else void logoutIdle();
    }

    function onActivity() {
      const now = Date.now();
      localLastActivity = now;
      if (now - lastSharedWrite >= ACTIVITY_WRITE_THROTTLE_MS) {
        lastSharedWrite = now;
        writeSharedLastActivity(storage, now);
      }
      schedule(WORKSPACE_INACTIVITY_MS);
    }

    // Coming back to a tab is activity only if the browser was not already
    // idle: a laptop woken after two hours must log out, not write a fresh
    // stamp that rescues every other tab (review of the cross-tab change).
    function onVisibility() {
      if (document.visibilityState !== "visible") return;
      const remaining = idleRemainingMs({
        now: Date.now(),
        localLastActivity,
        sharedLastActivity: readSharedLastActivity(storage),
        limitMs: WORKSPACE_INACTIVITY_MS,
      });
      if (remaining === 0) void logoutIdle();
      else onActivity();
    }

    onActivity();
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, onActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, onActivity);
      }
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, router]);
}
