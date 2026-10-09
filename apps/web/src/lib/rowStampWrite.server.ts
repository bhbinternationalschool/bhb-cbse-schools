/**
 * Server half of stamped saves on per-row desks (browser: rowStampClient).
 *
 * A save names, for each row it changed, the `updated_at` it changed it
 * from ("" = a new row). A new row is inserted, never over one that already
 * exists; a changed row is updated only while the database still holds it
 * at that stamp. Anything else is a conflict: the row was changed (or
 * deleted) elsewhere since this browser loaded it, and the stored copy
 * stands.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type StampedWriteResult =
  | { ok: true; stamps: Record<string, string>; conflicts: string[] }
  | { ok: false; error: string };

/** `updated_at` of each row, keyed by id — what a load hands the browser. */
export function stampsOf(rows: Record<string, unknown>[] | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows ?? []) {
    if (r && typeof r.id === "string" && r.updated_at) out[r.id] = String(r.updated_at);
  }
  return out;
}

export async function writeStampedRows(
  sb: SupabaseClient,
  table: string,
  tenantId: string,
  rows: Record<string, unknown>[],
  stamps: Record<string, string>,
): Promise<StampedWriteResult> {
  const written: Record<string, string> = {};
  const conflicts: string[] = [];

  const fresh = rows.filter((r) => stamps[String(r.id)] === "");
  for (let i = 0; i < fresh.length; i += 200) {
    const part = fresh.slice(i, i + 200);
    const { data, error } = await sb
      .from(table)
      .upsert(part, { onConflict: "id", ignoreDuplicates: true })
      .select("id, updated_at");
    if (error) return { ok: false, error: error.message };
    const got = new Map((data ?? []).map((d) => [String(d.id), String(d.updated_at)]));
    for (const r of part) {
      const id = String(r.id);
      if (got.has(id)) written[id] = got.get(id)!;
      else conflicts.push(id); // already there: made elsewhere, or by an earlier save
    }
  }

  for (const r of rows) {
    const id = String(r.id);
    const from = stamps[id];
    if (!from) continue;
    const patch: Record<string, unknown> = { ...r };
    delete patch.id;
    delete patch.tenant_id;
    delete patch.created_at;
    // The new stamp must differ from the old one, or a second stale copy
    // holding the same stamp would still match. Rows whose updated_at is a
    // record's own time (an admission lead's) may not have moved on.
    const at = Date.parse(String(patch.updated_at ?? ""));
    const was = Date.parse(from);
    if (!(at > was)) patch.updated_at = new Date(Math.max(Date.now(), (was || 0) + 1)).toISOString();
    const { data, error } = await sb
      .from(table)
      .update(patch)
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .eq("updated_at", from)
      .select("id, updated_at");
    if (error) return { ok: false, error: error.message };
    if (data?.length) written[id] = String(data[0].updated_at);
    else conflicts.push(id);
  }

  return { ok: true, stamps: written, conflicts };
}
