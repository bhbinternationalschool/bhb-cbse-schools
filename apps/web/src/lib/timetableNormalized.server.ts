/**
 * Timetable desk — Supabase slice rows (timetable_desk_slices).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TimetableState } from "@/lib/timetable";
import { timetableDualWriteDbEnabled } from "@/lib/timetableDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";

export type TimetableSliceKey =
  | "config"
  | "grids"
  | "publishedGrids"
  | "substitutions";

export const TIMETABLE_SLICE_KEYS: TimetableSliceKey[] = [
  "config",
  "grids",
  "publishedGrids",
  "substitutions",
];

export type TimetableDeskSyncMeta = {
  sliceCount: number;
  gridCount: number;
  publishedGridCount: number;
  substitutionCount: number;
  lastUpdatedAt: string | null;
  updatedAt: string;
};

export type TimetableDeskBundle = Pick<
  TimetableState,
  | "workingWeekdays"
  | "bellTemplate"
  | "grids"
  | "publishedGrids"
  | "substitutions"
  | "meta"
>;

const META_SELECT =
  "slice_count, grid_count, published_grid_count, substitution_count, last_updated_at, updated_at";

async function resolveCtx(): Promise<{
  sb: SupabaseClient;
  tenantId: string;
} | null> {
  return getServerTenantContext();
}

function nowIso() {
  return new Date().toISOString();
}

function emptyBundle(): TimetableDeskBundle {
  return {
    workingWeekdays: [],
    bellTemplate: [],
    grids: [],
    publishedGrids: [],
    substitutions: [],
    meta: {
      status: "draft",
      publishedAt: "",
      publishedBy: "",
      generatedAt: "",
      solverStats: null,
    },
  };
}

function stateToSlices(state: TimetableState): {
  key: TimetableSliceKey;
  payload: unknown;
}[] {
  const slices: { key: TimetableSliceKey; payload: unknown }[] = [
    {
      key: "config",
      payload: {
        workingWeekdays: state.workingWeekdays ?? [],
        bellTemplate: state.bellTemplate ?? [],
        meta: state.meta ?? emptyBundle().meta,
      },
    },
    { key: "grids", payload: state.grids ?? [] },
    { key: "publishedGrids", payload: state.publishedGrids ?? [] },
    { key: "substitutions", payload: state.substitutions ?? [] },
  ];
  return slices;
}

function slicesToBundle(
  sliceMap: Partial<Record<TimetableSliceKey, unknown>>,
): TimetableDeskBundle {
  const empty = emptyBundle();
  const config =
    sliceMap.config && typeof sliceMap.config === "object"
      ? (sliceMap.config as {
          workingWeekdays?: number[];
          bellTemplate?: TimetableDeskBundle["bellTemplate"];
          meta?: TimetableDeskBundle["meta"];
        })
      : null;
  return {
    workingWeekdays: Array.isArray(config?.workingWeekdays)
      ? config.workingWeekdays
      : empty.workingWeekdays,
    bellTemplate: Array.isArray(config?.bellTemplate)
      ? config.bellTemplate
      : empty.bellTemplate,
    meta: config?.meta ?? empty.meta,
    grids: Array.isArray(sliceMap.grids)
      ? (sliceMap.grids as TimetableDeskBundle["grids"])
      : [],
    publishedGrids: Array.isArray(sliceMap.publishedGrids)
      ? (sliceMap.publishedGrids as TimetableDeskBundle["publishedGrids"])
      : [],
    substitutions: Array.isArray(sliceMap.substitutions)
      ? (sliceMap.substitutions as TimetableDeskBundle["substitutions"])
      : [],
  };
}

export async function pushTimetableDeskToDb(
  state: TimetableState,
): Promise<{ ok: boolean; error?: string }> {
  if (!timetableDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = nowIso();
  const slices = stateToSlices(state);

  const rows = slices.map(({ key, payload }) => ({
    tenant_id: tenantId,
    slice_key: key,
    payload,
    updated_at: now,
  }));

  const { data: existing } = await sb
    .from("timetable_desk_slices")
    .select("slice_key")
    .eq("tenant_id", tenantId);
  const keep = new Set<string>(rows.map((r) => String(r.slice_key)));
  const stale = (existing ?? [])
    .map((r) => String((r as { slice_key: string }).slice_key))
    .filter((k) => !keep.has(k));
  if (stale.length > 0) {
    await sb
      .from("timetable_desk_slices")
      .delete()
      .eq("tenant_id", tenantId)
      .in("slice_key", stale);
  }

  if (rows.length > 0) {
    const { error } = await sb.from("timetable_desk_slices").upsert(rows);
    if (error) return { ok: false, error: error.message };
  }

  const grids = state.grids ?? [];
  const publishedGrids = state.publishedGrids ?? [];
  const substitutions = state.substitutions ?? [];

  await sb.from("timetable_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      slice_count: rows.length,
      grid_count: grids.length,
      published_grid_count: publishedGrids.length,
      substitution_count: substitutions.length,
      last_updated_at: now,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true };
}

export async function fetchTimetableDeskFromDb(): Promise<{
  bundle: TimetableDeskBundle;
  meta: TimetableDeskSyncMeta | null;
}> {
  const ctx = await resolveCtx();
  const empty = emptyBundle();
  if (!ctx) return { bundle: empty, meta: null };
  const { sb, tenantId } = ctx;

  const [{ data: sliceRows }, { data: metaRow }] = await Promise.all([
    sb.from("timetable_desk_slices").select("*").eq("tenant_id", tenantId),
    sb
      .from("timetable_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  const sliceMap: Partial<Record<TimetableSliceKey, unknown>> = {};
  for (const row of sliceRows ?? []) {
    const r = row as { slice_key: string; payload: unknown };
    const key = r.slice_key as TimetableSliceKey;
    if (TIMETABLE_SLICE_KEYS.includes(key)) {
      sliceMap[key] = r.payload;
    }
  }

  const bundle = slicesToBundle(sliceMap);

  const meta: TimetableDeskSyncMeta | null = metaRow
    ? {
        sliceCount: Number(metaRow.slice_count ?? 0),
        gridCount: Number(metaRow.grid_count ?? bundle.grids.length),
        publishedGridCount: Number(
          metaRow.published_grid_count ?? bundle.publishedGrids.length,
        ),
        substitutionCount: Number(
          metaRow.substitution_count ?? bundle.substitutions.length,
        ),
        lastUpdatedAt: metaRow.last_updated_at
          ? String(metaRow.last_updated_at)
          : null,
        updatedAt: String(metaRow.updated_at || ""),
      }
    : null;

  return { bundle, meta };
}
