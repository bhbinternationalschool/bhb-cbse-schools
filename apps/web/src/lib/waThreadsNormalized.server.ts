/**
 * WhatsApp bot threads desk — Supabase slice rows (wa_desk_bot_slices).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WaBotPersistBundle } from "@/lib/waBotStore.server";
import { waThreadsDualWriteDbEnabled } from "@/lib/waThreadsDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";

export type WaBotSliceKey = keyof Pick<
  WaBotPersistBundle,
  | "crm"
  | "sis"
  | "survey"
  | "classChannel"
  | "unified"
  | "hub"
  | "staffAtt"
  | "complaints"
  | "commands"
  | "tutor"
>;

export const WA_BOT_SLICE_KEYS: WaBotSliceKey[] = [
  "crm",
  "sis",
  "survey",
  "classChannel",
  "unified",
  "hub",
  "staffAtt",
  "complaints",
  "commands",
  "tutor",
];

export type WaThreadsDeskSyncMeta = {
  sliceCount: number;
  threadCount: number;
  lastUpdatedAt: string | null;
  updatedAt: string;
};

export type WaThreadsDeskBundle = WaBotPersistBundle;

const META_SELECT = "slice_count, thread_count, last_updated_at, updated_at";

async function resolveCtx(): Promise<{
  sb: SupabaseClient;
  tenantId: string;
} | null> {
  return getServerTenantContext();
}

function nowIso() {
  return new Date().toISOString();
}

function emptyBundle(): WaBotPersistBundle {
  return {
    version: 1,
    updatedAt: nowIso(),
    crm: null,
    sis: null,
    survey: null,
    classChannel: null,
    unified: null,
    hub: null,
    staffAtt: null,
    complaints: null,
    commands: null,
    tutor: null,
  };
}

function countThreadsInPayload(payload: unknown): number {
  if (!payload || typeof payload !== "object") return 0;
  const p = payload as Record<string, unknown>;
  if (Array.isArray(p.threads)) return p.threads.length;
  if (p.threads && typeof p.threads === "object" && !Array.isArray(p.threads)) {
    return Object.keys(p.threads as object).length;
  }
  return 0;
}

function countThreadsInBundle(bundle: WaBotPersistBundle): number {
  let n = 0;
  for (const key of WA_BOT_SLICE_KEYS) {
    n += countThreadsInPayload(bundle[key]);
  }
  return n;
}

/**
 * Write ONE bot slice. saveWaBotSlice used to push the whole bundle for a
 * change to one slice: a prune SELECT, eight upserts and the sync meta, per
 * WhatsApp message. On 2026-09-29, when ~15 staff messaged the bot while
 * signing in to the ERP, that was ~1,400 writes in five minutes on the same
 * one-CPU web server the staff were waiting on. One slice, one upsert.
 */
export async function pushWaThreadsSliceToDb(
  key: WaBotSliceKey,
  payload: unknown,
  bundle: WaBotPersistBundle,
): Promise<{ ok: boolean; error?: string }> {
  if (!waThreadsDualWriteDbEnabled()) return { ok: true };
  if (payload == null) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = nowIso();
  const { error } = await sb.from("wa_desk_bot_slices").upsert({
    tenant_id: tenantId,
    slice_key: key,
    payload,
    updated_at: now,
  });
  if (error) {
    console.error("[wa-threads] slice upsert FAILED", key, error.message);
    return { ok: false, error: `${key}: ${error.message}` };
  }
  await sb.from("wa_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      slice_count: WA_BOT_SLICE_KEYS.filter((k) => bundle[k] != null).length,
      thread_count: countThreadsInBundle(bundle),
      last_updated_at: bundle.updatedAt || now,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );
  return { ok: true };
}

export async function pushWaThreadsDeskToDb(
  bundle: WaBotPersistBundle,
): Promise<{ ok: boolean; error?: string }> {
  if (!waThreadsDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = nowIso();

  const rows: Record<string, unknown>[] = [];
  for (const key of WA_BOT_SLICE_KEYS) {
    const payload = bundle[key];
    if (payload == null) continue;
    rows.push({
      tenant_id: tenantId,
      slice_key: key,
      payload,
      updated_at: now,
    });
  }

  // No prune. A slice this bundle does not carry is a slice it does not hold
  // — not a conversation history to delete. This deleted every slice the
  // bundle lacked, and wiped the table when it carried none.
  if (rows.length > 0) {
    // One upsert per slice, not one for the bundle. On 2026-09-04 and again
    // on 2026-09-11 a single slice the table would not accept (a CHECK that
    // lagged the code) made the bundle upsert fail as a whole, and every
    // bot conversation stopped persisting until somebody noticed. A bad
    // slice must cost that slice, not the school's WhatsApp history.
    const failed: string[] = [];
    for (const row of rows) {
      const { error } = await sb.from("wa_desk_bot_slices").upsert(row);
      if (error) {
        failed.push(`${String(row.slice_key)}: ${error.message}`);
        console.error("[wa-threads] slice upsert FAILED", row.slice_key, error.message);
      }
    }
    if (failed.length === rows.length) return { ok: false, error: failed.join(" · ") };
    if (failed.length) console.error("[wa-threads] bundle saved WITHOUT", failed.join(" · "));
  }

  if (rows.length === 0) return { ok: true };
  const threadCount = countThreadsInBundle(bundle);
  await sb.from("wa_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      slice_count: rows.length,
      thread_count: threadCount,
      last_updated_at: bundle.updatedAt || now,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true };
}

export async function fetchWaThreadsDeskFromDb(): Promise<{
  bundle: WaThreadsDeskBundle;
  meta: WaThreadsDeskSyncMeta | null;
  /** false = the read failed; the bundle is NOT a confirmed empty desk. */
  ok: boolean;
}> {
  const ctx = await resolveCtx();
  const empty = emptyBundle();
  if (!ctx) return { bundle: empty, meta: null, ok: false };
  const { sb, tenantId } = ctx;

  const [{ data: sliceRows, error: sliceErr }, { data: metaRow, error: metaErr }] = await Promise.all([
    sb.from("wa_desk_bot_slices").select("*").eq("tenant_id", tenantId),
    sb
      .from("wa_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  // A failed read used to come back as an empty bundle, indistinguishable
  // from a desk with no conversations.
  if (sliceErr || metaErr) {
    console.error("[wa-threads] fetch failed", sliceErr?.message, metaErr?.message);
    return { bundle: empty, meta: null, ok: false };
  }

  const bundle: WaBotPersistBundle = { ...empty };
  let latestAt = "";
  for (const row of sliceRows ?? []) {
    const r = row as {
      slice_key: string;
      payload: unknown;
      updated_at: string;
    };
    const key = r.slice_key as WaBotSliceKey;
    if (!WA_BOT_SLICE_KEYS.includes(key)) continue;
    bundle[key] = r.payload ?? null;
    const at = String(r.updated_at || "");
    if (at > latestAt) latestAt = at;
  }
  bundle.updatedAt = latestAt || metaRow?.updated_at || nowIso();

  return {
    ok: true,
    bundle,
    meta: metaRow
      ? {
          sliceCount: (metaRow as { slice_count: number }).slice_count,
          threadCount: (metaRow as { thread_count: number }).thread_count,
          lastUpdatedAt: (metaRow as { last_updated_at: string | null })
            .last_updated_at,
          updatedAt: String((metaRow as { updated_at: string }).updated_at),
        }
      : null,
  };
}
