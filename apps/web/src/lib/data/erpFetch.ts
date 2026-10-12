import { clientBuildId } from "@/lib/clientBuild";
import { reportClientMetric } from "@/lib/clientMetrics";

/**
 * The one fetch wrapper new data code uses (data-layer 1.2, rule R2).
 *
 * It does two things and changes nothing else about the request:
 *  1. adds `X-Bhb-Build: <the build this page was loaded with>` once that is
 *     known (lib/clientBuild), so the server can record writes from tabs
 *     opened before a deploy (lib/staleBuild.server — recorded, never refused);
 *  2. times the call and reports it (lib/clientMetrics: `query`, sampled; or
 *     `query-error` for a network failure or a 5xx, always).
 *
 * Method, body, credentials, cache, signal, keepalive, redirect — every
 * other field of `init` — reach fetch exactly as given; with no build known
 * yet, `init` itself is passed through. The response or the error is
 * returned unchanged. Existing callers are NOT converted by this step; new
 * hooks (useErpQuery, 1.4) use this from the start.
 */

export type ErpFetchTiming = {
  method: string;
  /** The request path without its query string. */
  path: string;
  /** HTTP status, or null when the request never got an answer. */
  status: number | null;
  ms: number;
  /** Declared Content-Length of the answer, when the server sent one. */
  bytes: number | null;
  /** A network failure or a 5xx. An abort is not a failure. */
  failed: boolean;
  aborted: boolean;
};

export type ErpFetchOptions = {
  fetchImpl?: (input: string | URL, init?: RequestInit) => Promise<Response>;
  now?: () => number;
  build?: () => string | null;
  onTiming?: (t: ErpFetchTiming) => void;
};

export const BUILD_HEADER = "X-Bhb-Build";

function defaultNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

function pathOf(input: string | URL): string {
  try {
    const base = typeof window !== "undefined" ? window.location.href : "http://localhost";
    return new URL(String(input), base).pathname;
  } catch {
    return String(input).split("?")[0];
  }
}

/** The default sink: one `query` / `query-error` metric per call. */
export function reportFetchTiming(t: ErpFetchTiming): void {
  reportClientMetric({
    event: t.failed ? "query-error" : "query",
    key: `${t.method} ${t.path}`,
    ms: t.ms,
    ...(t.bytes !== null ? { bytes: t.bytes } : {}),
  });
}

export async function erpFetch(
  input: string | URL,
  init?: RequestInit,
  opts: ErpFetchOptions = {},
): Promise<Response> {
  const doFetch = opts.fetchImpl ?? ((i: string | URL, n?: RequestInit) => fetch(i, n));
  const now = opts.now ?? defaultNow;
  const onTiming = opts.onTiming ?? reportFetchTiming;
  const build = (opts.build ?? clientBuildId)();

  let sent: RequestInit | undefined = init;
  if (build) {
    const headers = new Headers(init?.headers);
    headers.set(BUILD_HEADER, build);
    sent = { ...init, headers };
  }

  const method = (init?.method || "GET").toUpperCase();
  const started = now();
  const timing = (status: number | null, bytes: number | null, failed: boolean, aborted: boolean) => {
    try {
      onTiming({ method, path: pathOf(input), status, ms: Math.max(0, now() - started), bytes, failed, aborted });
    } catch {
      /* timing must never change the outcome */
    }
  };

  let res: Response;
  try {
    res = await doFetch(input, sent);
  } catch (e) {
    const aborted = (e as { name?: string } | null)?.name === "AbortError";
    timing(null, null, !aborted, aborted);
    throw e;
  }
  const len = Number(res.headers.get("content-length"));
  timing(res.status, Number.isFinite(len) && len >= 0 && res.headers.has("content-length") ? len : null, res.status >= 500, false);
  return res;
}
