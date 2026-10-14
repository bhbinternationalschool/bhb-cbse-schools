/**
 * One structured log line per request, with where the time went
 * (data-layer 4.1): `auth` (session + its reference reads), `query` (the SQL
 * scoped to the caller), `build` (shaping the answer). Cloud Run keeps a JSON
 * line as `jsonPayload`, so `jsonPayload.event = "route-timing"` and
 * `jsonPayload.route = "<route>"` filter it, and p50/p95 per phase come from
 * the numbers — the same shape as `client-metric` and `stale-build-write`.
 *
 * Logging never throws and never changes the answer.
 */

export type RoutePhase = "auth" | "query" | "build";

export type RouteTimingLine = {
  event: "route-timing";
  route: string;
  status: number;
  authMs: number;
  queryMs: number;
  buildMs: number;
  totalMs: number;
} & Record<string, string | number | boolean>;

export type RouteTimer = {
  /** Close the running phase and start `phase` (time is charged to the phase that was running). */
  phase(phase: RoutePhase): void;
  /** Extra fields for the line (counts, which path ran) — never personal data. */
  note(key: string, value: string | number | boolean): void;
  /** Close the running phase and log the line once. Returns it (tests). */
  done(status: number): RouteTimingLine | null;
};

export function routeTimer(
  route: string,
  opts: { now?: () => number; log?: (line: string) => void } = {},
): RouteTimer {
  const now = opts.now ?? (() => performance.now());
  const log = opts.log ?? ((l: string) => console.log(l));
  const start = now();
  const spent: Record<RoutePhase, number> = { auth: 0, query: 0, build: 0 };
  const notes: Record<string, string | number | boolean> = {};
  let current: RoutePhase = "auth";
  let mark = start;
  let finished = false;
  const close = () => {
    const t = now();
    spent[current] += t - mark;
    mark = t;
  };
  const ms = (n: number) => Math.round(n * 10) / 10;
  return {
    phase(phase) {
      if (finished) return;
      close();
      current = phase;
    },
    note(key, value) {
      if (key === "event" || key === "route" || key === "status" || key.endsWith("Ms")) return;
      notes[key] = value;
    },
    done(status) {
      if (finished) return null;
      finished = true;
      close();
      const line: RouteTimingLine = {
        ...notes,
        event: "route-timing",
        route,
        status,
        authMs: ms(spent.auth),
        queryMs: ms(spent.query),
        buildMs: ms(spent.build),
        totalMs: ms(now() - start),
      };
      try {
        log(JSON.stringify(line));
      } catch {
        /* a log line must never fail the request */
      }
      return line;
    },
  };
}

