"use client";

import { useEffect, useState } from "react";

/**
 * Initialise a module tab from `?tab=` once on mount (Fees pattern).
 */
export function useModuleTabQuery<T extends string>(
  defaultTab: T,
  allowed: readonly T[],
): [T, (tab: T) => void] {
  const [tab, setTab] = useState<T>(defaultTab);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = new URLSearchParams(window.location.search).get("tab");
    if (raw && (allowed as readonly string[]).includes(raw)) {
      setTab(raw as T);
    }
    // Mount-only (URL deep-link), matching Fees Take pattern
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [tab, setTab];
}
