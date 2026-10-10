/**
 * Stamped saves for the simple per-row desks (library, payroll, vault,
 * statutory, RTE — 10 Oct 2026). Same rule as accounts and PTM
 * (rowStampWrite.server), packaged for desks that save a few id-keyed lists,
 * a single settings row and a meta row.
 *
 * Stamped save (`stamps` given — every browser since this build): only the
 * rows named are written, each only while the database still holds it at
 * the stamp the browser loaded ("" = new, inserted only if absent).
 *
 * Unstamped save (a tab from an older build, or the one-time blob → desk
 * cutover): it holds the whole desk as it was when it loaded, so it may add
 * rows the database lacks but never replaces a stored one.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { writeStampedRows } from "@/lib/rowStampWrite.server";
import type { RowConflicts, RowStamps } from "@/lib/rowStampClient";
import { rowFingerprint } from "@/lib/sliceRevClient";

/** What a stamped desk save answers (fields absent when the desk is switched off). */
export type StampedDeskPushResult =
  | { ok: true; stamps?: RowStamps; conflicts?: RowConflicts; settingsStamp?: string; kept?: number }
  | { ok: false; error: string };

export type DeskRowsResult =
  | { ok: true; stamps: Record<string, string>; conflicts: string[]; kept: number; landed: Set<string> }
  | { ok: false; error: string };

export async function writeDeskRows(
  sb: SupabaseClient,
  tenantId: string,
  table: string,
  rows: Record<string, unknown>[],
  stamps: Record<string, string> | undefined,
  /** The table's unique key for inserts — "tenant_id,id" where id alone is not unique. */
  conflictKey = "id",
): Promise<DeskRowsResult> {
  if (stamps) {
    const changed = rows.filter((r) => String(r.id) in stamps);
    if (!changed.length) return { ok: true, stamps: {}, conflicts: [], kept: 0, landed: new Set() };
    const res = await writeStampedRows(sb, table, tenantId, changed, stamps, conflictKey);
    if (!res.ok) return { ok: false, error: `${table}: ${res.error}` };
    return { ok: true, stamps: res.stamps, conflicts: res.conflicts, kept: 0, landed: new Set(Object.keys(res.stamps)) };
  }
  const landed = new Set<string>();
  for (let i = 0; i < rows.length; i += 200) {
    const part = rows.slice(i, i + 200);
    const { data, error } = await sb
      .from(table)
      .upsert(part, { onConflict: conflictKey, ignoreDuplicates: true })
      .select("id");
    if (error) return { ok: false, error: `${table}: ${error.message}` };
    for (const d of data ?? []) landed.add(String(d.id));
  }
  return { ok: true, stamps: {}, conflicts: [], kept: rows.length - landed.size, landed };
}

/**
 * A desk's single settings row (keyed by tenant). Stamped: written only when
 * the browser changed it (`base` given), from the stamp it loaded; null =
 * unchanged, left alone. Unstamped: added only if the school has none.
 */
export async function writeDeskSettings(
  sb: SupabaseClient,
  tenantId: string,
  table: string,
  row: Record<string, unknown>,
  stamped: boolean,
  base: string | null | undefined,
): Promise<{ ok: true; stamp: string; conflict: boolean } | { ok: false; error: string }> {
  const now = new Date().toISOString();
  if (!stamped || base === "") {
    const { error } = await sb
      .from(table)
      .upsert({ ...row, tenant_id: tenantId, updated_at: now }, { onConflict: "tenant_id", ignoreDuplicates: true });
    if (error) return { ok: false, error: `${table}: ${error.message}` };
    return { ok: true, stamp: "", conflict: false };
  }
  if (!base) return { ok: true, stamp: "", conflict: false };
  const at = Date.parse(now) > Date.parse(base) ? now : new Date(Date.parse(base) + 1).toISOString();
  const { data, error } = await sb
    .from(table)
    .update({ ...row, updated_at: at })
    .eq("tenant_id", tenantId)
    .eq("updated_at", base)
    .select("updated_at");
  if (error) return { ok: false, error: `${table}: ${error.message}` };
  if (data?.length) return { ok: true, stamp: String(data[0].updated_at), conflict: false };
  return { ok: true, stamp: "", conflict: true };
}

/** Rows of a table for this school — meta counts come from here, not a partial save. */
export async function countDeskRows(
  sb: SupabaseClient,
  tenantId: string,
  table: string,
  filter?: { column: string; value: string | null },
): Promise<number> {
  let q = sb.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  if (filter) q = filter.value === null ? q.is(filter.column, null) : q.eq(filter.column, filter.value);
  const { count } = await q;
  return count ?? 0;
}

/** `updated_at` of a settings row read with the desk, "" when none. */
export function settingsStampOf(row: unknown): string {
  const at = (row as { updated_at?: unknown } | null)?.updated_at;
  return at ? String(at) : "";
}

/**
 * Stamps for a save the server merged itself (a function holder's change
 * laid onto the desk it just read): every row that differs from what was
 * read is sent at the stamp it was read at, a row that was not there is new.
 * The read and the write are then one version apart, never more.
 */
export function stampsForServerMerge(
  storedRows: unknown[],
  mergedRows: unknown[],
  storedStamps: Record<string, string> | undefined,
): Record<string, string> {
  const idOf = (r: unknown) => (r && typeof (r as { id?: unknown }).id === "string" ? (r as { id: string }).id : "");
  const before = new Map(storedRows.map((r) => [idOf(r), rowFingerprint(r)]));
  const out: Record<string, string> = {};
  for (const r of mergedRows) {
    const id = idOf(r);
    if (!id) continue;
    const was = before.get(id);
    if (was === undefined) out[id] = "";
    else if (was !== rowFingerprint(r)) out[id] = storedStamps?.[id] ?? "";
  }
  return out;
}
