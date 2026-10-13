/**
 * A per-process copy of one piece of reference data (Masters, RBAC, …),
 * rebuilt only when the database says it changed (data-layer 1.3, rule R5).
 *
 *   const masters = referenceCache("masters", ["masters", "sis_staff"], build);
 *   const r = await masters.read();   // {ok:true, value, stale, from} | {ok:false, error}
 *
 * The rules, each with a test (referenceCache.selftest.ts):
 *  - Keyed on the erp_versions values of `deskKeys` (lib/data/server/versions.ts),
 *    never on a wall clock: no change = no rebuild, however long; a moved value
 *    = exactly one rebuild. Every cache shares one versions read per 2 s window.
 *  - The versions are read BEFORE the build starts, so a write that lands
 *    while a build runs can only make the copy newer than its key — the next
 *    read then rebuilds once more; it can never leave an old copy under a new key.
 *  - Concurrent reads that need the same rebuild share it (in-flight dedupe).
 *  - A failed rebuild keeps the previous value and returns it with
 *    `stale: true`; its key is not moved on, so the next read tries again.
 *    With no previous value the read is `{ok:false}` (callers answer 503).
 *    A failed read is never stored — not as empty, not as anything.
 *  - A build may fail with a `fallback`: a degraded answer to give when there
 *    is no previous value (e.g. Masters without the staff roster). It is
 *    returned with `stale: true` and never stored.
 *  - When the versions themselves cannot be read, the copy cannot be proven
 *    current: it is rebuilt at most once per versions snapshot (one per 2 s
 *    window), and a failed rebuild keeps the previous value as above.
 *  - `invalidate()` drops the value (a write this process made has outdated
 *    it): the next read rebuilds, and a build that started before the
 *    invalidation is returned to its own callers but not stored.
 */
// Server code, but no `import "server-only"`: lib/api/v1/auth.ts imports this,
// and many self-tests import auth.ts under plain tsx.
import { forgetErpVersions, readErpVersions, type VersionsSnapshot } from "./versions";

export type BuildResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; fallback?: T };

export type CacheRead<T> =
  | {
      ok: true;
      value: T;
      /** true = not proven current: a failed rebuild's previous value, or a build's fallback. */
      stale: boolean;
      from: "cache" | "rebuild" | "previous" | "fallback";
    }
  | { ok: false; error: string };

export type ReferenceCache<T> = {
  readonly name: string;
  read(): Promise<CacheRead<T>>;
  /** Force the next read to rebuild (after a write this process made). */
  invalidate(): void;
  /** How many builds have run — for tests and logs. */
  readonly builds: number;
};

export type ReferenceCacheOptions = {
  /** Where the versions come from — the shared erp_versions read unless a test injects one. */
  versions?: () => Promise<VersionsSnapshot>;
  /** Called by invalidate() so the rebuild records post-write versions. Default forgetErpVersions. */
  forgetVersions?: () => void;
};

type Entry<T> = {
  value: T;
  /** The deskKeys' versions this value was built under; null = built while versions were unknown. */
  key: string | null;
  /** Snapshot seq the value was built under when versions were unknown. */
  unknownSeq: number;
  /** Build order: a later-started build wins over an earlier one. */
  order: number;
};

function keyOf(snap: VersionsSnapshot, deskKeys: readonly string[]): string | null {
  if (!snap.ok) return null;
  return JSON.stringify(deskKeys.map((k) => snap.versions[k] ?? null));
}

function movedKeys(prev: string | null, next: string | null, deskKeys: readonly string[]): string[] {
  if (prev === null || next === null) return [];
  const a = JSON.parse(prev) as unknown[];
  const b = JSON.parse(next) as unknown[];
  return deskKeys.filter((_, i) => JSON.stringify(a[i]) !== JSON.stringify(b[i]));
}

export function referenceCache<T>(
  name: string,
  deskKeys: readonly string[],
  build: () => Promise<BuildResult<T>>,
  opts: ReferenceCacheOptions = {},
): ReferenceCache<T> {
  const versions = opts.versions ?? readErpVersions;
  const forgetVersions = opts.forgetVersions ?? forgetErpVersions;
  let entry: Entry<T> | null = null;
  let generation = 0;
  let order = 0;
  let builds = 0;
  /** At most one build per (generation, key); readers of the same key join it. */
  let running: { generation: number; key: string | null; seq: number; p: Promise<CacheRead<T>> } | null = null;

  function current(snap: VersionsSnapshot, key: string | null): boolean {
    if (!entry) return false;
    if (snap.ok) return entry.key !== null && entry.key === key;
    return entry.key === null && entry.unknownSeq === snap.seq;
  }

  function startBuild(snap: VersionsSnapshot, key: string | null): Promise<CacheRead<T>> {
    const gen = generation;
    const myOrder = ++order;
    const prevKey = entry?.key ?? null;
    const reason = !entry
      ? "cold"
      : !snap.ok
        ? "versions unknown"
        : prevKey === null
          ? "versions back"
          : `moved: ${movedKeys(prevKey, key, deskKeys).join(", ") || "?"}`;
    builds++;
    const p = (async (): Promise<CacheRead<T>> => {
      let res: BuildResult<T>;
      try {
        res = await build();
      } catch (e) {
        res = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      if (res.ok) {
        if (gen === generation && (!entry || myOrder > entry.order)) {
          entry = { value: res.value, key, unknownSeq: snap.ok ? -1 : snap.seq, order: myOrder };
        }
        console.log(`[reference-cache] ${name} rebuilt (${reason})`);
        return { ok: true, value: res.value, stale: false, from: "rebuild" };
      }
      const prev = gen === generation ? entry : null;
      if (prev) {
        console.error(`[reference-cache] ${name} rebuild failed (${res.error}) — serving the previous copy, stale`);
        return { ok: true, value: prev.value, stale: true, from: "previous" };
      }
      if (res.fallback !== undefined) {
        console.error(`[reference-cache] ${name} rebuild failed (${res.error}) and there is no copy — fallback served, not stored`);
        return { ok: true, value: res.fallback, stale: true, from: "fallback" };
      }
      console.error(`[reference-cache] ${name} rebuild failed (${res.error}) and there is no copy`);
      return { ok: false, error: res.error };
    })();
    const handle = { generation: gen, key, seq: snap.seq, p };
    running = handle;
    void p.finally(() => {
      if (running === handle) running = null;
    });
    return p;
  }

  return {
    name,
    get builds() {
      return builds;
    },
    async read(): Promise<CacheRead<T>> {
      const snap = await versions();
      const key = keyOf(snap, deskKeys);
      if (entry && current(snap, key)) {
        return { ok: true, value: entry.value, stale: false, from: "cache" };
      }
      if (
        running &&
        running.generation === generation &&
        (snap.ok ? running.key !== null && running.key === key : running.key === null && running.seq === snap.seq)
      ) {
        return running.p;
      }
      return startBuild(snap, key);
    },
    invalidate(): void {
      entry = null;
      generation++;
      forgetVersions();
    },
  };
}
