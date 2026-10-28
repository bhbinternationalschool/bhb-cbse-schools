/**
 * The pure half of the client query kernel (data-layer 1.4): no React, no
 * DOM — every rule here has a test in queryKernel.selftest.ts. The hooks
 * (lib/data/client/hooks.tsx) only wire these into React Query.
 *
 *  - When a query is retried, and how long between tries.
 *  - What the versions poll does with an answer (apply / keep / stop).
 *  - Which queries a versions answer makes stale.
 */

/** A failed read, as the query's `error`. Never shaped like data (R6). */
export class ErpQueryError extends Error {
  constructor(
    /** HTTP status; null when the request never got an answer. */
    public readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = "ErpQueryError";
  }
}

/** The settings every kernel query shares (COMMAND.md 1.4). */
export const QUERY_STALE_MS = 60_000;
export const QUERY_RETRIES = 2;
export const VERSIONS_POLL_MS = 20_000;
/** A new poll is not started sooner than this after the last one (mount / tab shown). */
export const VERSIONS_MIN_GAP_MS = 5_000;
export const VERSIONS_PATH = "/api/data/views/versions";

/**
 * Retry a failed read at most twice — but only when trying again can help:
 * no answer (network), a 5xx, a 408 or a 429. A 4xx is the server's verdict
 * (signed out, not allowed, not found, bad request): asking again gets the
 * same answer, later.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= QUERY_RETRIES) return false;
  const status = error instanceof ErpQueryError ? error.status : null;
  if (status === null) return true;
  return status >= 500 || status === 408 || status === 429;
}

/** 1 s, then 2 s (then 4 s, capped at 8 s). */
export function retryDelay(attemptIndex: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attemptIndex), 8_000);
}

// ── Versions ───────────────────────────────────────────────────────────────

/** One desk's value in GET /api/data/views/versions (erp_versions). */
export type DeskVersion = { updated_at: string | null; count: number | null };
export type Versions = Record<string, DeskVersion | null | undefined>;

/** A comparable string for one desk's value; a missing desk is its own value. */
export function versionFingerprint(v: DeskVersion | null | undefined): string {
  if (!v) return "absent";
  return `${v.updated_at ?? ""}|${v.count ?? ""}`;
}

/** Desks whose value differs between two answers. Nothing moved before the first answer. */
export function movedDesks(prev: Versions | null, next: Versions): Set<string> {
  const moved = new Set<string>();
  if (!prev) return moved;
  for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    if (versionFingerprint(prev[k]) !== versionFingerprint(next[k])) moved.add(k);
  }
  return moved;
}

/** What a query tells the poll about itself. */
export type QueryDeskInfo = {
  /** React Query's queryHash. */
  id: string;
  /** The desks (erp_versions keys) its data is built from. */
  desks: readonly string[];
  /**
   * The versions its data was built from, when the server said so (a
   * reference view's `versions`); null when unknown (a /api/v1 route, a
   * stale server copy, not loaded yet).
   */
  builtFrom: Versions | null;
};

/**
 * Which queries a versions answer makes stale.
 *
 *  - A query that knows what it was built from is stale when any of its
 *    desks now holds another value. This also covers the first answer: a
 *    change that landed between the query's read and the poll's first read
 *    is not missed.
 *  - A query that does not know is stale when one of its desks moved
 *    between the previous answer and this one (never on the first answer —
 *    there is nothing to compare with).
 */
export function queriesToInvalidate(prev: Versions | null, next: Versions, queries: readonly QueryDeskInfo[]): string[] {
  const moved = movedDesks(prev, next);
  const out: string[] = [];
  for (const q of queries) {
    const stale = q.desks.some((d) =>
      q.builtFrom && d in q.builtFrom
        ? versionFingerprint(q.builtFrom[d]) !== versionFingerprint(next[d])
        : moved.has(d),
    );
    if (stale) out.push(q.id);
  }
  return out;
}

/** Queries reading any of `desks` (a confirmed write to those desks makes them stale). */
export function queriesForDesks(desks: readonly string[], queries: readonly Pick<QueryDeskInfo, "id" | "desks">[]): string[] {
  const want = new Set(desks);
  return queries.filter((q) => q.desks.some((d) => want.has(d))).map((q) => q.id);
}

/**
 * What the poll does with one answer from GET /api/data/views/versions:
 *   apply  200 with a versions object;
 *   stop   401 / 403 — not signed in as staff (a parent session, a signed-out
 *          tab): this page will never be allowed it, so it stops asking,
 *          quietly (nothing on screen, nothing in the console);
 *   keep   anything else (503 — the server could not read the versions — a
 *          5xx, no answer, an unreadable body): the data on screen stays as
 *          it is and the next tick asks again. Unknown is not "nothing moved"
 *          and not "everything moved": nothing is invalidated.
 */
export type PollOutcome = { kind: "apply"; versions: Versions } | { kind: "stop" } | { kind: "keep" };

export function pollOutcome(status: number | null, body: unknown): PollOutcome {
  if (status === 401 || status === 403) return { kind: "stop" };
  if (status !== 200) return { kind: "keep" };
  const b = body as { ok?: unknown; versions?: unknown } | null;
  if (!b || b.ok !== true || !b.versions || typeof b.versions !== "object" || Array.isArray(b.versions)) {
    return { kind: "keep" };
  }
  return { kind: "apply", versions: b.versions as Versions };
}
