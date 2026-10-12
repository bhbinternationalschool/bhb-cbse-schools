import { createHash } from "crypto";
import type { DemoSession } from "@/lib/auth";
import { verifySessionCookie } from "@/lib/sessionCookie.server";

/**
 * POST /api/client-metrics — the server half of client telemetry
 * (data-layer 1.2; docs/data-layer-rebuild/evidence/harness.md finding 4).
 *
 * A signed-in page or phone reports one measurement; this writes exactly one
 * structured log line, which Cloud Logging indexes as jsonPayload, and
 * nothing else — no database write. Queries: evidence/metrics-queries.md.
 *
 * Everything here is pure or takes its clock, so the route's rules run in a
 * self-test without a server: lib/clientMetricsRoute.selftest.ts.
 */

export const METRIC_EVENTS = [
  "page-ready",
  "query",
  "query-error",
  "rendered-zero-rows",
  "desk-hydrate",
] as const;
export type MetricEvent = (typeof METRIC_EVENTS)[number];

/** Events that are a duration: `ms` is required. */
const TIMED: ReadonlySet<MetricEvent> = new Set<MetricEvent>(["page-ready", "query", "desk-hydrate"]);

export const MAX_BODY_BYTES = 2048;
const MAX_MS = 600_000; // ten minutes: anything longer is a clock fault, not a wait
const MAX_BYTES = 100_000_000;
const MAX_ROWS = 1_000_000;
const ROUTE_RE = /^\/[^\s?#]{0,199}$/;
const KEY_RE = /^[A-Za-z0-9_.:/ -]{1,120}$/;
const BUILD_RE = /^[A-Za-z0-9._-]{1,80}$/;

export type ClientMetricLine = {
  event: "client-metric";
  build: string;
  platform: "web" | "flutter";
  persona: string;
  roleCode: string;
  route: string;
  metric: MetricEvent;
  key: string | null;
  ms: number | null;
  bytes: number | null;
  rows: number | null;
};

export type ParsedMetric = Omit<ClientMetricLine, "event" | "persona" | "roleCode">;

/** The signed session from the request's Cookie header, or null. */
export function sessionFromRequest(req: Request): { session: DemoSession; raw: string } | null {
  const header = req.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== "bhb_demo_session") continue;
    let raw = part.slice(eq + 1).trim();
    try {
      raw = decodeURIComponent(raw);
    } catch {
      /* keep it as sent */
    }
    const session = verifySessionCookie(raw);
    return session ? { session, raw } : null;
  }
  return null;
}

/**
 * The body as text, refusing more than `max` bytes without buffering them:
 * a declared Content-Length over the cap is refused unread, and an
 * undeclared body is read only until it passes the cap.
 */
export async function readBodyCapped(
  req: Request,
  max: number = MAX_BODY_BYTES,
): Promise<{ ok: true; text: string } | { ok: false; tooLarge: boolean }> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return { ok: false, tooLarge: true };
  if (!req.body) return { ok: true, text: "" };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, tooLarge: true };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, tooLarge: false };
  }
  return { ok: true, text: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8") };
}

function optNumber(v: unknown, max: number, integer: boolean): number | null | "bad" {
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max) return "bad";
  if (integer && !Number.isInteger(v)) return "bad";
  return integer ? v : Math.round(v);
}

/** Validate one measurement. Unknown fields are ignored, never logged. */
export function parseMetricBody(text: string): { ok: true; metric: ParsedMetric } | { ok: false; error: string } {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, error: "body is not JSON" };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "body must be an object" };
  const b = body as Record<string, unknown>;

  const event = b.event;
  if (typeof event !== "string" || !(METRIC_EVENTS as readonly string[]).includes(event)) {
    return { ok: false, error: `event must be one of ${METRIC_EVENTS.join(", ")}` };
  }
  const metric = event as MetricEvent;

  if (typeof b.route !== "string" || !ROUTE_RE.test(b.route)) {
    return { ok: false, error: "route must be a path of at most 200 characters" };
  }

  let key: string | null = null;
  if (b.key !== undefined && b.key !== null) {
    if (typeof b.key !== "string" || !KEY_RE.test(b.key)) return { ok: false, error: "key is malformed" };
    key = b.key;
  }

  const ms = optNumber(b.ms, MAX_MS, false);
  const bytes = optNumber(b.bytes, MAX_BYTES, true);
  const rows = optNumber(b.rows, MAX_ROWS, true);
  if (ms === "bad") return { ok: false, error: `ms must be a number from 0 to ${MAX_MS}` };
  if (bytes === "bad") return { ok: false, error: `bytes must be a whole number from 0 to ${MAX_BYTES}` };
  if (rows === "bad") return { ok: false, error: `rows must be a whole number from 0 to ${MAX_ROWS}` };
  if (TIMED.has(metric) && ms === null) return { ok: false, error: `${metric} needs ms` };
  if (metric === "rendered-zero-rows" && rows !== null && rows !== 0) {
    return { ok: false, error: "rendered-zero-rows reports rows = 0" };
  }

  const build = typeof b.build === "string" && BUILD_RE.test(b.build) ? b.build : "unknown";
  const platform = b.platform === "flutter" ? "flutter" : "web";

  return { ok: true, metric: { build, platform, route: b.route, metric, key, ms, bytes, rows } };
}

/** The one log line. Persona and role come from the signed session, never the body. */
export function metricLogLine(m: ParsedMetric, session: DemoSession): ClientMetricLine {
  return {
    event: "client-metric",
    build: m.build,
    platform: m.platform,
    persona: session.persona,
    roleCode: session.roleCode,
    route: m.route,
    metric: m.metric,
    key: m.key,
    ms: m.ms,
    bytes: m.bytes,
    rows: m.rows,
  };
}

/**
 * Per-session token bucket, in this process only (each Cloud Run instance
 * counts its own — enough to stop one page flooding the logs, which is all
 * it is for). `capacity` reports at once, refilled at `perMinute`.
 */
export class MetricRateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly capacity = 60,
    private readonly perMinute = 60,
    private readonly now: () => number = () => Date.now(),
    private readonly maxSessions = 5000,
  ) {}

  /** Key a session by a hash of its signed cookie (the cookie itself is never kept). */
  static keyFor(rawCookie: string): string {
    return createHash("sha256").update(rawCookie).digest("hex").slice(0, 24);
  }

  /** Take one token; false when this session has none left. */
  take(key: string): boolean {
    const t = this.now();
    const refill = this.perMinute / 60_000;
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxSessions) this.prune(t);
      b = { tokens: this.capacity, at: t };
      this.buckets.set(key, b);
    } else {
      b.tokens = Math.min(this.capacity, b.tokens + (t - b.at) * refill);
      b.at = t;
    }
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  /** Drop sessions whose bucket has refilled (idle); if none are, start over. */
  private prune(t: number): void {
    const full = this.capacity / (this.perMinute / 60_000);
    for (const [k, b] of this.buckets) if (t - b.at >= full) this.buckets.delete(k);
    if (this.buckets.size >= this.maxSessions) this.buckets.clear();
  }
}
