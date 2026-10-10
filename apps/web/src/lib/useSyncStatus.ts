"use client";

import { useEffect, useState } from "react";
import {
  getSyncStatus,
  subscribeSyncStatus,
  type SyncStatus,
  type SyncStatusState,
} from "@/lib/syncRetryStatus";

const RANK: Record<SyncStatus, number> = {
  idle: 0,
  pending: 1,
  retrying: 2,
  failed: 3,
};

/** Worst-case aggregate across all given sync-status keys. */
export function useSyncStatus(keys: string[]): {
  status: SyncStatus;
  error?: string;
} {
  const [states, setStates] = useState<Record<string, SyncStatusState>>(() => {
    const init: Record<string, SyncStatusState> = {};
    for (const key of keys) init[key] = getSyncStatus(key);
    return init;
  });

  useEffect(() => {
    setStates(() => {
      const init: Record<string, SyncStatusState> = {};
      for (const key of keys) init[key] = getSyncStatus(key);
      return init;
    });
    const unsubs = keys.map((key) =>
      subscribeSyncStatus(key, (state) => {
        setStates((prev) => ({ ...prev, [key]: state }));
      }),
    );
    return () => unsubs.forEach((unsub) => unsub());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys.join(",")]);

  let worst: SyncStatusState = { status: "idle", attempts: 0 };
  for (const key of keys) {
    const s = states[key];
    if (s && RANK[s.status] > RANK[worst.status]) worst = s;
  }
  return { status: worst.status, error: worst.error };
}
