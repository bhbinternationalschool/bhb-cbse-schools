"use client";

/**
 * Re-run `onChange` when the server copy of a module_local_state module
 * lands in the browser (login/refresh hydration), so a workspace that read
 * localStorage on mount picks up the persisted data without a reload.
 */

import { useEffect } from "react";
import { MODULE_STATE_UPDATED_EVENT } from "@/lib/moduleStatePersistence";
import type { ModuleStateKey } from "@/lib/moduleStateRegistry";

export function useModuleStateHydration(
  keys: ModuleStateKey | ModuleStateKey[],
  onChange: () => void,
): void {
  useEffect(() => {
    const wanted = new Set(Array.isArray(keys) ? keys : [keys]);
    function onEvent(e: Event) {
      const key = (e as CustomEvent<{ key?: string }>).detail?.key;
      if (key && wanted.has(key as ModuleStateKey)) onChange();
    }
    window.addEventListener(MODULE_STATE_UPDATED_EVENT, onEvent);
    // Kick hydration for these modules now (idempotent per hydrate window).
    void import("@/lib/localModulesPersistence").then((m) => m.ensureModuleStatesHydrated([...wanted]));
    return () => window.removeEventListener(MODULE_STATE_UPDATED_EVENT, onEvent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Array.isArray(keys) ? keys.join(",") : keys]);
}
