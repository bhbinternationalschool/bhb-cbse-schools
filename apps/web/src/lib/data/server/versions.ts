/**
 * The one change signal, read on the server (data-layer 1.3, rule R3).
 *
 * `erp_versions(p_tenant)` (supabase/migrations/20261013120000_erp_versions.sql)
 * answers, in one round trip, `{ <key>: { updated_at, count } }` for every
 * desk: each *_sync_meta table, the staff row tables, masters_desk_settings,
 * each module_local_state book ("module_state:<key>") and each *_state blob.
 *
 * One read per tenant per VERSIONS_TTL_MS, shared by everything in this
 * process: GET /api/data/views/versions and every referenceCache
 * (lib/data/server/referenceCache.ts) read the same snapshot, so a poll costs
 * the database at most one call per window however many caches and callers
 * ask. Concurrent callers share the in-flight call.
 *
 * Unknown is not empty (R6): a failed call is `{ok:false}` — never `{}` —
 * and that answer is held for the same window, so an outage costs one call
 * per window too, not one per request.
 */
import "server-only";

import { getServerTenantContext } from "@/lib/serverTenant";

export const VERSIONS_TTL_MS = 2_000;

export type DeskVersion = { updated_at: string | null; count: number | null };
export type ErpVersions = Record<string, DeskVersion>;

export type VersionsSnapshot =
  | {
      ok: true;
      versions: ErpVersions;
      /** When the database answered (ISO). */
      at: string;
      /** Increases with every call this process makes; identifies the snapshot. */
      seq: number;
    }
  | { ok: false; error: string; seq: number };

type Held = { at: number; snap: VersionsSnapshot };

const held = new Map<string, Held>();
const inFlight = new Map<string, { generation: number; p: Promise<VersionsSnapshot> }>();
let seq = 0;
/** Bumped by forgetErpVersions: a call started before it is neither held nor joined after it. */
let generation = 0;

/** No tenant (no database configured, or the tenant lookup failed) shares one slot. */
const NO_TENANT = "(no tenant)";

function isVersions(v: unknown): v is ErpVersions {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  for (const x of Object.values(v as Record<string, unknown>)) {
    if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  }
  return true;
}

async function callOnce(): Promise<{ key: string; snap: VersionsSnapshot }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { key: NO_TENANT, snap: { ok: false, error: "tenant unavailable", seq: ++seq } };
  try {
    const { data, error } = await ctx.sb.rpc("erp_versions", { p_tenant: ctx.tenantId });
    if (error) return { key: ctx.tenantId, snap: { ok: false, error: error.message, seq: ++seq } };
    if (!isVersions(data)) {
      return { key: ctx.tenantId, snap: { ok: false, error: "erp_versions returned no object", seq: ++seq } };
    }
    return {
      key: ctx.tenantId,
      snap: { ok: true, versions: data, at: new Date().toISOString(), seq: ++seq },
    };
  } catch (e) {
    return { key: ctx.tenantId, snap: { ok: false, error: e instanceof Error ? e.message : String(e), seq: ++seq } };
  }
}

/** The tenant this process serves, without a network call once it is known. */
async function tenantKey(): Promise<string> {
  const ctx = await getServerTenantContext().catch(() => null);
  return ctx?.tenantId ?? NO_TENANT;
}

/**
 * The current versions snapshot for this process's tenant: from the shared
 * window when one is held, else one `erp_versions` call (shared with any
 * concurrent caller).
 */
export async function readErpVersions(): Promise<VersionsSnapshot> {
  const key = await tenantKey();
  const h = held.get(key);
  if (h && Date.now() - h.at < VERSIONS_TTL_MS) return h.snap;
  const running = inFlight.get(key);
  if (running && running.generation === generation) return running.p;
  const gen = generation;
  const p = (async () => {
    const startedAt = Date.now();
    const { key: answeredFor, snap } = await callOnce();
    if (gen === generation) held.set(answeredFor, { at: startedAt, snap });
    if (!snap.ok) console.error(`[erp-versions] read failed: ${snap.error}`);
    return snap;
  })().finally(() => {
    if (inFlight.get(key)?.p === p) inFlight.delete(key);
  });
  inFlight.set(key, { generation: gen, p });
  return p;
}

/**
 * Drop the held snapshot, so the next read asks the database. Called when a
 * reference cache is invalidated by a write this process just made: the
 * rebuild that follows must record the versions AFTER that write.
 */
export function forgetErpVersions(): void {
  generation++;
  held.clear();
}
