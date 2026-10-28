/**
 * The `desk-hydrate` client metric, re-emitted from the query kernel
 * (data-layer 2.3a). It used to ride the `bhb-desk-first-hydrated` event the
 * old desk hydrates raised (deleted in 2.3a, with every other hydrate event).
 *
 * Now: the first time a reference read (useMasters, useStaffList, useRbac,
 * useModuleRegistry, any useErpQuery) answers on this page, one
 * `desk-hydrate` is reported with `key` = the query's name ("masters",
 * "staff-list", "rbac", …) and `ms` = the time since the current route's
 * clock started — the same clock as that route's `page-ready`
 * (components/shell/useClientMetrics sets it). Once per name per page, like
 * the event was once per desk per page. The old desks still loaded by the
 * replica (sis, fees, …) no longer report one.
 *
 * Pure apart from the default instance, so the rule is self-tested
 * (viewLoadMetric.selftest.ts).
 */
import { reportClientMetric, type ClientMetric } from "@/lib/clientMetrics";

export type ViewLoadMetric = {
  /** Where the current route's clock started (performance.now() units). */
  setRouteStart(ms: number): void;
  /** A read named `key` answered: report it if it is the first on this page. */
  loaded(key: string): void;
};

export function createViewLoadMetric(deps: { report: (m: ClientMetric) => void; now: () => number }): ViewLoadMetric {
  let routeStart = 0;
  const seen = new Set<string>();
  return {
    setRouteStart(ms) {
      routeStart = ms;
    },
    loaded(key) {
      if (!key || seen.has(key)) return;
      seen.add(key);
      try {
        deps.report({ event: "desk-hydrate", key, ms: Math.max(0, deps.now() - routeStart) });
      } catch {
        /* a metric never breaks a read */
      }
    },
  };
}

const nowMs = () => (typeof performance !== "undefined" ? performance.now() : 0);

/** This page's instance (the kernel reports into it; useClientMetrics sets its clock). */
export const viewLoadMetric: ViewLoadMetric = createViewLoadMetric({ report: reportClientMetric, now: nowMs });
