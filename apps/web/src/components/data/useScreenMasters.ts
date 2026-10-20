"use client";

import { useMemo, useRef } from "react";
import type { MastersState } from "@/lib/masters";
import { useMasters } from "@/lib/data/client/hooks";
import { screenMastersOf } from "@/lib/data/client/mastersBridge";
import { useAccessData } from "@/components/shell/useAccessData";

export type ScreenMasters = {
  /**
   * The server's Masters book (useMasters — kept fresh by the versions poll)
   * with the staff side from the access copy (screenMastersOf). Null while
   * either is loading, and when the masters read failed (`error`).
   */
  masters: MastersState | null;
  /** "teaching": fee lists etc. are withheld, not empty (lib/mastersTeachingSubset). */
  scope: "full" | "teaching" | null;
  /** The masters read failed — render <QueryError what=… error={error} retry={retry} />. */
  error: Error | null;
  retry: () => unknown;
};

/**
 * Masters for a screen converted in data-layer 2.1: no mount-time page-copy
 * read, no 'bhb-masters-updated' listener, no ensureMastersHydrated —
 * a Masters change made anywhere reaches the open screen through the versions
 * poll (≤ 20 s + one read). `enabled: false` (a control not yet opened)
 * makes no request; see useMasters.
 */
export function useScreenMasters(opts: { enabled?: boolean } = {}): ScreenMasters {
  const q = useMasters(opts);
  const access = useAccessData();
  const accessMasters = access.ready ? access.masters : null;
  // useAccessData re-reads its copy on every desk event, so its identity
  // moves far more often than the roster does. Keep the previous staff side
  // while it is the same content: a screen's effects keyed on `masters` (a
  // teacher's default class, say) must not re-run because another desk loaded.
  const staffSide = useRef<{ sig: string; value: MastersState } | null>(null);
  const stableAccess = useMemo(() => {
    if (!accessMasters) return null;
    const sig = JSON.stringify([
      accessMasters.staff,
      accessMasters.departments,
      accessMasters.designations,
      accessMasters.students,
    ]);
    if (staffSide.current?.sig !== sig) staffSide.current = { sig, value: accessMasters };
    return staffSide.current.value;
  }, [accessMasters]);
  const masters = useMemo(() => screenMastersOf(q.data, stableAccess), [q.data, stableAccess]);
  // A failed BACKGROUND refetch keeps the last good answer on screen (React
  // Query keeps `data`); only a read that never produced one is an error.
  const failed = q.isError && q.data === undefined;
  return {
    masters: failed ? null : masters,
    scope: q.data?.scope ?? null,
    error: failed ? q.error : null,
    retry: q.refetch,
  };
}
