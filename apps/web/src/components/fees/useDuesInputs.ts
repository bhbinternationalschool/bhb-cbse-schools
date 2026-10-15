"use client";

import { useCallback, useEffect, useState } from "react";
import { FEES_UPDATED_EVENT, loadFees } from "@/lib/fees";
import { loadTransport } from "@/lib/transport";
import { deskEverHydrated, hasDeskLoaded } from "@/lib/deskHydrateGuard";
import { forgetFirstRead } from "@/lib/deskLazyHydrate";

/** Longest a screen waits before calling a desk that has not landed "not loaded". */
const READY_FALLBACK_MS = 20_000;

export type DuesDesk = "fees" | "transport";
const DESKS: DuesDesk[] = ["fees", "transport"];

/**
 * Everything a browser dues figure is computed from, loaded before it is shown.
 *
 * `computeStudentDues` is synchronous and reads the fee book (`loadFees`) and
 * the transport desk (`loadTransport`) from memory. A screen that called it
 * before those desks had arrived got a figure with NO transport in it — no
 * bus month owing and no bus month paid — and nothing told it to recompute
 * when they landed. Found 15 Oct 2026 (PR #665) on the student fee card; the
 * same was true of the student profile modal (outstanding read ₹0 for a
 * child owing ₹3,000 of bus fees).
 *
 * No hydration call of its own: reading the two desks starts their load
 * (`hydrateOnFirstRead` in loadFees / loadTransport), and each load announces
 * itself with `bhb-desk-hydrated`. `tick` changes whenever either desk lands
 * or changes, so a `useMemo` that lists it recomputes.
 *
 * `status` says whether the figure can be trusted:
 *   - "loading" until both desks have loaded, or a load has come back empty;
 *   - "ready"   both desks are in memory;
 *   - "failed"  a desk's load came back without loading it (the ensure calls
 *               return false on a failed read; the event still fires), or it
 *               has not landed after 20 s. `missing` names it. A screen must
 *               then say the dues are NOT LOADED and act on none of them —
 *               never print the tuition-only figure (15 Oct 2026).
 * `ready` (status is not "loading") is kept for screens that only wait.
 * `retry` lets the next read start the failed load again.
 */
export function useDuesInputs(): {
  ready: boolean;
  status: "loading" | "ready" | "failed";
  missing: DuesDesk[];
  tick: number;
  retry: () => void;
} {
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [missing, setMissing] = useState<DuesDesk[]>([]);
  const [tick, setTick] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const loaded = (d: DuesDesk) => hasDeskLoaded(d) || deskEverHydrated(d);
    const announced = new Set<string>();
    let timedOut = false;
    const settle = () => {
      const notLoaded = DESKS.filter((d) => !loaded(d));
      if (notLoaded.length === 0) {
        setMissing([]);
        setStatus("ready");
      } else if (timedOut || notLoaded.every((d) => announced.has(d))) {
        // Every outstanding load has come back without loading its desk.
        setMissing(notLoaded);
        setStatus("failed");
      }
    };
    const onHydrated = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (id) announced.add(id);
      settle();
      setTick((t) => t + 1);
    };
    const onFees = () => {
      settle();
      setTick((t) => t + 1);
    };
    window.addEventListener("bhb-desk-hydrated", onHydrated);
    window.addEventListener(FEES_UPDATED_EVENT, onFees);
    if (attempt > 0) {
      setStatus("loading");
      for (const d of DESKS) if (!loaded(d)) forgetFirstRead(d);
    }
    // Reading is what starts the loads.
    loadFees();
    loadTransport();
    settle();
    const fallback = window.setTimeout(() => {
      timedOut = true;
      settle();
    }, READY_FALLBACK_MS);
    return () => {
      window.removeEventListener("bhb-desk-hydrated", onHydrated);
      window.removeEventListener(FEES_UPDATED_EVENT, onFees);
      window.clearTimeout(fallback);
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ready: status !== "loading", status, missing, tick, retry };
}

/** "the transport desk", "the fee book and the transport desk" — for a not-loaded notice. */
export function duesDesksLabel(desks: readonly DuesDesk[]): string {
  return desks.map((d) => (d === "fees" ? "the fee book" : "the transport desk")).join(" and ");
}
