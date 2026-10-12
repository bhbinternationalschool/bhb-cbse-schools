import { clientBuildId, onClientBuildKnown } from "@/lib/clientBuild";

/**
 * The browser half of client telemetry (data-layer 1.2): one call,
 * `reportClientMetric({...})`, that sends a measurement to
 * POST /api/client-metrics and can never break the page.
 *
 * - Timings (page-ready, query, desk-hydrate) are sampled 1 in 5; failures
 *   (query-error, rendered-zero-rows) are always sent.
 * - sendBeacon first (it survives the page closing and needs no await), a
 *   `fetch(…, {keepalive})` if the beacon is refused or missing.
 * - Never throws, never returns a promise anyone must handle.
 * - Does nothing on the server or in a test process (no `window`).
 * - Held until the page knows its build (lib/clientBuild — the update bar's
 *   first /api/app-version answer), at most 15 s; then sent as "unknown".
 *   Every line is then attributable to the build that produced it.
 *
 * The rules live in createClientMetricsSender so the self-test drives the
 * same code with a fake navigator, fetch and random source.
 */

export type ClientMetricEvent = "page-ready" | "query" | "query-error" | "rendered-zero-rows" | "desk-hydrate";

export type ClientMetric = {
  event: ClientMetricEvent;
  /** The screen's path (no query string). Defaults to location.pathname. */
  route?: string;
  /** What within the screen: a desk id, an API path, how the timing started. */
  key?: string;
  ms?: number;
  bytes?: number;
  rows?: number;
};

const ALWAYS: ReadonlySet<ClientMetricEvent> = new Set<ClientMetricEvent>(["query-error", "rendered-zero-rows"]);
export const TIMING_SAMPLE_RATE = 0.2;
export const METRICS_URL = "/api/client-metrics";
const BUILD_WAIT_MS = 15_000;

type BeaconNavigator = { sendBeacon?: (url: string, data?: BodyInit | null) => boolean };

export type SenderDeps = {
  navigator?: BeaconNavigator | null;
  fetch?: ((url: string, init: RequestInit) => Promise<unknown>) | null;
  random?: () => number;
  pathname?: () => string;
  build?: () => string | null;
  whenBuildKnown?: (fn: (build: string) => void) => () => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
};

/** A path's ids folded to `:id`, so one screen is one route in the report. */
export function normaliseRoute(path: string): string {
  const clean = (path.split(/[?#]/)[0] || "/").slice(0, 200);
  return clean
    .split("/")
    .map((seg) => (/\d/.test(seg) && (seg.length >= 8 || /^\d+$/.test(seg)) ? ":id" : seg))
    .join("/");
}

export function createClientMetricsSender(deps: SenderDeps) {
  const random = deps.random ?? Math.random;
  const pending: string[] = [];
  let waiting = false;

  function transmit(body: string): void {
    try {
      const nav = deps.navigator;
      if (nav && typeof nav.sendBeacon === "function") {
        // text/plain is a CORS-safelisted type: no browser refuses the beacon for it.
        if (nav.sendBeacon(METRICS_URL, new Blob([body], { type: "text/plain;charset=UTF-8" }))) return;
      }
    } catch {
      /* fall through to fetch */
    }
    try {
      const f = deps.fetch;
      if (typeof f !== "function") return;
      const p = f(METRICS_URL, {
        method: "POST",
        body,
        keepalive: true,
        credentials: "same-origin",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
      });
      if (p && typeof (p as Promise<unknown>).catch === "function") (p as Promise<unknown>).catch(() => undefined);
    } catch {
      /* telemetry is never worth an error on the page */
    }
  }

  function flush(build: string): void {
    waiting = false;
    for (const raw of pending.splice(0)) {
      try {
        transmit(JSON.stringify({ ...(JSON.parse(raw) as object), build }));
      } catch {
        /* drop it */
      }
    }
  }

  /** Returns true when the measurement was sent or queued (for tests). */
  return function report(m: ClientMetric): boolean {
    try {
      if (!m || typeof m.event !== "string") return false;
      if (!ALWAYS.has(m.event) && !(random() < TIMING_SAMPLE_RATE)) return false;
      const route = normaliseRoute(m.route ?? deps.pathname?.() ?? "/");
      const payload: Record<string, unknown> = { event: m.event, route, platform: "web" };
      if (typeof m.key === "string" && m.key) payload.key = m.key.slice(0, 120);
      for (const f of ["ms", "bytes", "rows"] as const) {
        const v = m[f];
        if (typeof v === "number" && Number.isFinite(v) && v >= 0) payload[f] = f === "ms" ? Math.round(v) : Math.floor(v);
      }
      const build = deps.build?.() ?? null;
      if (build) {
        transmit(JSON.stringify({ ...payload, build }));
        return true;
      }
      if (pending.length >= 20) return false;
      pending.push(JSON.stringify(payload));
      if (!waiting) {
        waiting = true;
        let done = false;
        const unsubscribe = deps.whenBuildKnown?.((b) => {
          if (done) return;
          done = true;
          flush(b);
        });
        deps.setTimeout?.(() => {
          if (done) return;
          done = true;
          unsubscribe?.();
          flush("unknown");
        }, BUILD_WAIT_MS);
        if (!deps.whenBuildKnown && !deps.setTimeout) flush("unknown");
      }
      return true;
    } catch {
      return false;
    }
  };
}

let sender: ((m: ClientMetric) => boolean) | null = null;

/** Report one measurement. Safe anywhere: a no-op without `window`. */
export function reportClientMetric(m: ClientMetric): void {
  if (typeof window === "undefined") return;
  try {
    if (!sender) {
      sender = createClientMetricsSender({
        navigator: typeof navigator !== "undefined" ? navigator : null,
        fetch: typeof fetch === "function" ? (url, init) => fetch(url, init) : null,
        random: Math.random,
        pathname: () => window.location.pathname,
        build: clientBuildId,
        whenBuildKnown: onClientBuildKnown,
        setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      });
    }
    sender(m);
  } catch {
    /* never */
  }
}
