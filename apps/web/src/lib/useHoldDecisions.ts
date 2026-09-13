"use client";

/**
 * Load the standing decisions once a screen that enforces a gate mounts.
 *
 * `checkHold` reads a synchronous snapshot, so somebody has to fill it. This
 * is that somebody. Every screen that can turn a child away calls it, and
 * re-renders when the answer lands so a gate is not left showing the verdict
 * it reached before the data arrived.
 *
 * The re-render matters more than it looks. Under a "propose" gate an
 * unloaded snapshot means "not checked", and every child reads as allowed.
 * Without the state bump the screen would keep that first answer for as long
 * as it stayed open, and an office would be looking at a list of blocked
 * children showing none of them blocked.
 */

import { useCallback, useEffect, useState } from "react";
import {
  ensureHoldDecisionsHydrated,
  holdDecisionsSnapshot,
} from "@/lib/holdDecisionsCache";

export function useHoldDecisions(): {
  known: boolean;
  error: string;
  loadedAt: string | null;
  /**
   * Changes when the snapshot does. Screens that memoise a verdict must put
   * this in their dependency list, or they keep the answer they reached
   * before the decisions arrived.
   */
  version: number;
  reload: () => void;
} {
  const [version, bump] = useState(0);

  useEffect(() => {
    let alive = true;
    void ensureHoldDecisionsHydrated().then(() => {
      if (alive) bump((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, []);

  const reload = useCallback(() => {
    void ensureHoldDecisionsHydrated({ force: true }).then(() =>
      bump((n) => n + 1),
    );
  }, []);

  const snap = holdDecisionsSnapshot();
  return {
    known: snap.known,
    error: snap.error,
    loadedAt: snap.loadedAt,
    version,
    reload,
  };
}
