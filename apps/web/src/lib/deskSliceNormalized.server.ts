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
import { mergeWithRevs } from "@/lib/sliceRevMerge";
import { casWriteSlice } from "@/lib/sliceCas.server";

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

export type DeskSlicePushResult = {
  ok: boolean;
  error?: string;
  /** slice → key → the new `_rev` of each row this save wrote. */
  revs?: Record<string, Record<string, number>>;
  /** slice → keys changed from a version that is no longer current (not written). */
  conflicts?: Record<string, string[]>;
};

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
    /**
     * slice → key → the `_rev` the save changed that row from (0 = new).
     * Sent by a browser that tracks versions: only those rows are written,
     * and only if still at that `_rev` (sliceRevMerge). Without it the save's
     * rows win as before, with `_rev` bumped on every real change.
     */
    revs?: Record<string, Record<string, number>>;
  },
): Promise<DeskSlicePushResult> {
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
  // as stored. A slice it DOES carry is written as sent, an empty list
  // included: deleting the last row is a real edit. Merge slices keep every
  // stored row the push lacks, apply per-row versions (sliceRevMerge), keep
  // their newest-N caps, and drop only the rows a save names (deletes).
  const merge = new Set(def.mergeSlices ?? []);
  const carried = stateToSlices(def, rest).filter(({ key, payload }) => {
    if (def.objectSlices.includes(key)) return payload !== undefined && payload !== null && payload !== "";
    return Array.isArray(payload);
  });
  const deleteOnly = Object.keys(opts?.deletes ?? {}).filter(
    (k) => merge.has(k) && (opts?.deletes?.[k]?.length ?? 0) > 0 && !carried.some((c) => c.key === k),
  );

  /** What one slice becomes, given what is stored for it now. Pure. */
  const sliceValue = (key: string, storedNow: unknown, incoming: unknown) => {
    if (def.objectSlices.includes(key) || !merge.has(key)) {
      return { value: incoming, revs: {} as Record<string, number>, conflicts: [] as string[] };
    }
    const field = def.mergeKeys?.[key] ?? "id";
    const merged = Array.isArray(incoming)
      ? mergeWithRevs(storedNow, incoming, { key: field, base: opts?.revs?.[key], union: def.mergeUnion?.[key] })
      : { rows: Array.isArray(storedNow) ? storedNow : [], revs: {}, conflicts: [] };
    let value: unknown[] = merged.rows;
    const cap = def.mergeCaps?.[key];
    if (cap) {
      value = (value as Record<string, unknown>[])
        .slice()
        .sort((x, y) => String(y[cap.newestBy] ?? "").localeCompare(String(x[cap.newestBy] ?? "")))
        .slice(0, cap.max);
    }
    const gone = new Set(opts?.deletes?.[key] ?? []);
    if (gone.size) {
      value = value.filter(
        (r) => !(r && typeof r === "object" && gone.has(String((r as Record<string, unknown>)[field]))),
      );
    }
    return { value, revs: merged.revs, conflicts: merged.conflicts };
  };

  // What the desk holds after this push (from the copy read above): the
  // shrink guard judges that, before anything is written.
  const after: Record<string, unknown> = {};
  for (const [k, v] of stored) after[k] = v;
  for (const { key, payload } of carried) after[key] = sliceValue(key, stored.get(key), payload).value;
  for (const key of deleteOnly) after[key] = sliceValue(key, stored.get(key), undefined).value;
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

  // Each slice is written only if nobody wrote it since it was read
  // (casWriteSlice); otherwise it is re-read and the merge re-applied, so two
  // saves at once can't drop each other's rows.
  const revs: Record<string, Record<string, number>> = {};
  const conflicts: Record<string, string[]> = {};
  for (const key of [...carried.map((c) => c.key), ...deleteOnly]) {
    const incoming = rest[key];
    let last = { revs: {} as Record<string, number>, conflicts: [] as string[] };
    const written = await casWriteSlice(sb, slicesTable, tenantId, key, (storedNow) => {
      const r = sliceValue(key, storedNow, deleteOnly.includes(key) ? undefined : incoming);
      last = { revs: r.revs, conflicts: r.conflicts };
      return r.value;
    });
    if (!written.ok) return { ok: false, error: written.error, revs, conflicts };
    after[key] = written.payload;
    if (Object.keys(last.revs).length) revs[key] = last.revs;
    if (last.conflicts.length) conflicts[key] = last.conflicts;
  }
  if (Object.keys(conflicts).length) {
    console.warn(`[desk-slice] ${id}: rows changed elsewhere first, not overwritten:`, JSON.stringify(conflicts));
  }

  await sb.from(`${def.deskPrefix}_desk_sync_meta`).upsert(
    {
      tenant_id: tenantId,
      slice_count: Object.keys(after).length,
      row_count: countPayloadRows(def, after),
      last_updated_at: now,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true, revs, conflicts };
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
