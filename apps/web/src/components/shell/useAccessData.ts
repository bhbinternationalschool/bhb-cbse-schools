"use client";

import { useEffect, useMemo, useState } from "react";
import {
  accessDataStatus,
  type AccessDataStatus,
} from "@/lib/accessDataStatus";
import { deskEverHydrated } from "@/lib/deskHydrateGuard";
import { loadMasters, type MastersState } from "@/lib/masters";
import { loadRbac, type RbacState } from "@/lib/rbac";
import { isSupabaseConfigured } from "@/lib/supabase/client";

export type AccessData = {
  status: AccessDataStatus;
  ready: boolean;
  /** Loaded copies — null until `ready`. Pass these to permission helpers. */
  masters: MastersState | null;
  rbac: RbacState | null;
  /** Changes whenever either copy changes; use as a memo dependency. */
  version: number;
  retry: () => void;
};

/** Events after which a permission answer may have changed. */
const ACCESS_EVENTS = [
  "bhb-desk-first-hydrated",
  "bhb-desk-hydrated",
  "bhb-masters-updated",
  "bhb-rbac-updated",
] as const;

// One load for every component on the page that asks (gate, sidebar,
// bottom nav, the workspace) — not one per component.
let inflight: Promise<void> | null = null;

function loadAccessData(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const [{ ensureRbacHydrated }, { ensureStaffHydrated }, { withHydrationSlot }] =
        await Promise.all([
          import("@/lib/rbacPersistence"),
          import("@/lib/staffPersistence"),
          import("@/lib/deskHydrateGuard"),
        ]);
      await Promise.allSettled([
        deskEverHydrated("rbac") ? null : withHydrationSlot(() => ensureRbacHydrated()),
        deskEverHydrated("staff") ? null : withHydrationSlot(() => ensureStaffHydrated()),
      ]);
    } catch {
      /* status reads the outcome from deskEverHydrated */
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * The roles and roster permission checks need, and whether they are known
 * yet (lib/accessDataStatus). Recomputes when either lands or changes.
 */
export function useAccessData(): AccessData {
  const [mounted, setMounted] = useState(false);
  const [settled, setSettled] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    setMounted(true);
    const bump = () => setVersion((n) => n + 1);
    for (const e of ACCESS_EVENTS) window.addEventListener(e, bump);
    return () => {
      for (const e of ACCESS_EVENTS) window.removeEventListener(e, bump);
    };
  }, []);

  useEffect(() => {
    let live = true;
    setSettled(false);
    void loadAccessData().then(() => {
      if (!live) return;
      setSettled(true);
      setVersion((n) => n + 1);
    });
    return () => {
      live = false;
    };
  }, [attempt]);

  const status = accessDataStatus({
    remote: isSupabaseConfigured(),
    mounted,
    rbacLoaded: mounted && deskEverHydrated("rbac"),
    rosterLoaded: mounted && deskEverHydrated("staff"),
    attemptSettled: settled,
  });
  const ready = status === "ready";

  const copies = useMemo(
    () =>
      ready
        ? { masters: loadMasters(), rbac: loadRbac() }
        : { masters: null, rbac: null },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version is the change signal
    [ready, version],
  );

  return {
    status,
    ready,
    masters: copies.masters,
    rbac: copies.rbac,
    version,
    retry: () => setAttempt((n) => n + 1),
  };
}
