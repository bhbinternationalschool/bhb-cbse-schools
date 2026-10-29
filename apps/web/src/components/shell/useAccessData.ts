"use client";

import { useEffect, useMemo, useState } from "react";
import type { AccessDataStatus } from "@/lib/accessDataStatus";
import { loadMasters, type MastersState } from "@/lib/masters";
import { loadRbac, type RbacState } from "@/lib/rbac";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { useRbac, useStaffList } from "@/lib/data/client/hooks";
import { accessMastersOf, accessRbacOf, accessStatusOf } from "@/lib/data/client/accessCopy";

export type AccessData = {
  status: AccessDataStatus;
  ready: boolean;
  /**
   * Loaded copies — null until `ready`. Pass these to permission helpers.
   * `masters` is the roster side only (staff, departments, designations, on
   * the empty Masters shell): classes, sections and fee lists are not in it —
   * read them from useMasters() (useScreenMasters / useStableAccessCopy).
   */
  masters: MastersState | null;
  rbac: RbacState | null;
  /** Changes whenever either copy changes; use as a memo dependency. */
  version: number;
  retry: () => void;
};

/**
 * The roles and roster permission checks need, and whether they are known
 * yet (data-layer 2.3a): useRbac() + useStaffList(), the two reference
 * views, instead of the tab's page copies and their hydrate events.
 *
 *   - `ready` only once BOTH have answered (lib/data/client/accessCopy
 *     accessStatusOf). A read that failed without an answer is `failed` —
 *     the screen says it could not check and offers Try again — never
 *     "ready with an empty roster", so never a "no" decided on nobody.
 *   - React Query shares the two reads between every component that asks
 *     (gate, sidebar, bottom nav, the workspace) and keeps them fresh: the
 *     versions poll refetches them when sis_staff / departments /
 *     designations or rbac move, and a kernel staff write invalidates them.
 *   - Without a database (offline dev build) this browser is the truth: the
 *     page copies, as before.
 */
export function useAccessData(opts: { enabled?: boolean } = {}): AccessData {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const remote = isSupabaseConfigured();
  // `enabled: false` asks nothing (an answer another screen cached is still
  // used) — a control not yet opened (useScreenMasters' own `enabled`).
  const ask = remote && opts.enabled !== false;
  const rbacQ = useRbac({ enabled: ask });
  const staffQ = useStaffList({ enabled: ask });

  const status = accessStatusOf({
    remote,
    mounted,
    rbac: { hasData: rbacQ.data !== undefined, isError: rbacQ.isError },
    staff: { hasData: staffQ.data !== undefined, isError: staffQ.isError },
  });
  const ready = status === "ready";

  const masters = useMemo(() => {
    if (!ready) return null;
    if (!remote) return loadMasters();
    return staffQ.data ? accessMastersOf(staffQ.data) : null;
  }, [ready, remote, staffQ.data]);
  const rbac = useMemo(() => {
    if (!ready) return null;
    if (!remote) return loadRbac();
    return rbacQ.data ? accessRbacOf(rbacQ.data) : null;
  }, [ready, remote, rbacQ.data]);

  return {
    status,
    ready,
    masters,
    rbac,
    // Moves with every answer of either read (React Query keeps the same
    // `data` object when an answer's content did not change).
    version: rbacQ.dataUpdatedAt + staffQ.dataUpdatedAt + (ready ? 1 : 0),
    retry: () => {
      void rbacQ.refetch();
      void staffQ.refetch();
    },
  };
}
