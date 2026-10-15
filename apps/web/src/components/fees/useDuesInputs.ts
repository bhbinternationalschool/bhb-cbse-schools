"use client";

import { useEffect, useState } from "react";
import { FEES_UPDATED_EVENT } from "@/lib/fees";

/**
 * Everything a browser dues figure is computed from, loaded before it is shown.
 *
 * `computeStudentDues` is synchronous and reads the fee book (`loadFees`) and
 * the transport desk (`loadTransport`) from memory. A screen that called it
 * before those desks had arrived got a figure with NO transport in it — no
 * bus month owing and no bus month paid — and nothing told it to recompute
 * when they landed. Found 15 Oct 2026 (PR #665) on the student fee card; the
 * same was true of the student profile modal, the counter's adjustments
 * panel and the parent web portal.
 *
 * `ready` is false until the fee book and the transport desk have been asked
 * for (a failed load still ends the wait — the screen then shows what it has,
 * as before, rather than spin for ever). `tick` changes whenever either desk
 * changes afterwards, so a `useMemo` that lists it recomputes.
 */
export function useDuesInputs(): { ready: boolean; tick: number } {
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [{ ensureFeesHydrated }, { hydrateFeesStore }, { ensureTransportHydrated }, { withHydrationSlot }] =
        await Promise.all([
          import("@/lib/feesPersistence"),
          import("@/lib/fees"),
          import("@/lib/transportPersistence"),
          import("@/lib/deskHydrateGuard"),
        ]);
      await Promise.allSettled([
        withHydrationSlot(() => ensureFeesHydrated()),
        withHydrationSlot(() => ensureTransportHydrated()),
      ]);
      try {
        await hydrateFeesStore();
      } catch {
        // The cached book stands.
      }
      if (!alive) return;
      setReady(true);
      setTick((t) => t + 1);
    })();
    const bump = () => setTick((t) => t + 1);
    window.addEventListener(FEES_UPDATED_EVENT, bump);
    window.addEventListener("bhb-desk-hydrated", bump);
    return () => {
      alive = false;
      window.removeEventListener(FEES_UPDATED_EVENT, bump);
      window.removeEventListener("bhb-desk-hydrated", bump);
    };
  }, []);

  return { ready, tick };
}
