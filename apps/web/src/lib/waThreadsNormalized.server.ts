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

  const { data: existing } = await sb
    .from("wa_desk_bot_slices")
    .select("slice_key")
    .eq("tenant_id", tenantId);
  const keep = new Set(rows.map((r) => String(r.slice_key)));
  const stale = (existing ?? [])
    .map((r) => String((r as { slice_key: string }).slice_key))
    .filter((k) => !keep.has(k));
  if (stale.length > 0) {
    await sb
      .from("wa_desk_bot_slices")
      .delete()
      .eq("tenant_id", tenantId)
      .in("slice_key", stale);
  }

  if (rows.length > 0) {
    const { error } = await sb.from("wa_desk_bot_slices").upsert(rows);
    if (error) return { ok: false, error: error.message };
  } else {
    await sb.from("wa_desk_bot_slices").delete().eq("tenant_id", tenantId);
  }

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
}> {
  const ctx = await resolveCtx();
  const empty = emptyBundle();
  if (!ctx) return { bundle: empty, meta: null };
  const { sb, tenantId } = ctx;

  const [{ data: sliceRows }, { data: metaRow }] = await Promise.all([
    sb.from("wa_desk_bot_slices").select("*").eq("tenant_id", tenantId),
    sb
      .from("wa_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

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
