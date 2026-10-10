/**
 * Trust desk — Supabase slice rows (trust_desk_slices).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TrustState } from "@/lib/trust";
import { trustDualWriteDbEnabled } from "@/lib/trustDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";
import { mergeWithRevs } from "@/lib/sliceRevMerge";
import { casWriteSlice } from "@/lib/sliceCas.server";
import { withoutTrustDemo } from "@/lib/trustDemoSeed";

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

export type TrustPushResult = {
  ok: boolean;
  error?: string;
  /** slice → id → the new `_rev` of each row this save wrote. */
  revs?: Record<string, Record<string, number>>;
  /** slice → ids changed from a version that is no longer current (not written). */
  conflicts?: Record<string, string[]>;
};

export async function pushTrustDeskToDb(
  state: TrustState,
  /** slice → id → the `_rev` each changed row was changed from (sliceRevMerge). */
  opts: { revs?: Record<string, Record<string, number>> } = {},
): Promise<TrustPushResult> {
  if (!trustDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = nowIso();
  const slices = stateToSlices(state);

  // Each slice row holds a whole collection, so writing a slice used to be
  // "these are the only projects / bills / contractors there are": a stale or
  // empty browser replaced the stored collection with its own, and a slice it
  // did not hold was deleted outright (an empty push wiped the desk). Nothing
  // in the Trust UI deletes a row, so a save now MERGES by id: its rows win
  // for the ids it carries, every stored row it lacks is kept, and no slice
  // is ever deleted. A desk we cannot read is unknown, not empty — nothing is
  // written.
  const { data: storedRows, error: readErr } = await sb
    .from("trust_desk_slices")
    .select("slice_key, payload")
    .eq("tenant_id", tenantId);
  if (readErr) {
    return { ok: false, error: `Could not read the saved trust desk — nothing was written: ${readErr.message}` };
  }
  const stored = new Map<string, unknown>();
  for (const r of storedRows ?? []) {
    stored.set(String((r as { slice_key: string }).slice_key), (r as { payload: unknown }).payload);
  }

  // The demo seed (trustDemoSeed.ts) is refused on the way in and dropped
  // from what is stored: a browser still holding it cannot push it back, and
  // the first save after this ships clears it from the desk.
  //
  // Rows carry a server `_rev`: a browser that says which rows it changed,
  // and from which `_rev`, overwrites only rows still at that version
  // (sliceRevMerge); without that, the save's rows win and real changes bump
  // `_rev`. Each slice is written only if unchanged since read (casWriteSlice).
  const sliceValue = (key: string, storedNow: unknown, incoming: unknown) => {
    const m = Array.isArray(incoming)
      ? mergeWithRevs(storedNow, incoming, { base: opts.revs?.[key] })
      : { rows: Array.isArray(storedNow) ? storedNow : [], revs: {} as Record<string, number>, conflicts: [] as string[] };
    return { value: withoutTrustDemo(key, m.rows), revs: m.revs, conflicts: m.conflicts };
  };
  const carried = slices.filter((x) => Array.isArray(x.payload) && x.payload.length > 0);
  const toWrite = carried.map((x) => x.key as string);
  for (const key of TRUST_SLICE_KEYS) {
    if (toWrite.includes(key)) continue;
    const kept = stored.get(key);
    if (Array.isArray(kept) && withoutTrustDemo(key, kept).length !== kept.length) toWrite.push(key);
  }

  const rows: { slice_key: string; payload: unknown }[] = [];
  const revs: Record<string, Record<string, number>> = {};
  const conflicts: Record<string, string[]> = {};
  for (const key of toWrite) {
    const incoming = carried.find((x) => x.key === key)?.payload;
    let last = { revs: {} as Record<string, number>, conflicts: [] as string[] };
    const written = await casWriteSlice(sb, "trust_desk_slices", tenantId, key, (storedNow) => {
      const r = sliceValue(key, storedNow, incoming);
      last = { revs: r.revs, conflicts: r.conflicts };
      return r.value;
    });
    if (!written.ok) return { ok: false, error: written.error, revs, conflicts };
    rows.push({ slice_key: key, payload: written.payload });
    if (Object.keys(last.revs).length) revs[key] = last.revs;
    if (last.conflicts.length) conflicts[key] = last.conflicts;
  }

  const merged = (key: TrustSliceKey): unknown[] => {
    const row = rows.find((r) => r.slice_key === key);
    const v = row ? row.payload : stored.get(key);
    return Array.isArray(v) ? v : [];
  };
  await sb.from("trust_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      slice_count: TRUST_SLICE_KEYS.filter((k) => merged(k).length > 0).length,
      project_count: merged("projects").length,
      work_item_count: merged("workItems").length,
      last_updated_at: now,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true, revs, conflicts };
}

export async function fetchTrustDeskFromDb(): Promise<{
  bundle: TrustDeskBundle;
  meta: TrustDeskSyncMeta | null;
  /** false = tenant/query could not be resolved; bundle is NOT a confirmed empty state. */
  ok: boolean;
}> {
  const ctx = await resolveCtx();
  const empty = emptyBundle();
  if (!ctx) return { bundle: empty, meta: null, ok: false };
  const { sb, tenantId } = ctx;

  const [
    { data: sliceRows, error: sliceErr },
    { data: metaRow },
  ] = await Promise.all([
    sb.from("trust_desk_slices").select("*").eq("tenant_id", tenantId),
    sb
      .from("trust_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  if (sliceErr) {
    console.warn("[trust-db] fetch failed", sliceErr.message);
    return { bundle: empty, meta: null, ok: false };
  }

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

  return { bundle, meta, ok: true };
}
