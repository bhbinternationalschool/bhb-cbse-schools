"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  flushAllDeskSyncPending,
  WORKSPACE_INACTIVITY_MS,
} from "@/lib/workspaceClientSession";
import { clearWorkspaceSessionAlignFlag } from "@/lib/workspaceSession";

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
  "click",
] as const;

/** Auto logout after idle period; clears session and returns to login. */
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

    function resetTimer() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void logoutIdle();
      }, WORKSPACE_INACTIVITY_MS);
    }

    resetTimer();
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, resetTimer, { passive: true });
    }
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") resetTimer();
    });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, resetTimer);
      }
    };
  }, [enabled, router]);
}
