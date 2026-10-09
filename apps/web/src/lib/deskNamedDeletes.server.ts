/**
 * Desk saves delete only what they name.
 *
 * Every desk push used to end with `deleteStale`: read every stored id, delete
 * the ones the client's payload did not hold. That makes a save mean "these
 * are the only rows that may exist", and a browser that had not re-read since
 * someone else wrote — a teacher on the staff app, the WhatsApp bot, a second
 * office desktop — erased that person's work. On 9 Oct 2026 it took three
 * homework posts seconds after they were made.
 *
 * The replacement has two shapes, and a push uses one of them per table:
 *
 *  - deleteNamedIds: the client says which ids the user deleted (tracked in
 *    deskNamedDeletes.ts until the server confirms). Nothing else is touched.
 *  - deleteChildrenNotKept: child lines rewritten under a parent the payload
 *    holds in full (a voucher's lines, a run's lines). Scoped to those parent
 *    ids, so a parent the client does not hold is never reached.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchByIds } from "@/lib/supabase/pageAll";

/** A save names a handful of deletions; anything near this is not a user's click. */
const MAX_NAMED_DELETES = 500;

export type NamedDeletes = Record<string, string[]>;

/**
 * Read `deletes: { table: ids[] }` off a push body, keeping only tables this
 * desk owns. Anything else is dropped, not trusted.
 */
export function readNamedDeletes(
  raw: unknown,
  allowedTables: readonly string[],
): NamedDeletes {
  const out: NamedDeletes = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const table of allowedTables) {
    const v = (raw as Record<string, unknown>)[table];
    if (!Array.isArray(v)) continue;
    const ids = [
      ...new Set(v.filter((x): x is string => typeof x === "string" && x.trim() !== "")),
    ];
    if (ids.length) out[table] = ids;
  }
  return out;
}

/** Delete exactly these ids of this tenant. Returns the error, never swallows it. */
export async function deleteNamedIds(
  sb: SupabaseClient,
  tenantId: string,
  table: string,
  ids: readonly string[] | undefined,
): Promise<{ ok: boolean; error?: string }> {
  const list = [...new Set((ids ?? []).filter(Boolean))];
  if (list.length === 0) return { ok: true };
  if (list.length > MAX_NAMED_DELETES) {
    return {
      ok: false,
      error: `${table}: refusing ${list.length} named deletes in one save (max ${MAX_NAMED_DELETES})`,
    };
  }
  for (let i = 0; i < list.length; i += 200) {
    const { error } = await sb
      .from(table)
      .delete()
      .eq("tenant_id", tenantId)
      .in("id", list.slice(i, i + 200));
    if (error) return { ok: false, error: `${table}: ${error.message}` };
  }
  return { ok: true };
}

/**
 * Child rows rewritten under parents the payload carries whole: delete the
 * children of THOSE parents that the payload no longer lists. A parent absent
 * from the payload is left alone — absence is not a deletion.
 */
export async function deleteChildrenNotKept(
  sb: SupabaseClient,
  tenantId: string,
  table: string,
  parentColumn: string,
  parentIds: readonly string[],
  keepIds: ReadonlySet<string>,
): Promise<{ ok: boolean; error?: string }> {
  const parents = [...new Set(parentIds.filter(Boolean))];
  if (parents.length === 0) return { ok: true };
  // Paged: a parent's children can run past PostgREST's silent 1,000-row cap.
  const read = await fetchByIds<{ id: string }>(parents, (chunk, from, to) =>
    sb
      .from(table)
      .select("id")
      .eq("tenant_id", tenantId)
      .in(parentColumn, chunk)
      .order("id")
      .range(from, to),
  );
  if (read.error) return { ok: false, error: `${table}: ${read.error}` };
  const stale = read.rows.map((r) => String(r.id)).filter((id) => !keepIds.has(id));
  for (let i = 0; i < stale.length; i += 200) {
    const { error } = await sb
      .from(table)
      .delete()
      .eq("tenant_id", tenantId)
      .in("id", stale.slice(i, i + 200));
    if (error) return { ok: false, error: `${table}: ${error.message}` };
  }
  return { ok: true };
}
