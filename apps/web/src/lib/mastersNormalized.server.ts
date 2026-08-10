/**
 * Masters desk — Supabase slice rows (masters_desk_slices).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MastersState } from "@/lib/masters";
import { emptyMastersShell } from "@/lib/masters";
import { mastersDualWriteDbEnabled } from "@/lib/mastersDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";
import { stripStaffFromMastersForBlob } from "@/lib/staffPersistence";

export type MastersSliceKey = keyof Omit<MastersState, "version">;

export const MASTERS_OBJECT_SLICES: MastersSliceKey[] = [
  "midYearFeePolicy",
  "schoolProfile",
  "schoolTiming",
];

export const MASTERS_ARRAY_SLICES: MastersSliceKey[] = [
  "campuses",
  "classes",
  "sections",
  "feeHeads",
  "feeHeadCategories",
  "feeGroups",
  "feeStructureLines",
  "installments",
  "lateFeeRules",
  "students",
  "specialFees",
  "specialFeeAssignments",
  "concessionKinds",
  "concessions",
  "concessionGrants",
  "academicYears",
  "academicTerms",
  "subjects",
  "classSubjects",
  "seniorStreams",
  "numberSeries",
  "holidays",
  "departments",
  "designations",
  "staff",
];

export const MASTERS_SLICE_KEYS: MastersSliceKey[] = [
  ...MASTERS_OBJECT_SLICES,
  ...MASTERS_ARRAY_SLICES,
];

export type MastersDeskSyncMeta = {
  sliceCount: number;
  classCount: number;
  feeHeadCount: number;
  subjectCount: number;
  lastUpdatedAt: string | null;
  updatedAt: string;
};

export type MastersDeskBundle = Omit<MastersState, "version">;

const META_SELECT =
  "slice_count, class_count, fee_head_count, subject_count, last_updated_at, updated_at";

async function resolveCtx(): Promise<{
  sb: SupabaseClient;
  tenantId: string;
} | null> {
  return getServerTenantContext();
}

function nowIso() {
  return new Date().toISOString();
}

function emptyBundle(): MastersDeskBundle {
  const { version: _v, ...rest } = emptyMastersShell();
  return rest;
}

function stateToSlices(state: MastersState): {
  key: MastersSliceKey;
  payload: unknown;
}[] {
  return MASTERS_SLICE_KEYS.map((key) => ({
    key,
    payload: state[key],
  }));
}

function slicesToBundle(
  sliceMap: Partial<Record<MastersSliceKey, unknown>>,
): MastersDeskBundle {
  const empty = emptyBundle();
  const bundle = { ...empty };
  for (const key of MASTERS_SLICE_KEYS) {
    const payload = sliceMap[key];
    if (payload === undefined || payload === null) continue;
    if (MASTERS_OBJECT_SLICES.includes(key)) {
      (bundle as Record<string, unknown>)[key] = payload;
      continue;
    }
    if (Array.isArray(payload)) {
      (bundle as Record<string, unknown>)[key] = payload;
    }
  }
  return bundle;
}

export async function pushMastersDeskToDb(
  state: MastersState,
): Promise<{ ok: boolean; error?: string; updatedAt?: string }> {
  if (!mastersDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = nowIso();
  const stripped = stripStaffFromMastersForBlob(state);
  const slices = stateToSlices(stripped);

  const rows = slices
    .filter(({ key, payload }) => {
      if (MASTERS_OBJECT_SLICES.includes(key)) return payload != null;
      return Array.isArray(payload) && payload.length > 0;
    })
    .map(({ key, payload }) => ({
      tenant_id: tenantId,
      slice_key: key,
      payload,
      updated_at: now,
    }));

  const { data: existing } = await sb
    .from("masters_desk_slices")
    .select("slice_key")
    .eq("tenant_id", tenantId);
  const keep = new Set<string>(rows.map((r) => String(r.slice_key)));
  const stale = (existing ?? [])
    .map((r) => String((r as { slice_key: string }).slice_key))
    .filter((k) => !keep.has(k));
  if (stale.length > 0) {
    await sb
      .from("masters_desk_slices")
      .delete()
      .eq("tenant_id", tenantId)
      .in("slice_key", stale);
  }

  if (rows.length > 0) {
    const { error } = await sb.from("masters_desk_slices").upsert(rows);
    if (error) return { ok: false, error: error.message };
  } else {
    await sb.from("masters_desk_slices").delete().eq("tenant_id", tenantId);
  }

  await sb.from("masters_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      slice_count: rows.length,
      class_count: state.classes?.length ?? 0,
      fee_head_count: state.feeHeads?.length ?? 0,
      subject_count: state.subjects?.length ?? 0,
      last_updated_at: now,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  // Derive the masters_desk_* row tables from the slices just written.
  //
  // The rows are a DERIVED copy, never a second writer: the slices stay
  // authoritative and the rows follow. Two independent writers would be a
  // merge problem, which is the disease this migration cures rather than a
  // treatment for it.
  //
  // This must happen before the read path can be switched. Until it does,
  // reads from the rows would come from somewhere the writes never reach,
  // and every masters edit would save fine and never appear.
  //
  // A failure here is reported, not swallowed. The slices are already
  // written and correct, so masters is not lost — but the rows are now stale
  // and the caller needs to know, because after the flip stale rows are what
  // the user would be looking at.
  const { error: syncErr } = await sb.rpc("masters_sync_rows_from_slices", {
    p_tenant_id: tenantId,
  });
  if (syncErr) {
    console.error("[masters] row-table sync failed", syncErr.message);
    return {
      ok: false,
      error: `Masters saved, but the row tables did not update: ${syncErr.message}`,
      updatedAt: now,
    };
  }

  // The exact revision written to sync meta. The route returns this to the
  // client, which stores it as the base for its next push — a freshly
  // minted timestamp here would differ from the stored one and make every
  // second push falsely stale under the revision guard.
  return { ok: true, updatedAt: now };
}

export async function fetchMastersDeskFromDb(): Promise<{
  bundle: MastersDeskBundle;
  meta: MastersDeskSyncMeta | null;
}> {
  const ctx = await resolveCtx();
  const empty = emptyBundle();
  if (!ctx) return { bundle: empty, meta: null };
  const { sb, tenantId } = ctx;

  // NOT YET reading from the row tables. The switch was written here and
  // reverted: importing mastersRowTables.server.ts from this module pulls a
  // `server-only` file into the CLIENT bundle graph, because masters.ts is
  // reachable from client pages —
  //
  //   mastersRowTables.server.ts -> mastersNormalized.server.ts
  //     -> mastersPersistence.ts -> masters.ts -> app/pay/share/page.tsx
  //
  // which fails the production build and 500s the route in dev. The flip
  // therefore belongs in the API route (already server-only) rather than in
  // this shared module, and that is the next piece of work. See
  // mastersRowTables.server.ts and /api/school-data/masters-parity, both of
  // which are verified and ready for it.

  const [{ data: sliceRows }, { data: metaRow }] = await Promise.all([
    sb.from("masters_desk_slices").select("*").eq("tenant_id", tenantId),
    sb
      .from("masters_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  const sliceMap: Partial<Record<MastersSliceKey, unknown>> = {};
  for (const row of sliceRows ?? []) {
    const r = row as { slice_key: string; payload: unknown };
    const key = r.slice_key as MastersSliceKey;
    if (MASTERS_SLICE_KEYS.includes(key)) sliceMap[key] = r.payload;
  }

  const bundle = slicesToBundle(sliceMap);
  return { bundle, meta: metaFromRow(metaRow, bundle) };
}

/**
 * Shared meta mapping, so the two read paths cannot disagree about the
 * revision. `updatedAt` is what the client sends back as `baseUpdatedAt`
 * for optimistic locking — it must be identical whichever source served the
 * bundle, or switching the read path would make every save falsely stale.
 */
function metaFromRow(
  metaRow: {
    slice_count?: number | null;
    class_count?: number | null;
    fee_head_count?: number | null;
    subject_count?: number | null;
    last_updated_at?: string | null;
    updated_at?: string | null;
  } | null,
  bundle: MastersDeskBundle,
): MastersDeskSyncMeta | null {
  if (!metaRow) return null;
  return {
    sliceCount: Number(metaRow.slice_count ?? 0),
    classCount: Number(metaRow.class_count ?? bundle.classes.length),
    feeHeadCount: Number(metaRow.fee_head_count ?? bundle.feeHeads.length),
    subjectCount: Number(metaRow.subject_count ?? bundle.subjects.length),
    lastUpdatedAt: metaRow.last_updated_at
      ? String(metaRow.last_updated_at)
      : null,
    updatedAt: String(metaRow.updated_at || ""),
  };
}

export function deskBundleToMastersState(bundle: MastersDeskBundle): MastersState {
  return { version: 2, ...bundle };
}

export async function fetchCurrentAcademicYearFromDesk(): Promise<string | null> {
  const { bundle } = await fetchMastersDeskFromDb();
  const years = bundle.academicYears ?? [];
  const cur = years.find(
    (y) => y.status === "current" && y.isActive !== false,
  );
  return cur?.code ?? null;
}
