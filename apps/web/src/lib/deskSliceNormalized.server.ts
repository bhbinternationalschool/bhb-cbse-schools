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
import { mergeSliceById } from "@/lib/sliceMergeById";

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

/**
 * mergeSliceById for lists whose rows are keyed by another field (staff HR
 * leave types by `code`): pushed rows win for their keys, stored rows the
 * push lacks are kept.
 */
function mergeSliceByKey(stored: unknown, incoming: unknown[], field: string): unknown[] {
  const keyOf = (r: unknown) =>
    r && typeof r === "object" && typeof (r as Record<string, unknown>)[field] === "string"
      ? String((r as Record<string, unknown>)[field])
      : "";
  const pushed = new Set(incoming.map(keyOf).filter(Boolean));
  const kept = (Array.isArray(stored) ? stored : []).filter((r) => {
    const k = keyOf(r);
    return k !== "" && !pushed.has(k);
  });
  return [...incoming, ...kept];
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
    /**
     * Rows this save deletes, by slice and id. A merge slice keeps every
     * stored row a save lacks, so a deletion has to be said: the server
     * writers that remove a row (a withdrawn leave request, a superseded
     * follow-up) name it here. Applied to merge slices only.
     */
    deletes?: Record<string, readonly string[]>;
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
  const slicesTable = `${def.deskPrefix}_desk_slices`;
  const { data: existing, error: existingErr } = await sb
    .from(slicesTable)
    .select("slice_key, payload")
    .eq("tenant_id", tenantId);
  if (existingErr) {
    // Cannot see what is there → cannot safely decide what to write.
    return { ok: false, error: existingErr.message };
  }
  const stored = new Map<string, unknown>();
  for (const r of existing ?? []) {
    stored.set(String((r as { slice_key: string }).slice_key), (r as { payload: unknown }).payload);
  }

  // A payload that carries no slice keys at all is not an instruction to
  // wipe the desk — it is a client that never held this module's state
  // (pushed before its own hydration finished, or after localStorage was
  // cleared). Unknown ≠ empty.
  const carriesNoKeys = allSliceKeys(def).every((k) => rest[k] === undefined);
  if (carriesNoKeys) {
    if (stored.size > 0) return { ok: false, error: "Refusing to sync: payload carries no slice keys" };
    return { ok: true };
  }

  // No slice is deleted by absence. A slice this push does not carry is left
  // as stored — it used to be deleted, along with every slice sent empty.
  // A slice it DOES carry is written as sent, an empty list included:
  // deleting the last row is a real edit. Merge slices (see the registry)
  // keep every stored row the push lacks.
  const merge = new Set(def.mergeSlices ?? []);
  const rows = stateToSlices(def, rest)
    .filter(({ key, payload }) => {
      if (def.objectSlices.includes(key)) return payload !== undefined && payload !== null && payload !== "";
      return Array.isArray(payload);
    })
    .map(({ key, payload }) => {
      let value: unknown = payload;
      if (merge.has(key) && Array.isArray(payload)) {
        const mergeKey = def.mergeKeys?.[key];
        value = mergeKey
          ? mergeSliceByKey(stored.get(key), payload, mergeKey)
          : mergeSliceById(stored.get(key), payload);
        const cap = def.mergeCaps?.[key];
        if (cap) {
          value = (value as Record<string, unknown>[])
            .slice()
            .sort((x, y) => String(y[cap.newestBy] ?? "").localeCompare(String(x[cap.newestBy] ?? "")))
            .slice(0, cap.max);
        }
      }
      return { tenant_id: tenantId, slice_key: key, payload: value, updated_at: now };
    });

  // Named deletes: removed from the merged list — or, for a merge slice
  // this save did not carry, from the stored list, which is then written.
  for (const [key, ids] of Object.entries(opts?.deletes ?? {})) {
    if (!merge.has(key) || !ids.length) continue;
    const gone = new Set(ids);
    const field = def.mergeKeys?.[key] ?? "id";
    const drop = (list: unknown) =>
      (Array.isArray(list) ? list : []).filter(
        (r) => !(r && typeof r === "object" && gone.has(String((r as Record<string, unknown>)[field]))),
      );
    const row = rows.find((r) => r.slice_key === key);
    if (row) row.payload = drop(row.payload);
    else if (stored.has(key)) rows.push({ tenant_id: tenantId, slice_key: key, payload: drop(stored.get(key)), updated_at: now });
  }

  // What the desk holds after this push: written slices as written, the
  // rest as stored.
  const after: Record<string, unknown> = {};
  for (const [k, v] of stored) after[k] = v;
  for (const r of rows) after[r.slice_key] = r.payload;
  const incomingRows = countPayloadRows(def, after);

  // The guard above catches a client that holds nothing at all. It does not
  // catch one that holds almost nothing — a browser that never hydrated this
  // desk and has since created a single row. That payload is a well-formed
  // array and looks exactly like a real edit; only its size gives it away.
  // See deskSliceShrinkGuard for the incident this is here to prevent.
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

  if (rows.length > 0) {
    const { error } = await sb.from(slicesTable).upsert(rows);
    if (error) return { ok: false, error: error.message };
  }

  await sb.from(`${def.deskPrefix}_desk_sync_meta`).upsert(
    {
      tenant_id: tenantId,
      slice_count: Object.keys(after).length,
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
