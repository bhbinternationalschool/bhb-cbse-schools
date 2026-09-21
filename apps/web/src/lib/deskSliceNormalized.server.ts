/**
 * Generic desk slice push/fetch for secondary modules.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeskModuleId } from "@/lib/deskCutover";
import {
  deskSliceDef,
  deskSliceEnvDualWrite,
  type DeskSliceModuleDef,
} from "@/lib/deskSliceRegistry";
import { getServerTenantContext } from "@/lib/serverTenant";
import { judgeDeskShrink } from "@/lib/deskSliceShrinkGuard";

export type DeskSliceSyncMeta = {
  sliceCount: number;
  rowCount: number;
  lastUpdatedAt: string | null;
  updatedAt: string;
};

const META_SELECT =
  "slice_count, row_count, last_updated_at, updated_at";

function nowIso() {
  return new Date().toISOString();
}

function allSliceKeys(def: DeskSliceModuleDef): string[] {
  return [...def.objectSlices, ...def.sliceKeys];
}

function countPayloadRows(
  def: DeskSliceModuleDef,
  state: Record<string, unknown>,
): number {
  let rows = 0;
  for (const key of def.objectSlices) {
    if (state[key] != null && state[key] !== "") rows += 1;
  }
  for (const key of def.sliceKeys) {
    const arr = state[key];
    if (Array.isArray(arr) && arr.length > 0) rows += arr.length;
  }
  return rows;
}

function stateToSlices(
  def: DeskSliceModuleDef,
  state: Record<string, unknown>,
): { key: string; payload: unknown }[] {
  return allSliceKeys(def).map((key) => ({
    key,
    payload: state[key],
  }));
}

function slicesToBundle(
  def: DeskSliceModuleDef,
  sliceMap: Record<string, unknown>,
): Record<string, unknown> {
  const bundle: Record<string, unknown> = {};
  for (const key of def.objectSlices) {
    if (sliceMap[key] !== undefined) bundle[key] = sliceMap[key];
  }
  for (const key of def.sliceKeys) {
    const payload = sliceMap[key];
    bundle[key] = Array.isArray(payload) ? payload : [];
  }
  return bundle;
}

function resolveDef(id: DeskModuleId): DeskSliceModuleDef | null {
  return deskSliceDef(id) ?? null;
}

export async function pushDeskSliceToDb(
  id: DeskModuleId,
  state: { version: number } & Record<string, unknown>,
  opts?: {
    /**
     * The caller means to delete this much. Set it only where a person has
     * asked for a bulk deletion — never as a way past a surprising refusal.
     */
    allowShrink?: boolean;
  },
): Promise<{ ok: boolean; error?: string }> {
  const def = resolveDef(id);
  if (!def) return { ok: false, error: "Unknown desk slice module" };
  if (!deskSliceEnvDualWrite(def.envPrefix)) return { ok: true };

  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = nowIso();
  const { version: _v, ...rest } = state;
  // The certificate register is also written by the server (a parent's
  // WhatsApp request), so a browser's save must add to it, never replace
  // it: union by id — see certificatesMerge.ts.
  if (id === "certificates" && Array.isArray(rest.issues)) {
    const { data: cur, error: curErr } = await sb
      .from(`${def.deskPrefix}_desk_slices`)
      .select("payload")
      .eq("tenant_id", tenantId)
      .eq("slice_key", "issues")
      .maybeSingle();
    if (curErr) return { ok: false, error: curErr.message };
    const serverIssues = (cur as { payload?: unknown } | null)?.payload;
    if (Array.isArray(serverIssues) && serverIssues.length) {
      const { mergeCertificateIssues } = await import("@/lib/certificatesMerge");
      rest.issues = mergeCertificateIssues(
        serverIssues as { id: string; createdAt: string; voidedAt: string | null }[],
        rest.issues as { id: string; createdAt: string; voidedAt: string | null }[],
      );
    }
  }
  const slices = stateToSlices(def, rest);

  const rows = slices
    .filter(({ key, payload }) => {
      if (def.objectSlices.includes(key)) {
        return payload != null && payload !== "";
      }
      return Array.isArray(payload) && payload.length > 0;
    })
    .map(({ key, payload }) => ({
      tenant_id: tenantId,
      slice_key: key,
      payload,
      updated_at: now,
    }));

  const slicesTable = `${def.deskPrefix}_desk_slices`;
  const { data: existing, error: existingErr } = await sb
    .from(slicesTable)
    .select("slice_key")
    .eq("tenant_id", tenantId);
  if (existingErr) {
    // Cannot see what is there → cannot safely decide what to prune.
    return { ok: false, error: existingErr.message };
  }
  // A payload that carries no slice keys at all is not an instruction to
  // wipe the desk — it is a client that never held this module's state
  // (pushed before its own hydration finished, or after localStorage was
  // cleared). The empty-state guard in createDeskSlicePersistence ran only
  // AFTER this delete, which is how module toggles / templates / rules
  // "reset themselves" (ensure-desk then re-seeded defaults). Explicit
  // empty arrays (`rules: []`) are still honoured — deleting the last row
  // is a real edit. Unknown ≠ empty.
  const carriesNoKeys = allSliceKeys(def).every((k) => rest[k] === undefined);
  if (carriesNoKeys && (existing?.length ?? 0) > 0) {
    return { ok: false, error: "Refusing to sync: payload carries no slice keys" };
  }

  // The guard above catches a client that holds nothing at all. It does not
  // catch one that holds almost nothing — a browser that never hydrated this
  // desk and has since created a single row. That payload is a well-formed
  // array and looks exactly like a real edit; only its size gives it away.
  // See deskSliceShrinkGuard for the incident this is here to prevent.
  const incomingRows = countPayloadRows(def, rest);
  const { data: meta } = await sb
    .from(`${def.deskPrefix}_desk_sync_meta`)
    .select("row_count")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const shrink = judgeDeskShrink(
    Number((meta as { row_count?: number } | null)?.row_count ?? 0),
    incomingRows,
    opts?.allowShrink,
  );
  if (!shrink.ok) {
    console.warn(
      `[desk-slice] ${id}: refused a push leaving ${shrink.incomingRows} of ${shrink.storedRows} rows`,
    );
    return { ok: false, error: shrink.reason };
  }
  const keep = new Set(rows.map((r) => String(r.slice_key)));
  const stale = (existing ?? [])
    .map((r) => String((r as { slice_key: string }).slice_key))
    .filter((k) => !keep.has(k));
  if (stale.length > 0) {
    await sb
      .from(slicesTable)
      .delete()
      .eq("tenant_id", tenantId)
      .in("slice_key", stale);
  }

  if (rows.length > 0) {
    const { error } = await sb.from(slicesTable).upsert(rows);
    if (error) return { ok: false, error: error.message };
  } else {
    await sb.from(slicesTable).delete().eq("tenant_id", tenantId);
  }

  await sb.from(`${def.deskPrefix}_desk_sync_meta`).upsert(
    {
      tenant_id: tenantId,
      slice_count: rows.length,
      row_count: incomingRows,
      last_updated_at: now,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true };
}

export async function fetchDeskSliceFromDb(id: DeskModuleId): Promise<{
  bundle: Record<string, unknown>;
  meta: DeskSliceSyncMeta | null;
  /** false = the read itself failed; the bundle is unknown, not empty. */
  ok: boolean;
  error?: string;
}> {
  const def = resolveDef(id);
  if (!def) return { bundle: {}, meta: null, ok: false, error: "Unknown module" };

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return { bundle: {}, meta: null, ok: false, error: "Tenant not configured" };
  }
  const { sb, tenantId } = ctx;

  const [slicesRes, metaRes] = await Promise.all([
    sb.from(`${def.deskPrefix}_desk_slices`).select("*").eq("tenant_id", tenantId),
    sb
      .from(`${def.deskPrefix}_desk_sync_meta`)
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);
  // A timed-out or denied read used to come back as an empty bundle with
  // ok-shaped output; the client then took "empty" as the desk's state.
  if (slicesRes.error || metaRes.error) {
    const message = slicesRes.error?.message || metaRes.error?.message || "read failed";
    console.warn(`[${id}-desk] fetch failed`, message);
    return { bundle: {}, meta: null, ok: false, error: message };
  }
  const sliceRows = slicesRes.data;
  const metaRow = metaRes.data;

  const sliceMap: Record<string, unknown> = {};
  for (const row of sliceRows ?? []) {
    const r = row as { slice_key: string; payload: unknown };
    sliceMap[r.slice_key] = r.payload;
  }

  const bundle = slicesToBundle(def, sliceMap);
  const meta: DeskSliceSyncMeta | null = metaRow
    ? {
        sliceCount: Number(metaRow.slice_count ?? 0),
        rowCount: Number(metaRow.row_count ?? 0),
        lastUpdatedAt: metaRow.last_updated_at
          ? String(metaRow.last_updated_at)
          : null,
        updatedAt: String(metaRow.updated_at || ""),
      }
    : null;

  return { bundle, meta, ok: true };
}

export function countDeskSliceStateRows(
  id: DeskModuleId,
  state: Record<string, unknown> | null | undefined,
): number {
  const def = resolveDef(id);
  if (!def || !state) return 0;
  return countPayloadRows(def, state);
}
