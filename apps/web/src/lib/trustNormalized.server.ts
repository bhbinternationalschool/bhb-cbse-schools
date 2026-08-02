/**
 * Trust desk — Supabase slice rows (trust_desk_slices).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TrustState } from "@/lib/trust";
import { trustDualWriteDbEnabled } from "@/lib/trustDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";

export type TrustSliceKey = keyof Omit<TrustState, "version">;

export const TRUST_SLICE_KEYS: TrustSliceKey[] = [
  "projects",
  "workItems",
  "materials",
  "labourEntries",
  "allotments",
  "contractors",
  "workOrders",
  "raBills",
  "costLines",
  "rateCard",
];

export type TrustDeskSyncMeta = {
  sliceCount: number;
  projectCount: number;
  workItemCount: number;
  lastUpdatedAt: string | null;
  updatedAt: string;
};

export type TrustDeskBundle = Omit<TrustState, "version">;

const META_SELECT =
  "slice_count, project_count, work_item_count, last_updated_at, updated_at";

async function resolveCtx(): Promise<{
  sb: SupabaseClient;
  tenantId: string;
} | null> {
  return getServerTenantContext();
}

function nowIso() {
  return new Date().toISOString();
}

function emptyBundle(): TrustDeskBundle {
  return {
    projects: [],
    workItems: [],
    materials: [],
    labourEntries: [],
    allotments: [],
    contractors: [],
    workOrders: [],
    raBills: [],
    costLines: [],
    rateCard: [],
  };
}

function stateToSlices(state: TrustState): { key: TrustSliceKey; payload: unknown }[] {
  return TRUST_SLICE_KEYS.map((key) => ({
    key,
    payload: state[key] ?? [],
  }));
}

function slicesToBundle(
  sliceMap: Partial<Record<TrustSliceKey, unknown>>,
): TrustDeskBundle {
  const empty = emptyBundle();
  const bundle = { ...empty };
  for (const key of TRUST_SLICE_KEYS) {
    const payload = sliceMap[key];
    if (Array.isArray(payload)) {
      (bundle as Record<string, unknown>)[key] = payload;
    }
  }
  return bundle;
}

export async function pushTrustDeskToDb(
  state: TrustState,
): Promise<{ ok: boolean; error?: string }> {
  if (!trustDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = nowIso();
  const slices = stateToSlices(state);

  const rows = slices
    .filter((s) => Array.isArray(s.payload) && s.payload.length > 0)
    .map(({ key, payload }) => ({
      tenant_id: tenantId,
      slice_key: key,
      payload,
      updated_at: now,
    }));

  const { data: existing } = await sb
    .from("trust_desk_slices")
    .select("slice_key")
    .eq("tenant_id", tenantId);
  const keep = new Set<string>(rows.map((r) => String(r.slice_key)));
  const stale = (existing ?? [])
    .map((r) => String((r as { slice_key: string }).slice_key))
    .filter((k) => !keep.has(k));
  if (stale.length > 0) {
    await sb
      .from("trust_desk_slices")
      .delete()
      .eq("tenant_id", tenantId)
      .in("slice_key", stale);
  }

  if (rows.length > 0) {
    const { error } = await sb.from("trust_desk_slices").upsert(rows);
    if (error) return { ok: false, error: error.message };
  } else {
    await sb.from("trust_desk_slices").delete().eq("tenant_id", tenantId);
  }

  await sb.from("trust_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      slice_count: rows.length,
      project_count: state.projects?.length ?? 0,
      work_item_count: state.workItems?.length ?? 0,
      last_updated_at: now,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true };
}

export async function fetchTrustDeskFromDb(): Promise<{
  bundle: TrustDeskBundle;
  meta: TrustDeskSyncMeta | null;
}> {
  const ctx = await resolveCtx();
  const empty = emptyBundle();
  if (!ctx) return { bundle: empty, meta: null };
  const { sb, tenantId } = ctx;

  const [{ data: sliceRows }, { data: metaRow }] = await Promise.all([
    sb.from("trust_desk_slices").select("*").eq("tenant_id", tenantId),
    sb
      .from("trust_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  const sliceMap: Partial<Record<TrustSliceKey, unknown>> = {};
  for (const row of sliceRows ?? []) {
    const r = row as { slice_key: string; payload: unknown };
    const key = r.slice_key as TrustSliceKey;
    if (TRUST_SLICE_KEYS.includes(key)) sliceMap[key] = r.payload;
  }

  const bundle = slicesToBundle(sliceMap);

  const meta: TrustDeskSyncMeta | null = metaRow
    ? {
        sliceCount: Number(metaRow.slice_count ?? 0),
        projectCount: Number(metaRow.project_count ?? bundle.projects.length),
        workItemCount: Number(
          metaRow.work_item_count ?? bundle.workItems.length,
        ),
        lastUpdatedAt: metaRow.last_updated_at
          ? String(metaRow.last_updated_at)
          : null,
        updatedAt: String(metaRow.updated_at || ""),
      }
    : null;

  return { bundle, meta };
}
