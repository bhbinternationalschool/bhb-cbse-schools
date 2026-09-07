/* ratchet-allow: unguarded_replace — the match is the BAD example quoted in the
   docstring below. This file is the fix, not an instance of the problem. */
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Replace a parent's child rows in ONE transaction.
 *
 * Use this anywhere the old shape appears:
 *
 *   await sb.from("exam_desk_marks").delete().eq("mark_sheet_id", id);
 *   await sb.from("exam_desk_marks").upsert(marks);
 *
 * Those are two statements with nothing tying them together. When the second
 * fails, the first has already committed and the parent is left with no
 * children — a mark sheet with no marks, a register with no attendance, a
 * receipt with no fee lines. That last one emptied the whole fee book on
 * 2026-09-06: 1,913 lines, ₹20.8 lakh of collections with no student, head or
 * month, and every month those families had paid reading unpaid again.
 *
 * `replace_child_rows` does the delete and the insert inside a plpgsql
 * function, so a failing insert rolls the delete back and the parent keeps
 * what it had. The push fails loudly instead of quietly destroying data.
 *
 * NOT for the other shape — `delete().in("id", staleIds)` followed by an
 * upsert of the live set. That is a prune: it removes rows that are meant to
 * go and rewrites rows that already exist, so a failed upsert loses nothing.
 * Leave those alone.
 */
export async function replaceChildRows(
  sb: SupabaseClient,
  opts: {
    /** Table name. Must be on the allowlist inside the SQL function. */
    table: string;
    /** Required for every tenant-scoped table; the function refuses without it. */
    tenantId: string | null;
    /**
     * Which parent's children to replace, as column → value. A scalar matches
     * with `=`, an array with `= any(...)`.
     *
     *   { mark_sheet_id: sheetId }
     *   { price_list_id: listId, item_id: [a, b] }
     */
    match: Record<string, string | number | boolean | string[]>;
    /** The new children. Keys must be column names. Empty means "none". */
    rows: Record<string, unknown>[];
  },
): Promise<{ ok: true; rows: number } | { ok: false; error: string }> {
  const { error, data } = await sb.rpc("replace_child_rows", {
    p_table: opts.table,
    p_tenant_id: opts.tenantId,
    p_match: opts.match,
    p_rows: opts.rows ?? [],
  });
  if (error) {
    // Said plainly, because the useful half of this message is that NOTHING
    // changed — the caller's data is still whatever it was before the call.
    return {
      ok: false,
      error: `${opts.table} not replaced (nothing was changed): ${error.message}`,
    };
  }
  const rows = (data as { rows?: number } | null)?.rows ?? 0;
  return { ok: true, rows };
}
