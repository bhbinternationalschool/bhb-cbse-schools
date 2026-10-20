"use client";

/**
 * The client query kernel (data-layer 1.4, rules R1–R3, R6).
 *
 *   <ErpQueryProvider>                 one React Query client per staff tab (AppShell)
 *   useErpQuery(key, path, {desk})     GET a view / v1 answer; cached (staleTime 60 s),
 *                                      refetched on window focus, retried twice on
 *                                      network / 5xx with backoff; a failure is the
 *                                      query's `error`, never empty data
 *   useErpMutation(collection, {desk}) useSaveMutation + "the desk changed": the
 *                                      desk's queries are invalidated after a
 *                                      confirmed write (and after a conflict)
 *   useVersionsPoll(enabled)           GET /api/data/views/versions every 20 s and
 *                                      when the tab is shown; a desk whose value
 *                                      moved invalidates its queries
 *   useMasters() useStaffList() useRbac() useModuleRegistry()
 *                                      the reference views, read-only
 *
 * The only client copy is React Query's cache: short-lived, invalidated by
 * the one change signal, never pushed back (R1). The rules themselves —
 * retry, the poll's outcomes, which queries go stale — are pure functions in
 * ./queryKernel.ts with their own self-test.
 *
 * When the versions poll runs: only while at least one mounted query reads a
 * desk (`desk` given) and the tab is visible. Since 20 Oct 2026 the header
 * bell (NotificationBell, desk "erp_notifications") is such a query on every
 * staff page, so every staff page polls — once per tab, every 20 s, shared by
 * every desk query on the page (COMMAND.md 1.4, "When the poll runs"). The provider lives in AppShell, which only the staff (erp)
 * layout renders: parent and field sessions are redirected before it, and the
 * Flutter apps' web views (checkout, e-books, videos) never open an (erp)
 * page. A 401/403 from the versions route stops the poll for the life of the
 * page, quietly; a 503 keeps what is on screen and asks again next tick.
 */

import { QueryClient, QueryClientProvider, useQuery, useQueryClient, type Query, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { erpFetch } from "../erpFetch";
import type { WriteResult } from "../types";
import type { ModuleRegistryView, MastersView, RbacView, StaffListView } from "../viewTypes";
import { emptyMastersShell, readMastersPageCopyRaw } from "@/lib/masters";
import { writeMastersLocalRaw } from "@/lib/mastersPersistence";
import { bridgeMastersToPageMemory, parseMastersView, type MastersBridgeDeps } from "./mastersBridge";
import { readView } from "./query";
import {
  ErpQueryError,
  pollOutcome,
  queriesForDesks,
  queriesToInvalidate,
  QUERY_STALE_MS,
  retryDelay,
  shouldRetry,
  VERSIONS_MIN_GAP_MS,
  VERSIONS_PATH,
  VERSIONS_POLL_MS,
  type PollOutcome,
  type QueryDeskInfo,
  type Versions,
} from "./queryKernel";
import { useSaveMutation, type UseSaveMutation } from "./useSaveMutation";

export { ErpQueryError } from "./queryKernel";

// ── The client ─────────────────────────────────────────────────────────────

export function makeErpQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: QUERY_STALE_MS,
        refetchOnWindowFocus: true,
        retry: shouldRetry,
        retryDelay,
      },
    },
  });
}

/** One query client for this tab, and the versions poll that keeps it honest. */
export function ErpQueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(makeErpQueryClient);
  return (
    <QueryClientProvider client={client}>
      <VersionsPoller />
      {children}
    </QueryClientProvider>
  );
}

// ── Queries ────────────────────────────────────────────────────────────────

/** What the query function stores: the data and what it was built from. */
type Raw<T> = { data: T; builtFrom: Versions | null };

type DeskMeta = { desks: readonly string[] };

function desksOf(meta: unknown): readonly string[] {
  const d = (meta as Partial<DeskMeta> | undefined)?.desks;
  return Array.isArray(d) ? d : [];
}

const selectData = <T,>(raw: Raw<T>): T => raw.data;

export type ErpQueryOptions<T> = {
  /** The erp_versions keys this answer is built from; a moved value refetches it. */
  desk?: string | readonly string[];
  enabled?: boolean;
  /** Check the answer's shape; throw (an ErpQueryError) to make it a failed read. */
  parse?: (data: unknown) => T;
};

export function useErpQuery<T>(
  key: string | readonly unknown[],
  path: string,
  opts: ErpQueryOptions<T> = {},
): UseQueryResult<T, Error> {
  const desks = opts.desk === undefined ? [] : typeof opts.desk === "string" ? [opts.desk] : [...opts.desk];
  const parse = opts.parse;
  return useQuery<Raw<T>, Error, T>({
    queryKey: [...(typeof key === "string" ? [key] : key), path],
    queryFn: async ({ signal }) => {
      const r = await readView<unknown>(path, { signal });
      if (!r.ok) throw new ErpQueryError(r.status, r.error);
      return { data: parse ? parse(r.data) : (r.data as T), builtFrom: r.builtFrom };
    },
    select: selectData,
    meta: { desks } satisfies DeskMeta,
    enabled: opts.enabled,
  });
}

function deskQueries(client: QueryClient): QueryDeskInfo[] {
  return client
    .getQueryCache()
    .getAll()
    .filter((q) => desksOf(q.meta).length > 0)
    .map((q) => ({
      id: q.queryHash,
      desks: desksOf(q.meta),
      builtFrom: ((q.state.data as Raw<unknown> | undefined)?.builtFrom ?? null) as Versions | null,
    }));
}

function invalidateIds(client: QueryClient, ids: readonly string[]): void {
  if (ids.length === 0) return;
  const want = new Set(ids);
  void client.invalidateQueries({ predicate: (q: Query) => want.has(q.queryHash) });
}

/** Mark every query that reads one of `desks` stale (active ones refetch now). Returns their hashes. */
export function invalidateDesks(client: QueryClient, desks: readonly string[]): string[] {
  const ids = queriesForDesks(desks, deskQueries(client));
  invalidateIds(client, ids);
  return ids;
}

// ── Mutations ──────────────────────────────────────────────────────────────

export type ErpMutationOptions<T> = {
  /** The desks this collection's writes change; their queries refetch after a confirmed write. */
  desk: string | readonly string[];
  onSaved?: (result: Extract<WriteResult<T>, { ok: true }>) => void;
  onFailed?: (result: Extract<WriteResult<T>, { ok: false }>) => void;
  savedForMs?: number;
};

/**
 * useSaveMutation ("Saved" only after the server said so) plus invalidation:
 * after a confirmed write every query reading `desk` is refetched; after a
 * conflict too — the server holds a newer row, and the screen must show it.
 */
export function useErpMutation<T>(collection: string, opts: ErpMutationOptions<T>): UseSaveMutation<T> {
  const client = useQueryClient();
  const desks = opts.desk === undefined ? [] : typeof opts.desk === "string" ? [opts.desk] : [...opts.desk];
  const desksKey = desks.join("\u0000");
  const callbacks = useRef({ onSaved: opts.onSaved, onFailed: opts.onFailed });
  useEffect(() => {
    callbacks.current = { onSaved: opts.onSaved, onFailed: opts.onFailed };
  });
  const saveOpts = useMemo(() => {
    const ds = desksKey ? desksKey.split("\u0000") : [];
    return {
      savedForMs: opts.savedForMs,
      onSaved: (r: Extract<WriteResult<T>, { ok: true }>) => {
        invalidateDesks(client, ds);
        callbacks.current.onSaved?.(r);
      },
      onFailed: (r: Extract<WriteResult<T>, { ok: false }>) => {
        if (r.kind === "conflict") invalidateDesks(client, ds);
        callbacks.current.onFailed?.(r);
      },
    };
  }, [client, desksKey, opts.savedForMs]);
  return useSaveMutation<T>(collection, saveOpts);
}

// ── The versions poll ──────────────────────────────────────────────────────

/** A mounted query that reads a desk: the poll has something to keep fresh. */
function hasDeskObservers(client: QueryClient): boolean {
  return client
    .getQueryCache()
    .getAll()
    // isActive: at least one observer is ENABLED — a control that has not
    // asked yet (useMasters({enabled:false})) does not start the poll.
    .some((q) => q.isActive() && desksOf(q.meta).length > 0);
}

/** What the poll remembers between answers: the last versions, and whether it was told to stop. */
export type PollState = { last: Versions | null; stopped: boolean };

/**
 * One poll: GET the versions, then pollOutcome — `stop` (401/403) sets
 * `state.stopped`; `keep` (503, no answer, a malformed body) changes nothing;
 * `apply` invalidates the queries queriesToInvalidate names and remembers the
 * answer. Returns the outcome and the hashes it invalidated.
 */
export async function pollVersionsOnce(
  client: QueryClient,
  state: PollState,
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = (i, n) => erpFetch(i, n),
): Promise<{ kind: PollOutcome["kind"]; invalidated: string[] }> {
  let status: number | null = null;
  let body: unknown = null;
  try {
    const res = await fetchImpl(VERSIONS_PATH, { cache: "no-store" });
    status = res.status;
    body = await res.json().catch(() => null);
  } catch {
    status = null;
  }
  const out = pollOutcome(status, body);
  if (out.kind === "stop") {
    state.stopped = true;
    return { kind: "stop", invalidated: [] };
  }
  if (out.kind !== "apply") return { kind: "keep", invalidated: [] };
  const stale = queriesToInvalidate(state.last, out.versions, deskQueries(client));
  state.last = out.versions;
  invalidateIds(client, stale);
  return { kind: "apply", invalidated: stale };
}

/**
 * Poll GET /api/data/views/versions while `enabled`: at once (unless the last
 * poll was under 5 s ago), every 20 s, and when the tab is shown again —
 * never while it is hidden. Each answer goes through pollOutcome /
 * queriesToInvalidate (./queryKernel). The last answer is kept across
 * pauses, so a desk that moved while nothing was mounted is caught by the
 * first poll after.
 */
export function useVersionsPoll(enabled: boolean): void {
  const client = useQueryClient();
  const state = useRef<PollState>({ last: null, stopped: false });
  const lastPollAt = useRef(0);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!enabled || state.current.stopped) return;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      if (state.current.stopped || inFlight.current) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (Date.now() - lastPollAt.current < VERSIONS_MIN_GAP_MS) return;
      inFlight.current = true;
      lastPollAt.current = Date.now();
      try {
        const out = await pollVersionsOnce(client, state.current);
        if (out.kind === "stop" && timer) clearInterval(timer);
      } finally {
        inFlight.current = false;
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    void tick();
    timer = setInterval(() => void tick(), VERSIONS_POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, client]);
}

/** Runs the poll exactly while some mounted query reads a desk. */
function VersionsPoller() {
  const client = useQueryClient();
  const [active, setActive] = useState(false);
  useEffect(() => {
    let alive = true;
    const update = () => {
      if (alive) setActive(hasDeskObservers(client));
    };
    update();
    const unsubscribe = client.getQueryCache().subscribe((e) => {
      if (
        e.type === "observerAdded" ||
        e.type === "observerRemoved" ||
        e.type === "observerOptionsUpdated" ||
        e.type === "added" ||
        e.type === "removed"
      ) {
        // Not inside React Query's own notification: after it.
        queueMicrotask(update);
      }
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [client]);
  useVersionsPoll(active);
  return null;
}

// ── The reference views ────────────────────────────────────────────────────

/**
 * Each masters answer, checked (parseMastersView — a malformed one is a failed
 * read) and then bridged into the tab's page-memory copy for the lib/
 * readers that still call loadMasters (lib/data/client/mastersBridge; the
 * bridge goes in 2.3b). Runs once per fetch, inside the query function — not
 * per mounted screen. Exported for its self-test.
 */
export function acceptMastersAnswer(data: unknown, deps: MastersBridgeDeps | null = pageMemoryBridgeDeps()): MastersView {
  const view = parseMastersView(data);
  if (deps) bridgeMastersToPageMemory(view, deps);
  return view;
}

function pageMemoryBridgeDeps(): MastersBridgeDeps | null {
  // Only a browser tab has a page copy to keep in step.
  if (typeof window === "undefined") return null;
  // The stored copy as it is (not the normalised loadMasters read, which
  // would persist read-time fill-ins); a tab with no copy yet starts from the
  // empty shell, which the answer's book then fills.
  return { load: () => readMastersPageCopyRaw() ?? emptyMastersShell(), write: writeMastersLocalRaw };
}

/**
 * Masters (full, or the teaching subset — `scope` says which). Read-only.
 * `enabled: false` asks nothing (an always-mounted control that reads Masters
 * only once opened — the header WhatsApp button); an answer another screen
 * already cached is still returned.
 */
export function useMasters(opts: { enabled?: boolean } = {}): UseQueryResult<MastersView, Error> {
  return useErpQuery<MastersView>("masters", "/api/data/views/masters", {
    desk: ["masters"],
    parse: (d) => acceptMastersAnswer(d),
    enabled: opts.enabled,
  });
}

/** The staff directory: no phone, Aadhaar, salary or password, ever. Read-only. */
export function useStaffList(): UseQueryResult<StaffListView, Error> {
  return useErpQuery<StaffListView>("staff-list", "/api/data/views/staff-list", {
    desk: ["sis_staff", "sis_departments", "sis_designations"],
  });
}

/** Roles & permissions (your own rows unless you hold Settings view). Read-only. */
export function useRbac(): UseQueryResult<RbacView, Error> {
  return useErpQuery<RbacView>("rbac", "/api/data/views/rbac", { desk: ["rbac", "rbac_state"] });
}

/** Which modules the school switched on. Read-only. */
export function useModuleRegistry(): UseQueryResult<ModuleRegistryView, Error> {
  return useErpQuery<ModuleRegistryView>("module-registry", "/api/data/views/module-registry", {
    desk: ["module_registry"],
  });
}
