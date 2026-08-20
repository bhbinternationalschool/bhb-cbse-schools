import "server-only";

/**
 * Egress guard (2026-08-20): before any multi-MB desk pull from Supabase,
 * ask the `desk_probe` SQL function for a ~200-byte fingerprint of the
 * source tables (row count + max updated_at each). Unchanged fingerprint →
 * serve the in-memory copy / skip the pull entirely. Changed → pull as
 * before and remember the new fingerprint.
 *
 * Fail-open by design: any probe error just means "pull like it's 2026-08-19".
 * Freshness is BETTER than before, not worse — the probe runs per request,
 * so a real change is picked up immediately instead of after a TTL.
 */

import { getServerTenantContext } from "@/lib/serverTenant";

const PROBE_MIN_INTERVAL_MS = 5_000;

type ProbeEntry = { probe: string; at: number };
const probeCache = new Map<string, ProbeEntry>();

/** Fingerprint of the given tables, or null when unavailable (fail open). */
export async function deskProbe(tables: string[], cacheKey?: string): Promise<string | null> {
  const key = cacheKey || tables.join(",");
  const cached = probeCache.get(key);
  const now = Date.now();
  // A burst of requests within a few seconds shares one probe round-trip.
  if (cached && now - cached.at < PROBE_MIN_INTERVAL_MS) return cached.probe;
  try {
    const ctx = await getServerTenantContext();
    if (!ctx) return null;
    const { data, error } = await ctx.sb.rpc("desk_probe", { p_tenant: ctx.tenantId, p_tables: tables });
    if (error || typeof data !== "string" || !data) return null;
    probeCache.set(key, { probe: data, at: now });
    return data;
  } catch {
    return null;
  }
}

/* ─── Response cache for GET desk routes ───────────────────────────── */

type CacheEntry = { probe: string; body: string; etag: string; builtAt: number };
const responseCache = new Map<string, CacheEntry>();
const RESPONSE_CACHE_MAX = 80;

export type CachedDeskResult =
  | { kind: "not_modified"; etag: string }
  | { kind: "hit" | "built" | "uncached"; body: string; etag: string | null };

/**
 * Serve a GET desk route with probe-gated caching.
 *  - probe unchanged + cached body → no Supabase row pull (hit / 304).
 *  - probe changed / no cache / probe unavailable → build() runs exactly as
 *    the route always did.
 */
export async function cachedDeskJson(opts: {
  cacheKey: string;
  tables: string[];
  ifNoneMatch?: string | null;
  build: () => Promise<unknown>;
}): Promise<CachedDeskResult> {
  const probe = await deskProbe(opts.tables, `probe:${opts.cacheKey}`);
  if (probe) {
    const cached = responseCache.get(opts.cacheKey);
    if (cached && cached.probe === probe) {
      if (opts.ifNoneMatch && opts.ifNoneMatch === cached.etag) {
        return { kind: "not_modified", etag: cached.etag };
      }
      return { kind: "hit", body: cached.body, etag: cached.etag };
    }
  }
  const payload = await opts.build();
  const body = JSON.stringify(payload);
  if (probe) {
    const etag = `"${probe}"`;
    if (responseCache.size >= RESPONSE_CACHE_MAX) {
      // Drop the oldest entry — tiny LRU without a dependency.
      let oldestKey = "";
      let oldestAt = Infinity;
      for (const [k, v] of responseCache) {
        if (v.builtAt < oldestAt) {
          oldestAt = v.builtAt;
          oldestKey = k;
        }
      }
      if (oldestKey) responseCache.delete(oldestKey);
    }
    responseCache.set(opts.cacheKey, { probe, body, etag, builtAt: Date.now() });
    if (opts.ifNoneMatch && opts.ifNoneMatch === etag) return { kind: "not_modified", etag };
    return { kind: "built", body, etag };
  }
  return { kind: "uncached", body, etag: null };
}

/** Standard Response from a CachedDeskResult. */
export function deskJsonResponse(r: CachedDeskResult): Response {
  if (r.kind === "not_modified") {
    return new Response(null, { status: 304, headers: { ETag: r.etag, "Cache-Control": "private, no-cache" } });
  }
  const headers: Record<string, string> = { "Content-Type": "application/json", "Cache-Control": "private, no-cache" };
  if (r.etag) headers.ETag = r.etag;
  headers["X-Desk-Cache"] = r.kind;
  return new Response(r.body, { status: 200, headers });
}

/** Test/ops hook. */
export function clearDeskProbeCaches(): void {
  probeCache.clear();
  responseCache.clear();
}

/* ─── Single-row blob cache (domain blobs, server blobs) ───────────── */

type BlobEntry = { updatedAt: string; body: string; etag: string };
const blobCache = new Map<string, BlobEntry>();

/**
 * Serve a one-row-per-tenant blob GET: a tiny `updated_at` select decides
 * whether the cached body is still current — the multi-KB/MB state column
 * is pulled only when the row actually changed.
 */
export async function cachedBlobJson(opts: {
  table: string;
  ifNoneMatch?: string | null;
  build: () => Promise<{ payload: unknown; updatedAt: string }>;
}): Promise<CachedDeskResult> {
  try {
    const ctx = await getServerTenantContext();
    if (ctx) {
      const { data } = await ctx.sb.from(opts.table).select("updated_at").eq("tenant_id", ctx.tenantId).maybeSingle();
      const updatedAt = data?.updated_at ? String(data.updated_at) : "";
      const cached = blobCache.get(opts.table);
      if (updatedAt && cached && cached.updatedAt === updatedAt) {
        if (opts.ifNoneMatch && opts.ifNoneMatch === cached.etag) return { kind: "not_modified", etag: cached.etag };
        return { kind: "hit", body: cached.body, etag: cached.etag };
      }
      const { payload, updatedAt: builtAt } = await opts.build();
      const body = JSON.stringify(payload);
      const stamp = builtAt || updatedAt;
      if (stamp) {
        const etag = `"blob-${opts.table}-${stamp}"`;
        blobCache.set(opts.table, { updatedAt: stamp, body, etag });
        if (opts.ifNoneMatch && opts.ifNoneMatch === etag) return { kind: "not_modified", etag };
        return { kind: "built", body, etag };
      }
      return { kind: "uncached", body, etag: null };
    }
  } catch {
    /* fall through to uncached build */
  }
  const { payload } = await opts.build();
  return { kind: "uncached", body: JSON.stringify(payload), etag: null };
}

