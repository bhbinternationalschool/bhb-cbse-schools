"use client";

import { useEffect, useState } from "react";
import { FEES_UPDATED_EVENT, loadFees } from "@/lib/fees";
import { loadTransport } from "@/lib/transport";
import { hasDeskLoaded } from "@/lib/deskHydrateGuard";

/** Longest a screen waits before showing what it has (a desk that cannot load). */
const READY_FALLBACK_MS = 20_000;

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
 * itself with `bhb-desk-hydrated`. `ready` turns true once both desks have
 * loaded or announced (a desk that failed still announces, and a 20 s
 * fallback ends the wait, so a screen never spins for ever); `tick` changes
 * whenever either desk lands or changes, so a `useMemo` that lists it
 * recomputes.
 */
export function useDuesInputs(): { ready: boolean; tick: number } {
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const announced = new Set<string>();
    const settle = () => {
      const fees = hasDeskLoaded("fees") || announced.has("fees");
      const transport = hasDeskLoaded("transport") || announced.has("transport");
      if (fees && transport) setReady(true);
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
    // Reading is what starts the loads.
    loadFees();
    loadTransport();
    settle();
    const fallback = window.setTimeout(() => setReady(true), READY_FALLBACK_MS);
    return () => {
      window.removeEventListener("bhb-desk-hydrated", onHydrated);
      window.removeEventListener(FEES_UPDATED_EVENT, onFees);
      window.clearTimeout(fallback);
    };
  }, []);

  return { ready, tick };
}
