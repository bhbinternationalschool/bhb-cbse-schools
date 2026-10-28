"use client";

import { useEffect, useState } from "react";
import { hasDeskLoaded } from "@/lib/deskHydrateGuard";

/**
 * A number that moves once the SIS roster (a core desk) has landed on this
 * page — for screens that read loadSis() into state and must read it again
 * then (data-layer 2.3a). Until 2.3a the roster's landing raised
 * 'bhb-masters-updated' (the students projection) and the deleted
 * CoreDataGate held every screen back long enough that most mounted after
 * it; neither is true any more. Shares the one in-flight read (no request of
 * its own once the roster is loading). 0 = not landed yet on this mount.
 */
export function useSisRosterLanded(): number {
  const [landed, setLanded] = useState(() => (typeof window !== "undefined" && hasDeskLoaded("sis") ? 1 : 0));
  useEffect(() => {
    if (landed) return;
    let live = true;
    void (async () => {
      try {
        const [{ ensureSisHydrated }, { withHydrationSlot }] = await Promise.all([
          import("@/lib/sisPersistence"),
          import("@/lib/deskHydrateGuard"),
        ]);
        await withHydrationSlot(() => ensureSisHydrated());
      } catch {
        /* the screen keeps what it read; its own reads decide */
      }
      if (live) setLanded(1);
    })();
    return () => {
      live = false;
    };
  }, [landed]);
  return landed;
}
